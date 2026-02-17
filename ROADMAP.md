# Night Watch CLI Roadmap

This roadmap is organized by delivery horizon and focused on three goals:
- Make autonomous execution safer and more reliable.
- Make the CLI + web experience easier for day-to-day use.
- Build a scalable foundation for multi-project and team usage.

---

## Short Term (0-6 weeks)

### 1) Reliability and correctness hardening
- [ ] Close remaining consistency gaps between CLI and bash runtime (paths, logs, lock conventions, status reporting).
- [ ] Add stronger error handling around provider and GitHub CLI failures with clear recovery hints.
- [ ] Improve notification delivery accuracy (treat non-2xx webhook responses as failures).
- [ ] Add regression tests for failure/timeout/retry execution flows.
- [ ] Harden the claim file mechanism — stale claims from crashed processes should be detected and auto-released (currently relies on `maxRuntime` age check only; a process that dies at minute 1 of a 2-hour window blocks the PRD for the remaining time).
- [ ] Add structured logging (JSON lines) alongside human-readable logs so downstream tools can parse run outcomes without regex.

### 2) Quality gates and developer workflow
- [ ] Add minimal CI pipeline (`verify`, `test`) on pull requests.
- [ ] Add coverage tooling (`@vitest/coverage-v8`) and publish baseline coverage in CI output.
- [ ] Add shell script quality checks (`shellcheck`, optional `bats`) to reduce runtime script regressions.
- [ ] Align docs with current product reality (commands, web UI pages, config defaults).
- [ ] Add integration test that exercises the full `run --dry-run` path end-to-end (currently only unit-tested in isolation).

### 3) Product completeness for core operators
- [ ] Finalize roadmap scanner UX and edge-case handling (duplicates, malformed roadmap entries, clear completion state).
- [ ] Improve `doctor` output with actionable fix guidance and clearer environment diagnostics.
- [ ] Strengthen scheduling visibility (next run, paused state, install/uninstall outcomes) across CLI and web.
- [ ] Add `night-watch history` command — show a table of recent runs with outcome, duration, PRD name, and branch. Right now there's no easy way to answer "what happened last night?" without reading raw logs.
- [ ] Surface provider token/quota health in `doctor` — validate that the configured API key has remaining credits before a 2-hour run burns wall-clock time and fails at the provider layer.

---

## Medium Term (6 weeks-4 months)

### 4) Unified operations experience (CLI + Web)
- [ ] Add full PRD lifecycle operations in CLI and web (inspect, prioritize, retry, cancel, archive).
- [ ] Implement richer dependency visualization (blocked reasons, dependency graph, dependency health).
- [ ] Add real-time activity/event stream for run/review lifecycle and auditability.
- [ ] Improve logs experience with filters, correlation IDs, and run-level grouping.
- [ ] Add a **run timeline view** in the web UI — a Gantt-style or vertical timeline showing each run's start, duration, outcome, and the PRD it processed. The current status page is a snapshot; operators need the movie, not just the last frame.
- [ ] Support **PRD editing** in the web UI — even a basic markdown editor with preview would eliminate the context-switch of opening an editor, finding the file, editing, saving, and coming back to the dashboard.

### 5) Provider and execution platform expansion
- [ ] Expand provider abstraction to support additional AI runtimes and richer provider-specific configuration.
- [ ] Introduce safer execution guards (budget/time caps, branch protections, optional approval checkpoints).
- [ ] Add resumable run metadata to recover from interruptions without manual cleanup.
- [ ] Improve PR review automation with better CI signal interpretation and confidence thresholds.
- [ ] **Add Gemini CLI as a third provider.** The provider abstraction already exists (`claude | codex`); Gemini CLI follows a similar invocation pattern. This is low-hanging fruit that doubles the audience.
- [ ] **Decouple provider invocation from bash scripts.** The current `case` statement in `night-watch-cron.sh` is the single point where new providers get wired in. Moving provider invocation into a TypeScript strategy pattern would make adding providers a config-only change and make the bash layer thinner and more testable.
- [ ] Add **cost tracking per run** — capture token usage or API cost from provider output and surface it in status/history. Autonomous agents burning money silently is the #1 trust-killer.

### 6) Team and multi-project ergonomics
- [ ] Mature global mode for managing multiple repositories from one dashboard.
- [ ] Add project profiles and reusable config presets.
- [ ] Add collaboration features: ownership/claim visibility, handoff notes, and shared run history.
- [ ] Add import/export tooling for config and scheduling setups.
- [ ] **Add a `night-watch clone` command** — initialize a new project with config copied from an existing one. When managing 5+ repos, re-running `init` and manually copying config is friction that compounds.

