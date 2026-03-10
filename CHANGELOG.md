# Changelog

All notable changes to Night Watch CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** This changelog covers changes from the initial public release onward.

## [1.7.94] - 2026-03-10

### Added
- GitHub issue and pull request templates for better community contributions
- Initial CHANGELOG documentation
- Contributing guidelines (`CONTRIBUTING.md`)
- Open source readiness documentation

### Fixed
- Dashboard scheduling page UX improvements and tab organization
- Loading state display when board is not configured

### Changed
- Moved run_started notification to executor CLI for better timing
- Provider presets for easier configuration

## [1.7.85] - 2026-02

### Added
- Web UI dashboard with scheduling and job management
- Slack webhook notifications (replaced multi-agent deliberation system)
- Manual job trigger functionality

### Removed
- Multi-agent Slack deliberation system (simplified to webhook-only notifications)
- MemoryService (no longer needed after Slack changes)

## [1.7.0] - 2026-01

### Added
- Initial public release of Night Watch CLI
- PRD-based autonomous execution using Claude CLI and Codex
- Git worktree isolation for parallel task execution
- Cron-based scheduling for overnight PR generation
- Agent personas (Maya, Carlos, Priya, Dev) with customizable prompts
- Soul/Style/Skill layer compilation system
- Avatar generation via Replicate Flux
- SQLite-based storage for PRDs, runs, and agent personas
- Review mode for AI-generated pull requests

[1.7.94]: https://github.com/jonit-dev/night-watch-cli/releases/tag/v1.7.94
[1.7.85]: https://github.com/jonit-dev/night-watch-cli/releases/tag/v1.7.85
[1.7.0]: https://github.com/jonit-dev/night-watch-cli/releases/tag/v1.7.0
