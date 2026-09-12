/**
 * Unit tests for the CODEOWNERS file locator (pure, fs-fixture based).
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findCodeownersFile, findCodeownersForRoot } from "../src/codeowners-locator";

let root: string;
let nested: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "co-locator-"));
  nested = path.join(root, "packages", "app", "src");
  fs.mkdirSync(nested, { recursive: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("findCodeownersForRoot", () => {
  it("returns undefined when no CODEOWNERS exists", () => {
    assert.equal(findCodeownersForRoot(root), undefined);
  });

  it("finds root/CODEOWNERS", () => {
    fs.writeFileSync(path.join(root, "CODEOWNERS"), "");
    assert.equal(findCodeownersForRoot(root), path.join(root, "CODEOWNERS"));
  });

  it("precedence: root wins over docs/ and .gitlab/", () => {
    fs.mkdirSync(path.join(root, ".gitlab"), { recursive: true });
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "CODEOWNERS"), "");
    fs.writeFileSync(path.join(root, ".gitlab", "CODEOWNERS"), "");
    // Root first per GitLab precedence among the canonical paths
    assert.equal(findCodeownersForRoot(root), path.join(root, "CODEOWNERS"));
    fs.rmSync(path.join(root, "CODEOWNERS"));
    assert.equal(findCodeownersForRoot(root), path.join(root, "docs", "CODEOWNERS"));
    fs.rmSync(path.join(root, "docs", "CODEOWNERS"));
    assert.equal(findCodeownersForRoot(root), path.join(root, ".gitlab", "CODEOWNERS"));
    fs.rmSync(path.join(root, ".gitlab", "CODEOWNERS"));
  });
});

describe("findCodeownersFile (nearest file up the tree)", () => {
  it("walks up from a nested directory to the root", () => {
    // Root CODEOWNERS from the previous describe is still there
    fs.writeFileSync(path.join(root, "CODEOWNERS"), "");
    const found = findCodeownersFile(path.join(nested, "main.ts"), root);
    assert.equal(found, path.join(root, "CODEOWNERS"));
  });

  it("prefers the nearest CODEOWNERS over the root one", () => {
    const pkgCodeowners = path.join(root, "packages", "CODEOWNERS");
    fs.writeFileSync(pkgCodeowners, "");
    const found = findCodeownersFile(path.join(nested, "main.ts"), root);
    assert.equal(found, pkgCodeowners);
    fs.rmSync(pkgCodeowners);
  });

  it("supports the nested docs/ location in intermediate directories", () => {
    const nestedDocs = path.join(root, "packages", "app", "docs");
    fs.mkdirSync(nestedDocs, { recursive: true });
    fs.writeFileSync(path.join(nestedDocs, "CODEOWNERS"), "");
    const found = findCodeownersFile(path.join(nested, "main.ts"), root);
    assert.equal(found, path.join(nestedDocs, "CODEOWNERS"));
    fs.rmSync(path.join(nestedDocs, "CODEOWNERS"), { recursive: true, force: true });
  });

  it("returns undefined when nothing is found", () => {
    // Remove every CODEOWNERS created by the earlier tests
    fs.rmSync(path.join(root, "CODEOWNERS"), { force: true });
    assert.equal(findCodeownersFile(path.join(nested, "main.ts"), root), undefined);
  });
});
