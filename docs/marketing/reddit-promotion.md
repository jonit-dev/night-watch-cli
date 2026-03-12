# Night Watch CLI — Reddit Promotion Plan

## Links

- **npm:** `npx @jonit-dev/night-watch-cli init`
- **GitHub:** https://github.com/jonit-dev/night-watch-cli
- **Landing page:** (add URL)

---

## Target Subreddits

### Tier 1 — High relevance, post first

| Subreddit | Members | Why | Post type |
|---|---|---|---|
| r/SideProject | ~200k | Built for show-and-tell of indie tools | Show-off / Launch |
| r/ChatGPTCoding | ~300k | AI-assisted coding is the core topic | Tutorial / Demo |
| r/ClaudeAI | ~150k | Night Watch uses Claude as primary provider | Tool showcase |
| r/selfhosted | ~400k | CLI tool you run on your own infra | Project announcement |
| r/opensource | ~50k | It's open source on GitHub | Launch post |

### Tier 2 — Good fit, post after Tier 1

| Subreddit | Members | Why | Post type |
|---|---|---|---|
| r/programming | ~6M | General dev audience, use sparingly | Link post to blog/landing |
| r/webdev | ~2M | Many solo devs / small teams here | Show-off |
| r/devops | ~300k | Cron-driven automation, CI integration | Tool announcement |
| r/github | ~30k | GitHub Projects integration is a key feature | Demo |
| r/solopreneur | ~100k | "Your overnight engineering team" resonates | Story post |
| r/indiehackers | ~100k | Solo founder building with AI | Behind-the-scenes |

### Tier 3 — Niche, optional

| Subreddit | Members | Why | Post type |
|---|---|---|---|
| r/node | ~200k | Built with Node/TypeScript | Project post |
| r/typescript | ~100k | TypeScript monorepo, tsyringe DI | Project post |
| r/MachineLearning | ~3M | AI agents in production | Discussion |
| r/artificial | ~200k | Practical AI agent use case | Discussion |

---

## Post Templates

### Template A — Show-off / Launch (r/SideProject, r/opensource, r/webdev)

**Title options (pick one):**
- "I built a CLI that runs Claude/Codex on a schedule and opens PRs while I sleep"
- "Night Watch: queue up tasks during the day, wake up to PRs in the morning"
- "I got tired of context-switching, so I built a cron-based orchestrator for Claude/Codex"

**TLDR:** It coordinates your agentic CLI (Claude Code, Codex, whatever) to trigger at set times, working through a list of pre-defined PRDs (product requirement docs).

**Body:**

```
Hey everyone. I've been building Night Watch for a few weeks and figured it's time to share it.

**Disclaimer:** I'm the creator of this MIT open source project. Free to use, but you still need your own Claude (or any other agentic CLI) subscription.

**TLDR:** Night Watch is a CLI that picks up work from your GitHub Projects board (it creates a dedicated one for this purpose), implements it with AI (Claude or Codex), opens PRs, reviews them, runs QA, and can auto-merge if you want. I'd recommend leaving auto-merge off for now and reviewing yourself. We're not quite there yet in terms of LLM models for full auto usage.

The idea: define work during the day, let Night Watch execute overnight, review PRs in the morning. You can leave it running 24/7 too if you have tokens. Either way, start with one task first until you get a feel for it.

**How it works:**

1. Queue issues on a GitHub Projects board. Ask Claude to "use night-watch-cli to create a PRD about X", or write the `.md` yourself and push it via the CLI or `gh`.
2. Night Watch picks up "Ready" items on a cron schedule. Careful: if it's not in the Ready column, IT WON'T BE PICKED UP.
3. Agents implement the spec in isolated git worktrees, so it won't interfere with what you're doing.
4. PRs get opened, reviewed (you can pick a different model for this), scored, and optionally auto-merged.
5. Telegram notifications throughout.

**Agents:**
- **Executor** -- implements PRDs, opens PRs
- **Reviewer** -- scores PRDs, requests fixes, retries. Stops once reviews reach a pre-defined scoring threshold (default is 80)
- **QA** -- generates and runs Playwright e2e tests, fills testing gaps
- **Auditor** -- scans for code quality issues, opens an issue and places it under "Draft" so it's not automatically picked up. You decide if it's relevant
- **Slicer** -- breaks roadmap (ROADMAP.md) items into granular PRDs (beta)

**Requirements:**
- Node
- GitHub CLI (authenticated, so it can create issues automatically)
- An agentic CLI like Claude Code or Codex (technically works with others, but I haven't tested)
- Playwright (only if you're running the QA agent)

Run `night-watch doctor` for extra info.

**Notifications:** Add your own Telegram bot to stay posted on what's happening.

**Things worth knowing:**

- It's in beta. Core loop works, but some features are still rough.
- Don't expect miracles. It won't build complex software overnight. You still need to review PRs and make judgment calls before merging. LLMs are not quite there yet.
- Quality depends on what's running underneath. I use Opus 4.6 for PRDs, Sonnet 4.6 or GLM-5 for grunt work, and Codex for reviews.
- Don't bother memorizing CLI commands. Just ask Claude to read the README and it'll figure out how to use it.
- Tested on Linux/WSL2.

**Tips:**
- Let it cook. Once a PR is open, don't touch it immediately. Let the reviewer run until the score hits 80+, then pick it up for reviewing yourself.
- Don't let PRs sit too long either. Merge conflicts pile up fast.
- Don't blindly trust any AI-generated PRs. Do your own QA.
- When creating the PRD, use the night-watch built-in template for consistency. Use Opus 4.6 for this part. (Broken PRD = broken output)
- Use the web UI to configure your projects: `night-watch serve -g`

[IMAGE_1: Dashboard showing active jobs and PR status]

[IMAGE_2: Terminal output of a successful run with PR link]

[IMAGE_3: GitHub PR opened by Night Watch with review score]

**Links:**
- GitHub: https://github.com/jonit-dev/night-watch-cli
- Website: https://nightwatchcli.com/
- Discord: https://discord.gg/maCPEJzPXa

Would love feedback, especially from anyone who's experimented with automating parts of their dev workflow.
```

