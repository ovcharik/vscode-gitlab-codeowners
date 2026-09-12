/**
 * Unit tests for completion suggestions (pure, no VS Code).
 */

import { describe, it, beforeAll } from "vitest";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { collectWorkspacePathsSync, type WorkspacePaths } from "../src/codeowners-lint";
import { getCompletionContext, suggestPaths, suggestOwners } from "../src/codeowners-completion";

let fixtureRoot: string;
let ws: WorkspacePaths;

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "co-completion-"));
  const mk = (rel: string, content = "") => {
    fs.mkdirSync(path.join(fixtureRoot, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, rel), content);
  };
  mk("README.md");
  mk("package.json");
  mk("docs/README.md");
  mk("docs/api/index.md");
  mk("docs/guide.md");
  mk("packages/app/src/lib/util.ts");
  mk("packages/app/src/main.ts");
  fs.mkdirSync(path.join(fixtureRoot, "docs/api"), { recursive: true });
  ws = collectWorkspacePathsSync(fixtureRoot);
});

describe("getCompletionContext", () => {
  it("empty line has no context", () => {
    assert.equal(getCompletionContext("", 0), null);
  });

  it("comment line has no context", () => {
    assert.equal(getCompletionContext("# comment", 3), null);
  });

  it("first token on a line is a path", () => {
    assert.equal(getCompletionContext("/docs/", 5), "path");
    assert.equal(getCompletionContext("docs @own", 4), "path");
  });

  it("space after the path switches to owner context", () => {
    assert.equal(getCompletionContext("/docs/ ", 7), "owner");
    assert.equal(getCompletionContext("/docs/ @", 7), "owner");
  });

  it("tokens after the first are owners", () => {
    assert.equal(getCompletionContext("/docs/ @own", 10), "owner");
    assert.equal(getCompletionContext("* @default ", 12), "owner");
  });

  it("section header line completes default owners", () => {
    assert.equal(getCompletionContext("[Docs] ", 7), "owner");
    assert.equal(getCompletionContext("^[Opt][2] @te", 12), "owner");
  });
});

describe("suggestPaths", () => {
  it("suggests root files and directories", () => {
    const labels = suggestPaths("", ws).map((c) => c.label);
    assert.ok(labels.includes("README.md"));
    assert.ok(labels.includes("docs/"));
    assert.ok(labels.includes("packages/"));
    assert.ok(labels.some((l) => l === "package.json"));
  });

  it("filters by typed prefix", () => {
    const labels = suggestPaths("R", ws).map((c) => c.label);
    assert.deepEqual(labels, ["README.md"]);
  });

  it("suggests children of a typed directory", () => {
    const labels = suggestPaths("docs/", ws).map((c) => c.label);
    assert.ok(labels.includes("api/"));
    assert.ok(labels.includes("guide.md"));
  });

  it("works with a leading slash (absolute pattern)", () => {
    assert.deepEqual(
      suggestPaths("/READ", ws).map((c) => c.label),
      ["README.md"],
    );
  });

  it("prefix match is case-insensitive", () => {
    assert.deepEqual(
      suggestPaths("read", ws).map((c) => c.label),
      ["README.md"],
    );
  });

  it("nested files are reached in steps via directory suggestions", () => {
    const labels = suggestPaths("docs/a", ws).map((c) => c.label);
    assert.deepEqual(labels, ["api/"]);
    const deeper = suggestPaths("docs/api/", ws).map((c) => c.label);
    assert.deepEqual(deeper, ["index.md"]);
  });

  it("segment-tail filtering works for a half-typed next segment", () => {
    // provider replaces only the text after the last "/", so suggestions
    // must match the typed tail while the label continues it
    const labels = suggestPaths("docs/ap", ws).map((c) => c.label);
    assert.deepEqual(labels, ["api/"]);
  });
});

describe("suggestOwners", () => {
  const doc = [
    "* @default @group/sub dev@example.com @@maintainer",
    "[Docs] @docs-team",
    "/docs/ @d1",
  ].join("\n");

  it("lists all owners used in the document", () => {
    const labels = suggestOwners("", doc).map((c) => c.label);
    for (const expected of [
      "@default",
      "@group/sub",
      "dev@example.com",
      "@@maintainer",
      "@docs-team",
      "@d1",
    ]) {
      assert.ok(labels.includes(expected), `missing ${expected}`);
    }
  });

  it("filters by prefix", () => {
    assert.deepEqual(
      suggestOwners("@d", doc).map((c) => c.label),
      ["@d1", "@default", "@docs-team"],
    );
  });

  it("labels owner kinds in detail", () => {
    const byLabel = new Map(suggestOwners("", doc).map((c) => [c.label, c.detail]));
    assert.equal(byLabel.get("@@maintainer"), "role");
    assert.equal(byLabel.get("dev@example.com"), "email");
    assert.equal(byLabel.get("@group/sub"), "user, group or subgroup");
    assert.equal(byLabel.get("@default"), "user, group or subgroup");
  });

  it("recognizes non-Latin (Cyrillic) owners", () => {
    const cyrillicDoc = "/docs/ @иван.петров иван@selectel.ru не-владелец";
    const labels = suggestOwners("", cyrillicDoc).map((c) => c.label);
    assert.ok(labels.includes("@иван.петров"));
    assert.ok(labels.includes("иван@selectel.ru"));
    assert.equal(labels.length, 2, `unexpected owners: ${labels.join(", ")}`);
  });
});
