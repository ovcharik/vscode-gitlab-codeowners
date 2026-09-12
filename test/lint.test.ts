/**
 * Unit tests for the pure lint rules (no VS Code dependencies).
 * Run: npm test
 */

import { describe, it, beforeAll } from "vitest";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { lintDocument, collectWorkspacePathsSync, matchesFile } from "../src/codeowners-lint";
import { parseDocument, splitByNonEscapedSpaces, globToRegExp } from "../src/codeowners-document";

// ---------------------------------------------------------------------------
// Fixture workspace
// ---------------------------------------------------------------------------

let fixtureRoot: string;

function setupFixture() {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "co-test-"));
  const dirs = ["docs", "docs/api", "packages/app/src/lib", "e2e/tests/billing", "model/db"];
  const files = [
    "README.md",
    "package.json",
    "docs/README.md",
    "docs/api/index.md",
    "docs/guide.md",
    "packages/app/src/lib/util.ts",
    "packages/app/src/main.ts",
    "e2e/tests/billing/billing.spec.ts",
    "gemfile.rb",
  ];
  for (const d of dirs) fs.mkdirSync(path.join(fixtureRoot, d), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(fixtureRoot, f), "");
}

beforeAll(setupFixture);

// ---------------------------------------------------------------------------
// Path matching semantics (docs: Path matching)
// ---------------------------------------------------------------------------