---

### Template B — Tutorial / How-I-Use-It (r/ChatGPTCoding, r/ClaudeAI)

**Title options:**
- "How I use Claude to implement my entire backlog overnight (Night Watch CLI)"
- "I set up an AI agent pipeline that writes code, reviews PRs, and runs tests on autopilot"
- "My setup: Claude Code + cron + GitHub Projects = overnight AI engineering team"

**Body:**

```
I wanted to share my setup for async AI development. I built a CLI called Night Watch that turns my GitHub Projects board into an automated execution pipeline.

**The workflow:**

During the day, I write specs (PRDs) and add them as issues to a GitHub Projects board. At night, Night Watch picks them up and:

1. Claims the issue and moves it to "In Progress"
2. Creates a feature branch in an isolated worktree
3. Uses Claude Code (or Codex) to implement the spec
4. Opens a PR with a summary of changes
5. A reviewer agent scores the PR and requests fixes if needed
6. QA agent generates Playwright tests
7. If everything passes, it auto-merges

I wake up to Telegram notifications with PR links.

[IMAGE_4: GitHub Projects board with columns Draft/Ready/In Progress/Review/Done]

[IMAGE_5: Telegram notification showing successful run with PR summary]

**What surprised me:**
- The reviewer agent catching real bugs that I would have missed in a quick glance
- QA generating actually useful e2e tests, not just boilerplate
- The slicer agent converting high-level roadmap items into implementable PRDs

**Setup takes ~2 minutes:**
```
npx @jonit-dev/night-watch-cli init
night-watch install  # sets up cron
```

It supports Claude and Codex as providers, with automatic rate-limit fallback. You can configure per-job providers (e.g., Codex for execution, Claude for reviews).

[IMAGE_6: Web dashboard showing run history and stats]

GitHub: (repo link)

Happy to answer questions about the architecture or share more about how I use it day-to-day.
```

---

### Template C — Technical / DevOps angle (r/devops, r/selfhosted)

**Title options:**
- "Night Watch — cron-driven AI agent pipeline for automated PRs, reviews, and QA"
- "Open-source CLI that turns GitHub Projects into an overnight AI execution pipeline"

**Body:**

