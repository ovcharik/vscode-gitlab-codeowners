import * as vscode from "vscode";
import { collectWorkspacePaths, type WorkspacePaths } from "./codeowners-lint";

/**
 * Cache of the workspace file tree.
 *
 * - Asynchronous, chunked walk: a cold start on a large repository does not
 *   block the extension host.
 * - Concurrent consumers share one in-flight walk instead of racing.
 * - Invalidated (with a small debounce, so bursts of filesystem events —
 *   e.g. `npm install` — trigger a single rebuild) on workspace folder
 *   changes and file events.
 */
export class WorkspacePathsCache implements vscode.Disposable {
  private cache: WorkspacePaths | undefined;
  private inflight: Promise<WorkspacePaths | undefined> | undefined;
  /** Bumped on every invalidation; walks check it before caching results */
  private generation = 0;
  private invalidateTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];
  private static readonly INVALIDATE_DEBOUNCE_MS = 500;

  constructor() {
    this.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()));

    // Filesystem watcher improves freshness of the cached tree (new/deleted
    // files change what the linter should report). Cache-only invalidation,
    // no incremental updates: the walk is cheap, correctness matters more.
    const watcher = vscode.workspace.createFileSystemWatcher("**");
    this.subscriptions.push(
      watcher,
      watcher.onDidChange(() => this.invalidateDebounced()),
      watcher.onDidCreate(() => this.invalidateDebounced()),
      watcher.onDidDelete(() => this.invalidateDebounced()),
    );
  }

  /** Starts the (async) walk if needed; concurrent callers await the same one. */
  get(): Promise<WorkspacePaths | undefined> {
    if (this.cache) return Promise.resolve(this.cache);
    if (this.inflight) return this.inflight;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return Promise.resolve(undefined);
    // Generation token: an invalidation during the walk must discard the
    // snapshot instead of writing a stale tree back into the cache.
    const generation = this.generation;
    this.inflight = collectWorkspacePaths(root)
      .then((ws) => {
        this.inflight = undefined;
        if (generation !== this.generation) {
          // Invalidated mid-walk: serve a fresh walk instead of stale data
          return this.get();
        }
        this.cache = ws;
        return this.cache;
      })
      .catch(() => {
        this.inflight = undefined;
        return undefined;
      });
    return this.inflight;
  }

  /** Synchronous best-effort access: only valid once the cache is warm. */
  getCached(): WorkspacePaths | undefined {
    return this.cache;
  }

  /** Fire-and-forget warm-up so later consumers hit a warm cache. */
  warmUp(): void {
    void this.get();
  }

  private invalidate(): void {
    this.generation++;
    this.cache = undefined;
    this.inflight = undefined;
  }

  private invalidateDebounced(): void {
    if (this.invalidateTimer) clearTimeout(this.invalidateTimer);
    this.invalidateTimer = setTimeout(() => {
      this.invalidateTimer = undefined;
      this.invalidate();
    }, WorkspacePathsCache.INVALIDATE_DEBOUNCE_MS);
  }

  dispose() {
    for (const d of this.subscriptions) d.dispose();
    if (this.invalidateTimer) clearTimeout(this.invalidateTimer);
    this.invalidate();
  }
}
