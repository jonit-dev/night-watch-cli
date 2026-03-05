# Night Watch CLI — Roadmap

> **Vision:** A fully autonomous software engineering organization — from product strategy to shipped, tested, deployed code — driven by specialized AI agents working in concert.

---

## Where We Are Today (v1.7)

Night Watch is a **cron-driven autonomous PRD execution system**. It picks up work from a GitHub Projects board, implements it in isolated git worktrees, opens PRs, reviews them, runs QA, audits code, and auto-merges — all without human intervention.

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

## Phase 2 — Multi-Agent Collaboration

> Agents that communicate, delegate, and resolve conflicts.

### 2.1 Agent Communication Protocol

- Define a structured message format for inter-agent communication (requests, responses, handoffs)
- Implement a message bus (SQLite-backed initially) for async agent coordination
- Agents can request help from other agents (e.g., executor asks QA to validate a tricky edge case)

### 2.2 Parallel Execution

- **Inter-PRD**: Run multiple executors concurrently on independent PRDs (no dependency conflicts)
- **Intra-PRD (Agent Swarms)**: Decompose a single PRD into a dependency graph (DAG) and launch concurrent agent swarms for independent phases.
- Work-stealing: idle agents pick up tasks from a shared queue
- Conflict detection: if two executors touch overlapping files, flag for sequential processing or manual merge resolution.

### 2.3 Architecture Review Gate

- Before executor starts a large PRD, a dedicated architect agent reviews the approach
- Architect produces an implementation plan; executor follows it
- Prevents architectural drift across concurrent PRDs

### 2.4 PR Review Deliberation

- Multiple reviewer personas evaluate a PR independently
- Aggregate scores with weighted consensus (security reviewer has veto on security issues)
- Surface disagreements in PR comments for human visibility

---

## Phase 3 — Autonomous Planning & Prioritization

> The system decides _what_ to build, not just _how_.

### 3.1 Intelligent Slicer

- Slicer analyzes codebase architecture before generating PRDs
- Uses prd-creator template/instructions to standardize PRD creation
- PRDs include file-level implementation hints and dependency declarations
- Automatic complexity estimation (S/M/L) with runtime budget allocation

### 3.2 Audit → Action Pipeline

- Audit findings automatically become PRD candidates
- Priority scoring: security issues > bugs > tech debt > style
- Configurable thresholds for auto-creating vs. drafting PRDs from audit findings

### 3.3 Backlog Grooming Agent

- Periodically reviews open PRDs and board issues for staleness, conflicts, and redundancy
- Suggests PRD merges, splits, and re-prioritizations
- Detects when a PRD is outdated due to recent merges

### 3.4 Release Planning

- Agent analyzes merged PRs since last release and drafts changelog
- Suggests semantic version bump based on change categories
- Can trigger `npm publish` workflow when release criteria are met

---

## Phase 4 — Learning & Adaptation

> Agents that improve from experience.

### 4.1 Execution Memory

- Persist patterns from successful implementations (which approaches worked for which types of tasks)
- Reviewer tracks common fix categories — feed these back into executor prompts
- Per-project style learning: agent adapts to codebase conventions over time

### 4.2 Prompt Evolution

- A/B test different system prompts; track success metrics per variant
- Auto-tune prompts based on review scores, CI pass rates, and merge rates
- Version-control prompt templates with rollback capability

### 4.3 Cost Optimization

- Track token usage and cost per job type and per PRD complexity
- Route simple tasks to cheaper/faster models, complex tasks to stronger models
- Predictive budgeting: estimate cost before starting a PRD based on historical data

### 4.4 Failure Pattern Recognition

- Cluster common failure modes (e.g., "import path errors", "missing dependency", "type mismatch")
- Pre-inject mitigation instructions when similar PRDs are attempted
- Reduce retry loops by learning from past mistakes

### 4.5 Context Optimization (RAG)

- Implement dynamic context retrieval instead of feeding the entire codebase or all types into context windows.
- Automatically identify relevant interfaces via AST parsing before spawning an executor swarm.
- Reduce token bloat and improve the signal-to-noise ratio in agent prompts.

---

## Phase 5 — External Integration & Multi-Repo

> Scale beyond a single repository.

### 5.1 Multi-Repo Orchestration

- Register and manage multiple repositories from a single Night Watch instance
- Cross-repo PRDs: changes that span multiple packages/services
- Shared execution queue with per-repo configuration

### 5.2 Board Provider Expansion

- Linear integration (in addition to GitHub Projects)
- Jira integration
- Generic webhook-based board adapter

### 5.3 Deployment Agent

- Post-merge deployment verification (smoke tests against staging)
- Rollback trigger if deployment health checks fail
- Canary deployment support with gradual rollout monitoring

### 5.4 Incident Response Agent

- Monitor error tracking services (Sentry, Datadog)
- Auto-generate bug-fix PRDs from production error patterns
- Triage and prioritize incidents based on user impact

---

## Phase 6 — Org-Level Autonomy

> A self-sustaining engineering organization.

### 6.1 Product Strategy Agent

- Ingest product metrics, user feedback, and competitive analysis
- Generate feature proposals ranked by estimated impact
- Feed approved proposals into the slicer pipeline

### 6.2 Technical Debt Manager

- Continuously track and score technical debt across the codebase
- Balance feature work vs. debt paydown based on configurable policies
- Report debt trends in dashboard with projected maintenance cost

### 6.3 Documentation Agent

- Auto-generate and maintain API docs, architecture docs, and onboarding guides
- Detect documentation drift when code changes outpace docs
- Write migration guides for breaking changes

### 6.4 Human-in-the-Loop Controls

- Configurable approval gates at any pipeline stage (plan, implement, review, merge, deploy)
- Escalation rules: auto-escalate to human when confidence is low or risk is high
- Dashboard for reviewing agent decisions with approve/reject/redirect actions
- Audit log of all autonomous decisions for compliance and accountability

---

## Guiding Principles

1. **Ship incrementally** — each phase delivers standalone value
2. **Observe before optimizing** — telemetry first, automation second
3. **Human override always available** — autonomy is a dial, not a switch
4. **Dog-food relentlessly** — Night Watch builds Night Watch
5. **Cost-aware** — track and optimize AI spend as a first-class metric
