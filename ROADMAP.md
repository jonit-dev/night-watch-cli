# Night Watch CLI — Roadmap

> **Vision:** An async AI execution layer for software teams: specs and queued work turn into reviewed pull requests with clear trust controls and human override.

---

## Where We Are Today (v1.7)

Night Watch is a **cron-driven overnight execution system** for well-scoped engineering work. It picks up work from a GitHub Projects board, implements it in isolated git worktrees, opens PRs, reviews them, runs QA, audits code, and can auto-merge when trust is high enough.

The current product wedge is not "fully autonomous software engineering." It is "your repo's night shift" for AI-native solo developers, maintainers, and small teams that already work from specs or queue-based workflows.

### Product Positioning

- **Primary users:** solo founders, maintainers, and small engineering teams that already trust AI on bounded work
- **Best jobs-to-be-done:** backlog chores, review fixes, QA/test generation, maintenance work, and well-scoped feature PRDs
- **Core promise:** define work during the day, let Night Watch execute overnight, review the output in the morning
- **Not the current promise:** replacing real-time collaboration, product strategy, or all engineering judgment

### Current Capabilities

| Agent        | Role                                                    | Status |
| ------------ | ------------------------------------------------------- | ------ |
| **Executor** | Implements PRDs as code, opens PRs                      | Stable |
| **Reviewer** | Scores PRs, requests fixes, retries, auto-merges        | Stable |
| **QA**       | Generates and runs Playwright e2e tests on PR branches  | Stable |
| **Auditor**  | Scans codebase for quality issues, writes audit reports | Stable |
| **Slicer**   | Converts ROADMAP.md items into granular PRD files       | Stable |

### Current Infrastructure

- Multi-provider support (Claude, Codex) with per-job provider assignment
- Rate-limit fallback (proxy → native Claude)
- GitHub Projects board integration (Draft → Ready → In Progress → Review → Done)
- Notification webhooks (Slack, Discord, Telegram)
- Web dashboard (React) + TUI dashboard (blessed)
- SQLite state tracking across all job types

### Legacy Code Pending Removal

- **Agent personas** (Maya, Carlos, Priya, Dev) + soul/style/skill compilation — unused, ~1250 LOC
- **Filesystem PRD mode** — superseded by board mode; dead code paths across 11 command files

---

## Phase 1 — Hardening & Observability

> Make the existing system rock-solid before expanding it.

### 1.1 Structured Execution Telemetry

- Emit structured JSON events for every agent action (task claimed, branch created, tests run, PR opened, review scored, etc.)
- Store events in SQLite `execution_events` table with timestamps, durations, token usage, and cost estimates
- Surface metrics in dashboard: success rate, avg cycle time (PRD → merged), cost per PR, retry rate

### 1.2 Failure Recovery & Self-Healing

- Detect and auto-recover from stale worktrees, orphaned lock files, and zombie branches
- Implement checkpoint-resume: if an executor times out mid-implementation, the next run picks up where it left off instead of starting over
- Dead-letter queue for PRDs that fail N times — surface them in dashboard with failure context

### 1.3 CI-Aware Reviewer

- Reviewer waits for and parses CI check results before scoring
- Map CI failure categories (lint, type-check, unit test, e2e) to targeted fix instructions
- Reviewer can push fix commits directly instead of requesting changes

### 1.4 Smarter QA

- QA agent reads existing test patterns in the project before writing new tests
- Test deduplication — skip generating tests that already exist
- Flaky test detection and quarantine
- Prune redundant tests

### 1.5 Pre-Execution Environment Checks (Migrations)

- Detect and apply unapplied database migrations automatically before executor waves begin.
- Ensure all required environment variables are verified via a `schema.ts`/`env.ts` validation check.
- Fail early if the schema dependencies for a phase aren't present in the target environment.

---

## Phase 2 — Smarter Automation

> Make agents more capable and the pipeline more efficient.

### 2.1 Parallel Execution

- Run multiple executors concurrently on independent PRDs (no dependency conflicts)
- Conflict detection: if two executors touch overlapping files, flag for sequential processing

### 2.2 Intelligent Slicer

- Slicer analyzes codebase architecture before generating PRDs
- Uses prd-creator template/instructions to standardize PRD creation
- PRDs include file-level implementation hints and dependency declarations
- Automatic complexity estimation (S/M/L) with runtime budget allocation

### 2.3 Audit → Action Pipeline

- Audit findings automatically become PRD candidates
- Priority scoring: security issues > bugs > tech debt > style
- Configurable thresholds for auto-creating vs. drafting PRDs from audit findings

### 2.4 Cost Tracking

- Track token usage and cost per job type and per PRD complexity
- Route simple tasks to cheaper/faster models, complex tasks to stronger models

### 2.5 Release Planning

- Agent analyzes merged PRs since last release and drafts changelog
- Suggests semantic version bump based on change categories
- Can trigger `npm publish` workflow when release criteria are met

---

## Future — Advanced Capabilities

> Ideas for later exploration once the core pipeline is mature.

### Multi-Agent Collaboration

- Agent communication protocol — structured message bus for inter-agent coordination
- Intra-PRD agent swarms — decompose a single PRD into a DAG and run phases concurrently
- Work-stealing — idle agents pick up tasks from a shared queue
- Architecture review gate — architect agent reviews approach before executor starts large PRDs
- PR review deliberation — multiple reviewer personas with weighted consensus scoring

### Learning & Adaptation

- Execution memory — persist patterns from successful implementations, feed back into prompts
- Prompt evolution — A/B test system prompts, auto-tune based on success metrics
- Failure pattern recognition — cluster common failure modes, pre-inject mitigations
- Context optimization (RAG) — dynamic context retrieval via AST parsing to reduce token bloat

### External Integration & Multi-Repo

- Multi-repo orchestration — manage multiple repositories from a single instance
- Board provider expansion — Linear, Jira, generic webhook adapter
- Deployment agent — post-merge smoke tests, rollback triggers, canary deployments
- Incident response agent — monitor error tracking, auto-generate bug-fix PRDs

### Org-Level Autonomy

- Product strategy agent — generate feature proposals from metrics and user feedback
- Technical debt manager — track, score, and balance debt paydown vs. feature work
- Documentation agent — auto-generate and maintain API/architecture docs
- Backlog grooming agent — detect stale/redundant PRDs, suggest merges and re-prioritizations
- Human-in-the-loop controls — configurable approval gates, escalation rules, audit log

These remain long-term explorations. They should not dilute the near-term positioning around safe, overnight execution for scoped work.

---

## Guiding Principles

1. **Ship incrementally** — each phase delivers standalone value
2. **Observe before optimizing** — telemetry first, automation second
3. **Human override always available** — autonomy is a dial, not a switch
4. **Dog-food relentlessly** — Night Watch builds Night Watch
5. **Cost-aware** — track and optimize AI spend as a first-class metric
