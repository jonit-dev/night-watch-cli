# PRD: Open-Source Readiness

**Complexity: 4 → MEDIUM**

## 1. Context

**Problem:** The project is missing standard OSS community files and has several bugs in README/CI that would hurt a public launch.

**Files Analyzed:**
- `README.md` — install command wrong, broken doc link, From Source uses npm not yarn
- `.github/workflows/ci.yml` — targets `main` but default branch is `master`
- `docs/contributing.md` — exists but not auto-discovered by GitHub (needs root copy)
- `.github/` — no issue templates, no PR template
- `web/README.md` — contains Google AI Studio boilerplate (unrelated)
- No `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md` at root

**Current Behavior:**
- `npm install -g night-watch-cli` installs wrong/nonexistent package (real npm package is `@jonit-dev/night-watch-cli`)
- `npm` badge links to wrong package name
- CI push trigger never fires (wrong branch `main` vs `master`)
- Contributors see blank issue/PR boxes with no guidance
- No community standards files (Code of Conduct, Security policy)
- No CHANGELOG for 190+ versions

## 2. Solution

**Approach:**
- Fix README bugs (install command, badge, broken link, From Source yarn command)
- Fix CI workflow branch targets
- Create community files: CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, CHANGELOG.md
- Create GitHub issue templates and PR template
- Clean up web/README.md

**Key Decisions:**
- CONTRIBUTING.md goes in `.github/` so GitHub auto-links it; also keep `docs/contributing.md` unchanged
- Use Contributor Covenant v2.1 for CODE_OF_CONDUCT.md
- CHANGELOG.md starts from current version with a brief history
- No new dependencies needed

## 3. Execution Phases

---

### Phase 1: Fix README and CI bugs

**Files (4):**
- `README.md` — fix install command, badge, broken link, From Source yarn
- `.github/workflows/ci.yml` — fix branch target main → master

**Implementation:**

- [ ] In `README.md` line 3: fix npm badge URL from `night-watch-cli` to `@jonit-dev/night-watch-cli`
  - Old: `https://img.shields.io/npm/v/night-watch-cli.svg`
  - New: `https://img.shields.io/npm/v/%40jonit-dev%2Fnight-watch-cli.svg`
  - And badge link: `https://www.npmjs.com/package/%40jonit-dev%2Fnight-watch-cli`

- [ ] In `README.md` Quick Start section: fix install command
  - Old: `npm install -g night-watch-cli`
  - New: `npm install -g @jonit-dev/night-watch-cli`

- [ ] In `README.md` Installation section: fix all install commands
  - npm Recommended: `npm install -g @jonit-dev/night-watch-cli`
  - npx: `npx @jonit-dev/night-watch-cli init`
  - From Source: replace `npm install && npm run build && npm link` with `yarn install && yarn build && npm link`

- [ ] In `README.md` Documentation table: fix broken link
  - Old: `[Architecture](docs/architecture.md)`
  - New: `[Architecture](docs/architecture-overview.md)`

- [ ] In `.github/workflows/ci.yml`: fix branch targets
  - Old: `branches: [main]` (both push and pull_request triggers)
  - New: `branches: [master]`

**Tests Required:**
| Test | Assertion |
|------|-----------|
| Manual: verify npm badge URL loads | Badge shows correct version |
| Manual: `npm install -g @jonit-dev/night-watch-cli` works | Package installs without 404 |
| Manual: `docs/architecture-overview.md` exists | File accessible |

**Verification:**
- `yarn verify` passes (no TS/lint changes, but ensures nothing broken)

---

### Phase 2: Community files — CONTRIBUTING, CODE_OF_CONDUCT, SECURITY

**Files (3):**
- `.github/CONTRIBUTING.md` — auto-discovered by GitHub
- `CODE_OF_CONDUCT.md` — project root
- `SECURITY.md` — project root

**Implementation:**

- [ ] Create `.github/CONTRIBUTING.md` — concise, links to `docs/contributing.md` for dev setup detail; adds bug report and feature request guidance

- [ ] Create `CODE_OF_CONDUCT.md` at project root — Contributor Covenant v2.1

- [ ] Create `SECURITY.md` at project root — vulnerability reporting via GitHub private security advisory

