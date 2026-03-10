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
