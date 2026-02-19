# Night Watch CLI: An AI-Driven Org Playbook Analysis

## What is Night Watch?

Night Watch is an **autonomous PRD execution platform** — a CLI + web UI that takes
Product Requirements Documents, feeds them to an AI coding agent (Claude CLI or Codex),
and produces Pull Requests while developers sleep. It runs on cron schedules,
reviews its own PRs, generates tests, and even decomposes roadmap items into new PRDs.

It is, in effect, a **software factory** where the unit of work is a specification
and the output is a shipped Pull Request.

---

## How It Maps to an AI-Driven Org Playbook

### 1. Specification as the Unit of Work

The fundamental bet Night Watch makes is that **writing specs is the highest-leverage
human activity in a software org**. The traditional flow is:

```
Human writes spec → Human writes code → Human reviews code → Human merges
```

Night Watch collapses this to:

```
Human writes spec → Machine writes code → Machine reviews code → Machine merges
```

The PRD template (`src/templates/prd-template.ts`) is not a loose document — it is a
structured contract with:
- Complexity scoring (LOW/MEDIUM/HIGH)
- Phased execution with max 5 files per phase
- Concrete test assertions per phase
- Integration point checklists
- Acceptance criteria

This is the key insight: **in an AI-driven org, the spec IS the code** — just at a
higher level of abstraction. The quality of the spec directly determines the quality of
the output. Night Watch has learned this empirically; the roadmap explicitly states
"Large PRDs are the #1 cause of failed runs."

**Playbook principle:** Invest in specification quality tooling, templates, and training.
The spec-writer becomes the most important role.

---

### 2. The Autonomous Execution Loop

Night Watch implements a full autonomous development loop via four cron-scheduled agents:

| Agent | Cadence | Role |
|-------|---------|------|
| **Executor** | Hourly | Pick next PRD, implement it, open PR |
| **Reviewer** | Every 3h | Review open PRs, auto-merge if passing |
| **QA** | 4x daily | Generate Playwright tests for PRs |
| **Slicer** | Every 6h | Scan ROADMAP.md, generate new PRDs |

This creates a closed loop:

```
ROADMAP.md
    ↓ (slicer)
PRDs queue
    ↓ (executor)
Pull Requests
    ↓ (reviewer + QA)
Merged code
    ↓ (humans update roadmap)
ROADMAP.md
```

**Playbook principle:** Autonomous AI agents need to be decomposed into
single-responsibility loops with clear inputs/outputs, not monolithic "do everything"
agents. Each loop should be independently schedulable, observable, and killable.

---

### 3. Human-in-the-Loop — Where and How

Night Watch is not fully autonomous. The human touch-points are deliberate:

| Activity | Human | Machine |
|----------|-------|---------|
| Roadmap authoring | Yes | No |
| PRD writing/editing | Yes (or Slicer) | Yes (Slicer) |
| PRD prioritization & dependencies | Yes | No |
| Code implementation | No | Yes |
| Code review | Optional | Yes (min review score) |
| Merge decision | Optional | Yes (auto-merge threshold) |
| Monitoring & intervention | Yes (dashboard) | No |
| Test generation | No | Yes (QA agent) |

The `minReviewScore` and `autoMerge` configs are the **trust dials**. An org early
in its AI journey might set `autoMerge: false` and review every PR manually. A mature
org might set `minReviewScore: 8` and let it fly.

**Playbook principle:** Design AI systems with explicit trust dials that can be
tightened or loosened as confidence grows. Never go from 0 to full autonomy in one step.

---

### 4. Observability as a First-Class Concern

Night Watch has an unusually rich observability surface for a CLI tool:

- **Web dashboard** with real-time SSE updates
- **Execution history** with per-PRD success/failure/timeout tracking
- **Log tailing** with search and filtering
- **Notifications** to Slack, Discord, and Telegram on lifecycle events
- **Doctor command** that validates the entire environment
- **GitHub Projects board** integration for visual workflow tracking

