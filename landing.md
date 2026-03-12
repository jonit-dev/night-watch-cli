# Night Watch CLI — Landing Page Specification

## Purpose

Marketing landing page for Night Watch CLI to convert visitors (developers, solo founders, maintainers, small team leads) into users. The page should communicate the core value proposition in under 10 seconds and make installation feel trivial.

---

## Design Direction

### Visual Identity

- **Theme:** Dark — near-black background (`#030712` / `bg-gray-950`) with indigo accent glow effects
- **Primary accent:** Indigo-500 (`#6366f1`) for CTAs, highlights, and glow effects
- **Secondary accents:** Green for "success/ready" states, amber for "in-progress", purple for stats
- **Typography:** System font stack or Inter/Geist Sans — clean, modern, monospaced for code snippets
- **Vibe:** Developer-focused, minimal, confident. Think Linear or Raycast landing pages — not corporate SaaS
- **Illustration style:** Abstract geometric patterns or subtle starfield/constellation motif (plays on "Night Watch" theme). No stock photos. No cartoon mascots

### Atmospheric Effects

- Subtle radial gradient glow (indigo-900/10) at top of page, like the existing web dashboard
- Optional: faint starfield or dot grid background pattern
- Code blocks should use a dark syntax theme (e.g., One Dark or similar)
- Smooth scroll with fade-in animations on section entry (intersection observer, not heavy libraries)

---

## Page Structure

### 1. Navbar (sticky)

