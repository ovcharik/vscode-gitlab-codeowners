/**
 * Unit tests for "search files by owner" (pure, no VS Code).
 */

import { describe, it } from "vitest";
import * as assert from "node:assert/strict";
import {
  collectOwners,
  filesOwnedBy,
  filesOwnedByAsync,
  ownersForFile,
} from "../src/codeowners-search";
import { parseDocument } from "../src/codeowners-document";

const DOC = [
  "* @default",
  "README.md @docs-team",
  "",
  "[Docs] @docs-default",
  "/docs/ @d1",
  "/docs/api/ @api-team",
  "!/docs/api/experimental.md",
  "/docs/api/index.md @index-owner",
  "",
  "[Review]",
  "docs/**/*.spec.ts @qa-team",
].join("\n");

const FILES = new Set([
  "README.md",
  "src/main.ts",
  "docs/guide.md",
  "docs/api/index.md",
  "docs/api/experimental.md",
  "docs/api/index.spec.ts",
]);

describe("collectOwners", () => {
  it("lists all owners from entries and section defaults", () => {
    assert.deepEqual(collectOwners(DOC), [
      "@api-team",
      "@d1",
      "@default",
      "@docs-default",
      "@docs-team",
      "@index-owner",
      "@qa-team",
    ]);
  });
});

describe("ownersForFile", () => {
  const sections = parseDocument(DOC);

  it("matches simple file rules", () => {
    assert.ok(ownersForFile(sections, "README.md").owners.includes("@docs-team"));
  });

  it("directory rule covers everything inside", () => {
    assert.ok(ownersForFile(sections, "docs/guide.md").owners.includes("@d1"));
    assert.ok(ownersForFile(sections, "docs/api/test.md").owners.includes("@api-team"));
  });

  it("later rule in the same section overrides earlier one", () => {
    const owners = ownersForFile(sections, "docs/api/index.md").owners;
    assert.ok(owners.includes("@index-owner"));
    // @d1 from `/docs/` is overridden by the more specific `/docs/api/` rule
    assert.ok(!owners.includes("@d1"));
  });

  it("exclusion removes ownership", () => {
    const owners = ownersForFile(sections, "docs/api/experimental.md").owners;
    assert.ok(!owners.includes("@api-team"));
  });

  it("wildcard rules still apply alongside more specific ones", () => {
    const owners = ownersForFile(sections, "docs/api/index.spec.ts").owners;
    assert.ok(owners.includes("@qa-team"));
    // last match in [Docs] for this file is `/docs/api/`, not index.md
    assert.ok(owners.includes("@api-team"));
    assert.ok(!owners.includes("@index-owner"));
  });

  it("default section owners apply to unmatched files", () => {
    assert.ok(ownersForFile(sections, "src/main.ts").owners.includes("@default"));
  });

  it("zero-owner rule (auto-approve) grants no owners", () => {
    const doc = ["* @fallback", "/free/"].join("\n");
    const s2 = parseDocument(doc);
    const owners = ownersForFile(s2, "free/a.md").owners;
    assert.deepEqual(owners, []);
  });
});

describe("filesOwnedBy", () => {
  it("returns all files of the owner with section info", () => {
    const { files, truncated } = filesOwnedBy(DOC, "@qa-team", { files: FILES });
    assert.equal(truncated, false);
    assert.deepEqual(
      files.map((f) => f.file),
      ["docs/api/index.spec.ts"],
    );
    assert.equal(files[0].section, "Review");
  });

  it("star rule assigns the owner to every file except overridden ones", () => {
    const { files } = filesOwnedBy(DOC, "@default", { files: FILES });
    assert.deepEqual(
      files.map((f) => f.file),
      // README.md goes to @docs-team: its rule is the last match
      [...FILES].filter((f) => f !== "README.md").sort(),
    );
  });

  it("respects exclusions and overrides in search results", () => {
    const { files } = filesOwnedBy(DOC, "@api-team", { files: FILES });
    // index.md is overridden by @index-owner, experimental.md is excluded,
    // index.spec.ts falls back to `/docs/api/` as the last matching rule
    assert.deepEqual(
      files.map((f) => f.file),
      ["docs/api/index.spec.ts"],
    );
  });

  it("truncates large results", () => {
    const many = { files: new Set([...Array(10).keys()].map((i) => `f${i}.ts`)) };
    const { truncated } = filesOwnedBy("* @x", "@x", many, 5);
    assert.equal(truncated, true);
  });
});

describe("filesOwnedByAsync", () => {
  it("gives the same results as the sync version", async () => {
    const sync = filesOwnedBy(DOC, "@qa-team", { files: FILES });
    const asyncResult = await filesOwnedByAsync(DOC, "@qa-team", { files: FILES });
    assert.deepEqual(asyncResult, sync);
  });

  it("reports progress and truncates via options", async () => {
    const many = { files: new Set([...Array(20).keys()].map((i) => `f${i}.ts`)) };
    const progress: Array<[number, number]> = [];
    const { truncated } = await filesOwnedByAsync("* @x", "@x", many, {
      limit: 3,
      chunkSize: 5,
      onProgress: (done, total) => progress.push([done, total]),
    });
    assert.equal(truncated, true);
    assert.ok(progress.length > 0, "progress callback fired");
    const [lastDone, lastTotal] = progress[progress.length - 1]!;
    assert.equal(lastTotal, 20);
    assert.ok(lastDone <= lastTotal);
  });
});
