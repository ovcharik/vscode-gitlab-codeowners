# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows semver.

## [0.2.0] — 2026-09-12

### Added

- Command **CODEOWNERS for GitLab: Search files by owner**
- Lint diagnostics with GitLab semantics: nonexistent paths, directory patterns without a trailing slash, rules shadowed by later duplicates, duplicate section names, `!` exclusions of never-included paths, re-include attempts after exclusion
- Quick fixes for lint diagnostics: "Append trailing slash (/)" for directory patterns, "Remove ineffective rule" for re-includes after exclusion
- Stable diagnostic codes (`need-trailing-slash`, `exclude-redundant`) as the basis for code actions
- Path autocompletion (repo file tree, segment by segment) and owner autocompletion (owners already used in the document)
- Per-owner section attribution in status bar hover and quick picks

### Fixed

- Email highlighting: `@user` no longer matches inside email addresses; Unicode owners (Cyrillic and other non-Latin) are recognized by the linter
- Re-including a path in the same section after a `!` exclusion no longer resurrects its owners in search and status bar (matches GitLab semantics and the linter warning)
- A directory pattern like `api/` no longer matches a plain file named `api`
- Owners from the default section are no longer mislabeled with the last matched section's name
- Owner tokens no longer swallow trailing inline comments (`* @user # note`); inline comments are highlighted and completion is disabled inside them
- `?` in patterns is treated as a wildcard by the linter (fnmatch parity)
- Parsing a deleted or unreadable CODEOWNERS file no longer causes an unhandled rejection
- Stale-snapshot race in the workspace tree cache when invalidation happens during a walk
- Launch (F5) runs a one-shot build instead of the watch task

### Changed

- Dropped the `@gitlab/codeowners` dependency (bundle 310 KB → 35 KB); all GitLab matching semantics are implemented and tested in-house, zero runtime dependencies
- Build moved from esbuild to vite; linter/formatter moved to oxc (oxlint, oxfmt); tests moved to vitest

## [0.1.0] — 2026-09-12

### Added

- `codeowners` language for CODEOWNERS files with syntax highlighting (sections, patterns, owners, emails) and section folding
- Status bar showing the code owners of the active file; click opens a quick pick and copies the selected owner to the clipboard
- Command **CODEOWNERS for GitLab: Show owners of current file**
- Nested CODEOWNERS support: the nearest file relative to the open one wins (`CODEOWNERS`, `docs/CODEOWNERS`, `.gitlab/CODEOWNERS`)
- Parsing via the official `@gitlab/codeowners` package

### Notes

- Zero runtime dependencies; GitLab matching semantics (last match wins, section composition, exclusions, relative patterns as globstar) are implemented in-house and covered by unit tests