**Content for `.github/CONTRIBUTING.md`:**
```markdown
# Contributing to Night Watch CLI

Thank you for your interest in contributing!

## Quick Links

- **Development setup & build:** [docs/contributing.md](../docs/contributing.md)
- **Dev onboarding:** [docs/DEV-ONBOARDING.md](../docs/DEV-ONBOARDING.md)
- **Architecture:** [docs/architecture-overview.md](../docs/architecture-overview.md)

## Reporting Bugs

Open an issue using the **Bug Report** template. Include:
- Night Watch version (`night-watch --version`)
- OS and Node.js version
- Your `night-watch.config.json` (redact any API keys or tokens)
- Steps to reproduce and what you expected vs. what happened

## Requesting Features

Open an issue using the **Feature Request** template. Describe:
- The problem you're solving
- Your proposed solution
- Alternatives you considered

## Submitting Pull Requests

1. Fork the repo and create a branch from `master`
2. Follow the code conventions in [docs/contributing.md](../docs/contributing.md)
3. Add tests for any new behaviour
4. Run `yarn verify && yarn test` — both must pass
5. Open a PR against `master` and fill in the PR template

## First-time Contributors

Look for issues tagged `good first issue` — these are scoped, well-documented tasks ideal for getting familiar with the codebase.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](../CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
```

**Content for `CODE_OF_CONDUCT.md`:** Use Contributor Covenant v2.1 standard text with contact email placeholder.

**Content for `SECURITY.md`:**
```markdown
# Security Policy

## Supported Versions

Only the latest published version of `@jonit-dev/night-watch-cli` receives security fixes.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities via [GitHub's private security advisory feature](https://github.com/jonit-dev/night-watch-cli/security/advisories/new).

You should expect an acknowledgement within 48 hours. If a vulnerability is confirmed, we will release a patch as soon as possible.
```

**Verification:**
- `yarn verify` passes
- GitHub shows CONTRIBUTING link on Issues/PRs page after pushing

---

### Phase 3: GitHub templates and CHANGELOG

**Files (4):**
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`
- `.github/pull_request_template.md`
- `CHANGELOG.md` (project root)

**Implementation:**

- [ ] Create `.github/ISSUE_TEMPLATE/bug_report.md`
- [ ] Create `.github/ISSUE_TEMPLATE/feature_request.md`
- [ ] Create `.github/pull_request_template.md`
- [ ] Create `CHANGELOG.md` starting from current version `1.7.94` with brief history

**Bug report template fields:**
- Night Watch version
- OS + Node.js version
- Config (redacted)
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs

**Feature request template fields:**
- Problem statement
- Proposed solution
- Alternatives considered
- Additional context

**PR template fields:**
- Summary of changes
- Related issue (closes #)
- Type of change (bug fix / feature / docs / refactor)
- Checklist: tests pass, yarn verify passes, docs updated if needed

**CHANGELOG.md:** Start with current version block, note it covers changes from initial public release. Keep it brief — one block per recent milestone, not per patch.

**Verification:**
- `yarn verify` passes
- New issue on GitHub shows template selector
- New PR on GitHub shows template pre-filled

---

### Phase 4: Cleanup web/README.md

**Files (1):**
- `web/README.md`

**Implementation:**
- [ ] Replace Google AI Studio boilerplate content with a brief description of the Night Watch web dashboard: what it is, how to start it (`yarn dev` from `web/`), and a link to `docs/WEB-UI.md` for full docs.

**Verification:**
- `yarn verify` passes
- `web/README.md` no longer references Google AI Studio or unrelated tooling

---

## 4. Acceptance Criteria

- [ ] `npm install -g @jonit-dev/night-watch-cli` is the install command everywhere in README
- [ ] npm badge links to correct package
- [ ] `docs/architecture-overview.md` is the correct link in README doc table
- [ ] From Source section uses `yarn`
- [ ] CI push/PR triggers on `master` not `main`
- [ ] `.github/CONTRIBUTING.md` exists and GitHub links to it automatically
- [ ] `CODE_OF_CONDUCT.md` exists at project root
- [ ] `SECURITY.md` exists at project root
- [ ] `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md` exist
- [ ] `.github/pull_request_template.md` exists
- [ ] `CHANGELOG.md` exists at project root
- [ ] `web/README.md` has no Google AI Studio boilerplate
- [ ] `yarn verify` passes after all changes
