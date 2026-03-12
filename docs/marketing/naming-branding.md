# Night Watch CLI — Naming & Branding Notes

## Name Decision: Keep "Night Watch CLI"

### Why It's Fine

- npm package is scoped (`@jonit-dev/night-watch-cli`) — no npm conflict
- CLI binary is `night-watch` — different from `nightwatch` (Nightwatch.js)
- Target audience finds the tool via GitHub, word-of-mouth, direct links — not by Googling "nightwatch"
- Search intent is completely different: testers find Nightwatch.js, developers automating spec execution find Night Watch CLI

### Nightwatch.js Overlap — Mitigated By

- Owning different keyword territory (see SEO section below)
- Scoped npm package
- Different CLI binary name

---

## GitHub Description

**Recommended:**

> Turn GitHub issues into pull requests automatically. AI agents that implement, review, and test your specs on a schedule.

**Alternatives considered:**

- `Async AI execution layer for spec-driven teams. Queue work, wake up to PRs.`
- `Cron-based AI coding agent. Specs in, pull requests out.`
- `AI agent that implements your specs, opens PRs, reviews code, and runs tests — on a schedule.`

**What was rejected and why:**

- "Semi-autonomous software engineering app factory" — "app factory" implies it builds entire apps; "semi-autonomous" hedges weakly
- "Autonomous PRD execution using AI Provider CLIs + cron" — too technical, not outcome-first

---

## SEO Strategy

### Keywords We Own (Nightwatch.js does NOT compete here)

- AI PR automation
- async coding agent
- PRD automation tool
- spec-driven development CLI
- AI pull request generator
- automated code review agent
- async AI development
- spec to PR automation

### Keywords to Avoid (Nightwatch.js dominates)

- nightwatch e2e
- nightwatch testing
- nightwatchjs
- browser automation nightwatch

---

## Names Researched & Rejected

### Fully Available (domains + npm) — Rejected Alternatives

| Name        | Reason rejected                    |
| ----------- | ---------------------------------- |
| sentinelcli | Good but loses brand continuity    |
| nightcrew   | Good vibe, weaker SEO              |
| nightshift  | Best alternative if rebrand needed |
| autohelm    | Nautical metaphor, niche           |
| repocrew    | Clear but generic                  |
| cronpilot   | Technical, not memorable           |
| specforge   | SEO-strong but cold                |
| agentforge  | Rides hype wave                    |

### Why "AgenticSwarmCLI" Was Rejected

- "Agentic" is overused buzzword, will age poorly
- "Swarm" implies chaos — opposite of the controlled, spec-driven philosophy
- No personality or memorability
- Describes _how_ it works, not _what it does for you_

### Naming Principles Applied

- Outcome-first over mechanism-first
- Evocative metaphor > technical description
- Short, speakable, memorable
- No buzzwords that age poorly