---

## Long Term (4-12 months)

### 7) Platformization and enterprise readiness
- [ ] Add optional remote worker execution (self-hosted agents) for non-local automation.
- [ ] Introduce policy engine support (allowed commands, branch rules, security controls).
- [ ] Add auth and role-based permissions for web operations in shared environments.
- [ ] Add immutable audit trails and compliance-oriented operational reporting.

### 8) Intelligence and autonomous planning
- [ ] Evolve roadmap scanner into roadmap planning assistant (sizing, dependency suggestions, slice recommendations).
- [ ] Add PRD quality scoring and pre-execution readiness checks.
- [ ] Add historical learning loop: use prior run outcomes to improve prompts/templates and task slicing.
- [ ] Add strategic queue optimization (priority + dependency + risk aware scheduling).
- [ ] **Automatic PRD decomposition** — when a roadmap item is too large (detected via heuristics or LLM analysis), automatically split it into smaller, phase-aligned PRDs before queuing for execution. Large PRDs are the #1 cause of failed runs; this is where the "intelligence" layer would deliver the most value.
- [ ] **Post-run self-review** — after a run produces a PR, automatically trigger the reviewer on it before notifying the operator. Close the loop: generate -> review -> fix -> notify. Currently these are two independent cron schedules with no causal link.

### 9) Ecosystem and adoption
- [ ] Publish stable extension points for templates, providers, and notifier integrations.
- [ ] Create migration and onboarding kits for teams adopting Night Watch at scale.
- [ ] Build public examples/playbooks for common workflows (solo dev, startup team, platform team).
- [ ] Define and track product SLOs (run success rate, mean time to PR, review repair latency).
- [ ] **Publish a GitHub Action** — `uses: jonit-dev/night-watch-action@v1` that wraps the CLI for teams that prefer CI-triggered execution over local cron. This also solves the "my laptop is closed" problem without requiring self-hosted agents.

---

## Opinions & Notes (Claude's take)

Things I noticed while reading the codebase that aren't bugs but are worth flagging:

1. **The bash scripts are the riskiest surface area.** `night-watch-cron.sh` does git operations, worktree management, claim files, lock files, and provider invocation — all in bash. Every new provider or execution mode adds another `case` branch. The long-term play is to move this logic into TypeScript where it can be unit-tested, and reduce the bash layer to a thin shim that the TS layer calls.

2. **Config file contains secrets in plain text.** `night-watch.config.json` stores API tokens and bot tokens directly. This works for local-only usage, but the moment someone commits this file or uses global mode across machines, it becomes a security issue. Consider supporting environment variable references in config (`"$ENV:MY_TOKEN"`) or a separate `.env.night-watch` that's gitignored.

3. **The web UI is a black box from the main repo's perspective.** `web/dist/` is shipped as a pre-built artifact. This is fine for distribution, but makes it invisible to the main test/lint pipeline. If the web UI grows in importance (and it should — it's the friendliest surface for non-CLI users), consider integrating its build/test into the main `yarn verify` flow.

4. **No persistence layer beyond the filesystem.** Status, state, claims, logs — everything is flat files. This is actually a strength for the solo-dev use case (zero dependencies, inspect anything with `cat`). But it'll become a bottleneck for multi-project global mode. Worth being intentional about when/if to introduce SQLite or similar.

5. **The roadmap scanner is the most interesting feature.** It closes the loop from "I have ideas in a markdown file" to "there are PRDs queued for autonomous execution." The natural next step is making it smarter — detecting when a roadmap item is actually an epic that needs decomposition, suggesting dependencies between items, and estimating complexity from the description.

---

## Success Metrics (Cross-Horizon)

- [ ] Increase autonomous run success rate to >90% on well-formed PRDs.
- [ ] Reduce mean time from PRD creation to open PR by at least 50%.
- [ ] Keep false-positive notification rate near zero.
- [ ] Maintain high delivery confidence through stable CI and growing test coverage.
- [ ] Improve operator trust via clear status, recovery flows, and auditable run history.
- [ ] Track and reduce **cost per successful PR** — the metric that connects execution quality to resource efficiency.
- [ ] Measure **time-to-first-review** — how long between PR creation and first meaningful reviewer feedback (human or automated).