- Logo (text: "Night Watch" in bold, with a subtle moon/watch icon or just a stylized "NW")
- Nav links: Features | How It Works | Agents | Docs
- CTA button: "Get Started" (links to #quick-start)
- GitHub star count badge (live via shields.io or GitHub API)

### 2. Hero Section

**Headline (large, bold):**
> Your repo's night shift.

**Subheadline (slate-400, 1-2 lines max):**
> Define work during the day. Night Watch executes overnight. Wake up to pull requests, reviewed code, and tested features.

**CTA buttons:**
- Primary: `npm install -g @jonit-dev/night-watch-cli` (copyable code block styled as a button, click-to-copy)
- Secondary: "Read the docs" (ghost/outline button, links to docs)

**Below the fold teaser:**
- A single animated terminal recording (asciinema or typed.js simulation) showing:
  ```
  $ night-watch init
  $ night-watch board create-prd "Add user settings page" --priority P1
  $ night-watch run
  > Executor: claiming issue #42...
  > Branch: night-watch/feat/42-user-settings
  > PR #17 opened — ready for review
  ```
- Or: a screenshot/mockup of the web dashboard showing agents running, board with issues, PR list

### 3. Value Proposition Strip (3 columns)

Three cards in a row, each with an icon, title, and 1-line description:

| Icon | Title | Description |
|------|-------|-------------|
| Moon/Clock | Async-first | Not pair-programming. Queued execution while you sleep. |
| GitBranch | Safe isolation | Every task runs in its own git worktree. Your main branch stays clean. |
| Eye/Shield | Human-in-the-loop | You review every PR. Configurable trust dials control auto-merge. |

### 4. How It Works (horizontal stepper or vertical timeline)

**Section title:** "From spec to merged PR — while you sleep"

Four steps, each with a number, title, short description, and a small illustrative icon or code snippet:

1. **Define work** — Create a GitHub issue or write a PRD. Mark it as "Ready" on your project board.
2. **Night Watch picks it up** — The executor claims the next issue, creates a worktree, and implements the spec.
3. **Automated review cycle** — The reviewer scores the PR, requests fixes, and retries. QA generates and runs e2e tests.
4. **You wake up to PRs** — Review, approve, merge. Or let auto-merge handle it when the score is high enough.

### 5. Agents Section

**Section title:** "Five agents. One closed loop."

Grid of 5 agent cards (2x3 or horizontal scroll on mobile). Each card:

| Agent | Role | Schedule hint |
|-------|------|---------------|
| Executor | Implements specs as code, opens PRs | Hourly |
| Reviewer | Scores PRs, requests fixes, auto-merges | Every 3 hours |
| QA | Generates and runs Playwright e2e tests | 4x daily |
| Auditor | Scans codebase for quality issues | Weekly |
| Slicer | Breaks roadmap items into granular specs | Every 6 hours |

Each card should have a subtle colored accent bar on top (different color per agent) and a small icon. On hover, show a brief example of what the agent outputs (e.g., Reviewer: "Score: 87/100 — ready to merge").

### 6. Dashboard Preview

**Section title:** "Full visibility into your night shift"

- Large screenshot or embedded video of the web dashboard showing:
  - Agent status bar (all 5 agents with running/idle states)
  - Board kanban (Draft/Ready/In Progress/Review/Done)
  - PR list with review scores
  - Scheduling page with cron configuration
- Overlay text callouts pointing to key UI elements
- Caption: "Web dashboard included. Real-time updates via SSE. No extra hosting required."

### 7. Who It's For / Who It's Not For

Two-column layout:

**Night Watch is strongest when:** (green checkmarks)
- You already use structured specs, PRDs, or queued board items
- You want async execution, not another pair-programming UI
- Your work can be broken into small, reviewable pull requests
- You care about overnight throughput on bounded tasks

**Night Watch is a weaker fit when:** (gray x-marks)
- Work starts vague and gets clarified only during implementation
- Your team is not comfortable reviewing AI-generated pull requests
- You want a general-purpose AI coding assistant

### 8. Quick Start Section

**Section title:** "Up and running in 60 seconds"

```bash
# Install globally
npm install -g @jonit-dev/night-watch-cli

# Initialize in your project
cd your-project
night-watch init

# Check everything is set up
night-watch doctor

# Add work to the queue
night-watch board create-prd "Implement feature X" --priority P1

# Run once or install cron for overnight automation
night-watch run           # run once
night-watch install       # setup automated cron
```

Below the code block:
- Link: "5-minute walkthrough" (→ docs/walkthrough.md)
- Link: "Full docs" (→ docs/)
- Link: "Commands reference" (→ docs/commands.md)

### 9. Provider Support

Small horizontal strip showing supported providers:

| Provider | Mode |
|----------|------|
| Claude CLI | Default, with rate-limit fallback |
| Codex CLI | Full support |
| GLM-5 / Custom endpoints | Via `providerEnv` config |

Caption: "Bring your own AI provider. Night Watch wraps the CLI — you stay in control of credentials and costs."

### 10. Social Proof / Traction (optional, add when available)

- GitHub stars count
- npm weekly downloads
- Brief testimonial quotes (if available)
- "Used by X developers" counter

### 11. Footer

- Links: GitHub | npm | Docs | License (MIT)
- "Built by [jonit-dev](https://github.com/jonit-dev)"
- Small text: "Night Watch is open source. MIT licensed."

---

## Responsive Behavior

- **Desktop (1200px+):** Full layout as described. 3-column value prop, side-by-side "for/not for"
- **Tablet (768-1199px):** 2-column grid for value props and agents. Stack "for/not for" vertically
- **Mobile (<768px):** Single column. Hero terminal becomes scrollable. Agent cards stack vertically. Navbar collapses to hamburger

---

## Tech Stack Recommendation

- **Static site** — no backend needed. Deploy on Vercel, Netlify, or GitHub Pages
- React + Vite (consistent with existing web dashboard) OR plain HTML + Tailwind for maximum simplicity
- Tailwind CSS 4 for styling (same as the existing dashboard)
- Framer Motion or native CSS animations for scroll-triggered fade-ins
- typed.js or custom implementation for terminal animation in hero

---

## Key Messaging Rules

1. **Lead with the outcome, not the tech.** "Wake up to pull requests" beats "AI-powered code generation"
2. **Respect developer intelligence.** No hype words like "revolutionary" or "10x." Be direct and honest about what it does and doesn't do
3. **Spec quality = output quality.** Subtly reinforce that Night Watch is as good as the specs you feed it
4. **Infrastructure, not magic.** Position as a tool/utility (like cron, CI, or a build system), not a sentient coding partner
5. **Trust is earned.** Emphasize configurability: review thresholds, auto-merge controls, dry-run mode, human override at every step

---

## Copy Alternatives for Hero

Option A (current recommendation):
> **Your repo's night shift.**
> Define work during the day. Night Watch executes overnight. Wake up to pull requests.

Option B:
> **Ship while you sleep.**
> Night Watch turns your specs into reviewed pull requests — overnight, automatically, safely.

Option C:
> **Async PRD execution for AI-native teams.**
> Queue specs. Night Watch implements, reviews, tests, and opens PRs while you're offline.

---

## Differentiation Points to Emphasize

These are what make Night Watch different from Cursor, Copilot, Devin, etc.:

1. **Async, not real-time** — you don't sit and watch it. It runs on cron while you sleep
2. **Spec-driven, not chat-driven** — structured inputs produce structured outputs
3. **Closed loop** — implement + review + test + merge is one pipeline, not separate tools
4. **Zero infrastructure** — npm install, local cron, local git. No hosted service to pay for
5. **You own everything** — runs on your machine, your repos, your API keys. No data leaves your control
6. **Open source (MIT)** — inspect, fork, extend. No vendor lock-in