describe("matchesFile", () => {
  it("absolute path matches only at root", () => {
    assert.ok(matchesFile("/README.md", "README.md"));
    assert.ok(!matchesFile("/README.md", "docs/README.md"));
  });

  it("relative path is globstar — matches at any depth", () => {
    assert.ok(matchesFile("README.md", "docs/README.md"));
    assert.ok(matchesFile("README.md", "README.md"));
  });

  it("directory path with trailing slash matches everything inside", () => {
    assert.ok(matchesFile("/docs/", "docs/api/index.md"));
    assert.ok(!matchesFile("/docs/", "docs"));
  });

  it("single * does not cross /", () => {
    assert.ok(matchesFile("/docs/*.md", "docs/guide.md"));
    assert.ok(!matchesFile("/docs/*.md", "docs/api/index.md"));
  });

  it("** crosses directories", () => {
    assert.ok(matchesFile("/docs/**/*.md", "docs/api/index.md"));
  });

  it("? matches a single character but not /", () => {
    assert.ok(globToRegExp("/a?c/x").test("/abc/x"));
    assert.ok(!globToRegExp("/a?c/x").test("/ac/x"));
    assert.ok(!globToRegExp("/a?c/x").test("/a/c/x"));
  });

  it("* matches dotfiles (FNM_DOTMATCH)", () => {
    assert.ok(matchesFile("/docs/*", "docs/.gitignore-x"));
  });

  it("relative directory pattern matches at any depth (globstar)", () => {
    assert.ok(matchesFile("api/", "api/index.md"));
    assert.ok(matchesFile("api/", "docs/api/index.md"));
    assert.ok(!matchesFile("api/", "docs"));
  });
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("parseDocument", () => {
  const text = [
    "# comment",
    "* @default-owner",
    "",
    "[Docs] @docs-team",
    "/docs/ @d1",
    "missing-slash @d2",
    "",
    "^[Opt][3] @team-a",
    "/x @y",
    "",
    "[Malformed name",
    "/a/ @b",
    "",
    "/path/with\\ spaces @user",
    "!excluded/",
    "/included/ @x",
  ].join("\n");

  const sections = parseDocument(text);

  it("unnamed section collects entries before first header", () => {
    assert.equal(sections[0].entries.length, 1);
    assert.equal(sections[0].entries[0].pattern, "*");
  });

  it("parses section with default owners and position", () => {
    const docs = sections[1];
    assert.equal(docs.header?.name, "Docs");
    assert.deepEqual(docs.header?.defaultOwners, ["@docs-team"]);
    const e = docs.entries[0]!;
    assert.equal(e.line, 4);
    assert.equal(e.column, 0);
    assert.equal(e.kind, "directory");
  });

  it("optional section with approval count", () => {
    const opt = sections[2].header!;
    assert.equal(opt.optional, true);
    assert.equal(opt.approvalsNeeded, 3);
  });

  it("malformed section header becomes an entry", () => {
    // [Malformed name does not match SECTION_RE, so it lands as an entry
    // inside the last valid section (^[Opt][3] = sections[2])
    const lastSection = sections[2];
    const malformed = lastSection.entries.find((e) => e.pattern.startsWith("["));
    assert.ok(malformed, "malformed section header parsed as entry");
  });

  it("escaped spaces stay in pattern", () => {
    // [Malformed name] does not match SECTION_RE, so it (and everything
    // below) becomes entries of sections[2] (^[Opt][3]):
    // 0:/x @y  1:[Malformed  2:/a/ @b  3:/path\ with\ spaces  4:!excluded/  5:/included/
    const e = sections[2].entries[3]!;
    assert.equal(e.pattern, "/path/with spaces");
  });

  it("exclusion parsed with kind", () => {
    const e = sections[2].entries[4]!;
    assert.ok(e.isExclusion);
    assert.equal(e.path, "excluded/");
    assert.equal(e.kind, "directory");
  });

  it("splitByNonEscapedSpaces unescapes and splits", () => {
    assert.deepEqual(splitByNonEscapedSpaces("a\\ b @c"), ["a b", "@c"]);
  });
});

// ---------------------------------------------------------------------------
// Lint rules
// ---------------------------------------------------------------------------

describe("lintDocument", () => {
  const lint = (text: string) => lintDocument(text, collectWorkspacePathsSync(fixtureRoot));

  it("clean basic file produces no messages", () => {
    const msgs = lint(
      ["* @default", "[Docs] @team", "/docs/", "README.md @r", "/package.json @p"].join("\n"),
    );
    assert.deepEqual(msgs, []);
  });

  it("directory without trailing slash is an error", () => {
    const msgs = lint(["/docs @a"].join("\n"));
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]!.severity, "error");
    assert.match(msgs[0]!.message, /trailing slash/i);
  });

  it("non-existing path is a warning", () => {
    const msgs = lint(["/nope/missing @a"].join("\n"));
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]!.severity, "warning");
    assert.match(msgs[0]!.message, /does not exist/i);
  });

  it("non-existing file path is a warning", () => {
    const msgs = lint(["/ghost-file.txt @a"].join("\n"));
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]!.severity, "warning");
  });

  it("relative directory pattern matches at any depth (no false positive)", () => {
    // fixture has docs/api; pattern `api/` relative should match
    const msgs = lint(["api/ @a"].join("\n"));
    assert.deepEqual(msgs, []);
  });

  it("relative non-directory path resolves via globstar at the root", () => {
    // `README.md` (relative, no wildcard) must not warn: it matches the
    // root file AND docs/README.md at depth
    const msgs = lint(["README.md @a"].join("\n"));
    assert.deepEqual(msgs, []);
  });

  it("relative non-directory path inside a directory does not warn", () => {
    // `guide.md` lives inside docs/ — globstar should find it
    const msgs = lint(["guide.md @a"].join("\n"));
    assert.deepEqual(msgs, []);
  });

  it("wildcard with matches is fine", () => {
    assert.deepEqual(lint(["/docs/*.md @a"].join("\n")), []);
    assert.deepEqual(lint(["/docs/**/*.md @a"].join("\n")), []);
    assert.deepEqual(lint(["*.rb @a"].join("\n")), []); // gemfile.rb
  });

  it("wildcard without matches is a warning", () => {
    const msgs = lint(["/docs/*.cpp @a"].join("\n"));
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]!.severity, "warning");
    assert.match(msgs[0]!.message, /does not match any file/i);
  });

  it("entry without owners warns", () => {
    const msgs = lint(["/docs/"].join("\n"));
    assert.equal(msgs.length, 1);
    assert.match(msgs[0]!.message, /no owners/i);
  });

  it("entry without owners is fine when section has default owners", () => {
    const msgs = lint(["[S] @team", "/docs/"].join("\n"));
    assert.deepEqual(msgs, []);
  });

  it("malformed section header lints as nameless-section or entry", () => {
    const msgs = lint(["[Docs] @t", "/docs/", "[Broken name", "/a/ @b"].join("\n"));
    // [Broken name — unparsable section: no nameless-section error (parsed as entry)
    // but the entry has owner `name` (malformed), so no zero-owner warning for it
    // However `/a/ @b` path does not exist -> warning
    assert.ok(msgs.every((m) => m.severity !== "error" || !m.message.includes("name")));
  });

  it("empty section brackets [] is an error", () => {
    const msgs = lint(["[] @team"].join("\n"));
    const nameless = msgs.find((m) => /must have a name/i.test(m.message));
    assert.ok(nameless);
    assert.equal(nameless!.severity, "error");
  });

  it("duplicate section names produce info", () => {
    const msgs = lint(["[Docs] @a", "/docs/", "[DOCS] @b", "/docs/api/"].join("\n"));
    const dup = msgs.find((m) => /combines with the section/i.test(m.message));
    assert.ok(dup);
    assert.equal(dup!.severity, "info");
  });

  it("re-included path after exclusion is a warning", () => {
    const msgs = lint(["[S] @t", "* @a", "!/docs/", "/docs/ @b"].join("\n"));
    const inert = msgs.find((m) => /excluded by/i.test(m.message));
    assert.ok(inert, `expected exclusion warning, got: ${JSON.stringify(msgs)}`);
    assert.equal(inert!.severity, "warning");
  });

  it("package.json style absolute file rule is clean", () => {
    assert.deepEqual(lint(["/package.json @p"].join("\n")), []);
  });

  it("patterns from a real-world file stay clean", () => {
    const sample = [
      "* @default-owner",
      "/README.md @docs",
      "/packages/app/src/lib/ @frontend",
      "/e2e/tests/billing/ @qa",
      "/docs/**/*.md @docs",
    ].join("\n");
    assert.deepEqual(lint(sample), []);
  });
});