```
Built an open-source CLI tool for automating software engineering tasks on a schedule. It's not a SaaS — it runs on your machine via cron.

**Architecture:**
- TypeScript monorepo (core, cli, server packages)
- SQLite for state tracking
- GitHub Projects V2 API for work queue
- Claude Code / OpenAI Codex as execution providers
- Isolated git worktrees per job (no branch conflicts)
- Webhook notifications (Slack, Discord, Telegram)
- Web dashboard (React) + TUI dashboard

**Agent pipeline:**
```
Slicer (roadmap → PRDs) → Executor (PRD → PR) → Reviewer (PR → score/fix) → QA (PR → e2e tests) → Auto-merge
```

**Key design decisions:**
- Everything is cron-driven, no long-running daemon
- Each agent run is stateless — picks up where the board says to
- Provider-agnostic: swap Claude ↔ Codex per job type
- Rate-limit fallback: proxy → native Claude automatically
- All config in a single `night-watch.config.json`

[IMAGE_7: Architecture diagram or flow chart]

[IMAGE_8: Cron entries installed by `night-watch install`]

```
npx @jonit-dev/night-watch-cli init
```

GitHub: (repo link)

Looking for feedback on the scheduling model and the review scoring approach.
```

---

### Template D — Story / Founder angle (r/solopreneur, r/indiehackers)

**Title options:**
- "I built an AI 'night shift' for my codebase — it does my backlog while I sleep"
- "As a solo dev, I needed more hands. So I built an AI team that works overnight"

**Body:**

```
I'm a solo developer and I was drowning in backlog. Context-switching between feature work, code reviews, tests, and maintenance was killing my productivity.

So I built Night Watch — a CLI that acts as my overnight engineering team.

**How it works in practice:**
- During the day, I write specs and prioritize them on a GitHub Projects board
- At night, AI agents pick up the work, implement it, open PRs, review them, run tests
- In the morning, I review the PRs over coffee

It's like having a team that only works the night shift.

[IMAGE_9: Before/after showing backlog items moving to "Done"]

[IMAGE_10: Morning Telegram notifications with completed PRs]

**What it actually handles well:**
- Bug fixes with clear repro steps
- Refactoring tasks (rename, extract, reorganize)
- Test generation
- Maintenance work (dependency updates, lint fixes)
- Well-scoped features with clear specs

**What it doesn't replace:**
- Product strategy
- Architecture decisions
- Ambiguous "make it better" tasks

It's open source and runs on your own machine. No SaaS, no data leaving your environment.

GitHub: (repo link)

Anyone else automating parts of their dev workflow? Curious what's working for others.
```

---

## Image Placeholders

Replace these with actual screenshots before posting:

| Placeholder | What to capture |
|---|---|
| `[IMAGE_1]` | Web dashboard — jobs list or overview page |
| `[IMAGE_2]` | Terminal: successful `night-watch run` output showing PR URL |
| `[IMAGE_3]` | GitHub PR opened by Night Watch — show title, description, review score comment |
| `[IMAGE_4]` | GitHub Projects board with columns (Draft / Ready / In Progress / Review / Done) |
| `[IMAGE_5]` | Telegram notification — successful run with PR summary |
| `[IMAGE_6]` | Web dashboard — run history or analytics view |
| `[IMAGE_7]` | Architecture diagram or agent pipeline flow chart |
| `[IMAGE_8]` | Terminal: `night-watch install` output showing cron entries |
| `[IMAGE_9]` | GitHub Projects board before/after (items moved to Done) |
| `[IMAGE_10]` | Morning Telegram batch — multiple completed PR notifications |

---

## Posting Strategy

### Timing
- Post between **9–11 AM EST** on **Tuesday, Wednesday, or Thursday** (peak Reddit engagement)
- Space posts across subreddits: 1–2 per day over a week
- Don't cross-post — write slightly different titles/angles for each sub

### Order
1. **Day 1:** r/SideProject (Template A) + r/ClaudeAI (Template B)
2. **Day 2:** r/ChatGPTCoding (Template B) + r/opensource (Template A)
3. **Day 3:** r/selfhosted (Template C) + r/webdev (Template A)
4. **Day 4:** r/devops (Template C) + r/solopreneur (Template D)
5. **Day 5:** r/programming (link post) + r/indiehackers (Template D)

### Engagement rules
- Reply to every comment within the first 2 hours
- Be honest about limitations — "it works great for scoped tasks, not for vague requests"
- Don't be defensive about AI criticism — acknowledge valid concerns
- Share concrete numbers if you have them (PRs merged, time saved, cost per PR)
- If someone asks "how is this different from X" — answer directly, don't dodge

### What to avoid
- Don't say "game-changer" or "revolutionary"
- Don't post to subreddits that ban self-promotion (check rules first)
- Don't use multiple accounts or ask friends to upvote
- Don't spam the same post to 10 subs on the same day
