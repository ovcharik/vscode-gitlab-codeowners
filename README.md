# GitLab CODEOWNERS for VS Code

VS Code extension with support for [GitLab CODEOWNERS](https://docs.gitlab.com/ee/user/project/codeowners/) files.

## Features

- **File type detection** — `CODEOWNERS` files are recognized as `codeowners` language, so formatting and linting tools (e.g. ESLint with a custom parser) can be configured to validate them via `eslint.validate`.
- **Syntax highlighting** — highlights sections `[Section]` (including optional `^[Section]`), patterns, owners (`@user`, `@group/subgroup`, emails), optional owners and approval counts.
- **Status bar** — shows the code owners of the currently open file. Hover to see details (section, optional). Click to open a quick pick with all owners (selecting one copies its name to the clipboard).
- **Section folding** — sections fold from their header to the next section; trailing blank lines and comments stay visible so they remain attached to the section that follows.
- **GitLab search semantics** — nested `CODEOWNERS` files are supported: the nearest one relative to the open file wins (search paths: `CODEOWNERS`, `docs/CODEOWNERS`, `.gitlab/CODEOWNERS`).

Uses the official parser [`@gitlab/codeowners`](https://gitlab.com/gitlab-org/frontend/codeowners) by GitLab.

## Commands

| Command                                          | Description                                            |
| ------------------------------------------------ | ------------------------------------------------------ |
| `GitLab CODEOWNERS: Show owners of current file` | Quick pick list of all code owners for the active file |

## License

[MIT](LICENSE)