The roadmap calls out cost tracking and run timelines as upcoming features, with this
telling note: *"Autonomous agents burning money silently is the #1 trust-killer."*

**Playbook principle:** Observability for AI agents needs to be 10x better than for
human developers. Humans self-report ("I'm stuck", "this is taking longer than
expected"). Agents don't. You need dashboards, alerts, cost tracking, and audit trails
from day one.

---

### 5. The Scaling Model

Night Watch has a clear scaling progression:

**Stage 1: Solo developer** — Single project, local cron, one PRD at a time.
Simple `night-watch init && night-watch install`.

**Stage 2: Multi-project** — Global mode (`--global`) manages multiple repos from one
dashboard. Project registry in SQLite. One web UI to rule them all.

**Stage 3: Team** — The roadmap envisions collaboration features (ownership, handoff
notes, shared history), role-based auth, and config presets.

**Stage 4: Platform** — Remote worker execution, policy engines, audit trails,
GitHub Actions integration.

This is a textbook **bottom-up adoption pattern** — a developer tool that grows into
a team tool that grows into an org platform. The fact that it starts as a CLI that
installs into your crontab (zero infrastructure) is the wedge.

**Playbook principle:** AI tooling should start with zero-infrastructure adoption for
a single developer, then scale up. Don't build the platform first.

---

### 6. PRD Dependency Graphs = Autonomous Project Planning

One of the subtler features: PRDs can declare dependencies on other PRDs. The executor
respects these dependencies, only picking up a PRD when its prerequisites are in the
`done` state.

Combined with the Slicer (which converts roadmap items into PRDs), this creates the
foundation for **autonomous project decomposition and scheduling**:

```
Roadmap item: "Add user authentication"
    ↓ Slicer decomposes into:
    PRD-001: Database schema for users (no deps)
    PRD-002: Auth middleware (depends on 001)
    PRD-003: Login/register endpoints (depends on 002)
    PRD-004: Session management (depends on 002)
    PRD-005: UI login flow (depends on 003)
```

The executor would then process these in dependency order, one per cron cycle, producing
five PRs over ~5 hours. The roadmap's long-term vision ("Automatic PRD decomposition")
would make this fully autonomous.

**Playbook principle:** AI agents are bad at large, ambiguous tasks but good at small,
well-defined ones. The org's job is decomposition. Eventually, AI can help with that
too — but only after learning from thousands of human-authored decompositions.

---

### 7. The "Code While You Sleep" Philosophy

The cron-based execution model embodies a specific philosophy: **AI development is a
background process, not a real-time collaboration**. Rather than pair-programming with
an AI (a la Copilot), Night Watch treats AI as an async worker that operates on a queue.

The default schedule tells the story:
- Executor runs hourly from midnight to 9 PM
- Reviewer runs every 3 hours
- QA runs 4 times daily
- Slicer runs every 6 hours

This means a developer could write three PRDs on Monday afternoon, and by Tuesday
morning have three PRs ready for review — complete with tests and an AI review score.

**Playbook principle:** Not all AI-human collaboration needs to be synchronous.
For well-specified work, async batch processing (queued specs → PRs) can be more
efficient than real-time copiloting. The two models are complementary, not competing.

---

### 8. Self-Bootstrapping: Night Watch Builds Itself

The `docs/PRDs/night-watch/` directory contains 20+ completed PRDs — features of Night
Watch itself, implemented by Night Watch. The tool is literally building itself:

- `01-terminal-ui-polish.md` → `done`
- `08-prd-claim-mechanism.md` → `done`
- `13-roadmap-scanner.md` → `done`
- `18-ai-roadmap-slicer.md` → `done`
- `19-state-repository-sqlite.md` → `done`
- `20-core-ux-reliability.md` → `done`

This is the strongest validation of the concept. If your AI development platform can't
build itself, it probably can't build your product either.

**Playbook principle:** Dogfooding is non-negotiable for AI development tools.
The first customer should always be the tool itself.

---

## Strengths as an AI-Driven Org Tool

1. **Zero-infrastructure start** — No servers, no cloud accounts. Just `npm install -g`
   and a Claude API key.

2. **Specification-first by design** — Forces structured thinking before execution.
   The PRD template with complexity scoring and phased delivery is genuinely good
   process engineering.

3. **Full lifecycle coverage** — From roadmap scanning to code generation to review to
   merge. No manual handoffs required (though they're supported).

4. **Trust is configurable** — Auto-merge thresholds, dry-run modes, review scores.
   Organizations can start conservative and open up gradually.

5. **Provider-agnostic** — Claude, Codex, and (soon) Gemini. Not locked into one
   AI vendor.

6. **Observable by default** — Dashboard, notifications, history, doctor checks.
   Operators can always answer "what happened last night?"

---

## Gaps and Risks

1. **No cost visibility (yet)** — The roadmap flags this as critical. Without per-run
   cost tracking, an org can't answer "is this cheaper than a human?" or even "did
   that failed run just cost us $50?"

2. **Secrets in plaintext config** — API keys live in `night-watch.config.json`. Fine
   for a solo dev; dangerous for a team. Needs env-var references or vault integration.

3. **Bash scripts as execution backbone** — The cron scripts handle git operations,
   worktree management, provider invocation, and lock files — all in bash. This is the
   riskiest surface area. The roadmap acknowledges this and plans to migrate to
   TypeScript.

4. **No learning loop (yet)** — Each run starts from scratch. There's no mechanism to
   learn from past failures ("PRDs with complexity > 7 fail 60% of the time") or to
   improve prompts based on outcomes. The roadmap envisions this under "Intelligence
   and autonomous planning."

5. **Single-machine execution** — Everything runs on the developer's machine via cron.
   "My laptop is closed" = no runs. The roadmap addresses this with GitHub Actions
   and remote workers, but those don't exist yet.

6. **Review quality** — AI reviewing AI-written code has a known bias toward approval.
   Without human review calibration, auto-merge can become a rubber stamp. The
   `minReviewScore` threshold helps, but the model is grading its own homework.

---

## Where This Fits in the AI-Driven Org Maturity Model

```
Level 0: No AI usage
Level 1: AI copiloting (Copilot, ChatGPT for ad-hoc questions)
Level 2: AI task execution (Cursor, Claude Code for implementing defined tasks)
Level 3: AI workflow automation ← Night Watch is here
Level 4: AI-driven planning (AI decomposes goals into tasks autonomously)
Level 5: AI org management (AI allocates resources, sets priorities, measures outcomes)
```

Night Watch sits firmly at **Level 3**, with clear trajectory toward Level 4 (the Slicer
is a prototype of autonomous planning). It represents the transition from "AI helps me
write code" to "AI writes code while I do other things."

This is the hardest transition in the maturity model because it requires:
- Trust in AI output quality
- Investment in specification writing
- Tolerance for async, batch-mode development
- Observability and control infrastructure

Night Watch provides the infrastructure for this transition. The organizational
readiness is the harder part.

---

## Key Takeaways for an AI-Driven Org Playbook

1. **Specifications are the new source code.** Invest proportionally.

2. **Decomposition is the bottleneck.** Large tasks kill autonomous execution.
   Train people to write small, dependency-aware specs.

3. **Trust is earned incrementally.** Start with `autoMerge: false` and a human
   reviewing every PR. Loosen as success rate climbs above 90%.

4. **Observability must exceed the standard for human workers.** You'd notice if a
   developer stopped showing up. You won't notice if a cron job is silently failing.

5. **Background execution beats real-time copiloting for well-defined work.** Use
   both models, but recognize they serve different purposes.

6. **Self-bootstrapping is the acid test.** If the tool can build itself, it can
   probably build your product.

7. **Cost tracking is not optional.** Autonomous agents with API bills need the same
   financial discipline as any other production system.

8. **The org change is harder than the tech change.** Night Watch can be installed in
   5 minutes. Getting a team to write structured PRDs, trust AI output, and shift to
   async development takes months.
