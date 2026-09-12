# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows semver.

## [0.1.0] — 2026-09-12

### Added

- `codeowners` language for CODEOWNERS files: detection, syntax highlighting (sections, optional `^[Section]`, approval counts `[2]`, patterns, `@user`/`@group/subgroup` owners, emails, inline comments), and section folding
- Status bar showing the code owners of the active file; hover for details (per-owner section, optional); click opens a quick pick and copies the selected owner to the clipboard
- Command **GitLab CODEOWNERS: Show owners of current file**
- Command **GitLab CODEOWNERS: Search files by owner**
- Path autocompletion (repo file tree, segment by segment) and owner autocompletion (owners already used in the document)
- Lint diagnostics with GitLab semantics: nonexistent paths, directory patterns without a trailing slash, rules shadowed by later duplicates, duplicate section names, `!` exclusions of never-included paths, re-include attempts after exclusion
- Nested CODEOWNERS support: the nearest file relative to the open one wins (`CODEOWNERS`, `docs/CODEOWNERS`, `.gitlab/CODEOWNERS`, any deeper)

### Notes

- Zero runtime dependencies; GitLab matching semantics (last match wins, section composition, exclusions, relative patterns as globstar) are implemented in-house and covered by unit tests
