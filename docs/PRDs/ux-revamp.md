# PRD: Web UI UX Revamp

**Complexity: 7 → HIGH mode**

Score breakdown: +3 (10+ files) +2 (new components) +2 (complex state/real-time data)

---

## 1. Context

**Problem:** The Dashboard is overwhelming (too many widgets, duplicate info) and the Scheduling page is hard to understand (5 tabs with unclear purpose distinctions).

**Files Analyzed:**

- `web/pages/Dashboard.tsx`
- `web/pages/Scheduling.tsx`
- `web/pages/Logs.tsx`
- `web/components/Sidebar.tsx`
- `web/components/TopBar.tsx`
- `web/App.tsx`
- `web/components/scheduling/ScheduleConfig.tsx`
- `web/components/scheduling/ScheduleTimeline.tsx`
- `web/components/dashboard/AgentStatusBar.tsx`
- `web/store/useStore.ts`
- `web/hooks/useStatusSync.ts`
- `web/components/ui/{Button,Card,Badge,Tabs,Switch}.tsx`

**Current Behavior (as of 2026-03-21):**

- Dashboard: 4 stat cards + AgentStatusBar (compact 6-agent grid) + next automation teaser + GitHub Board widget — already cleaned up
- Scheduling: 5-tab layout (Overview, Schedules, Crontab, Parallelism, individual job tabs) — still complex and hard to navigate
- Sidebar: section labels (Overview / Work / Automation / Config) — already grouped
- TopBar: Bell icon with red dot but no implementation behind it; no Settings icon — mostly clean
- Shared state: `useStatusSync` in `App.tsx` writes to Zustand store; all pages read from store — already unified
- Logs: reads `status` from store, independent log polling — correct

---

## 2. Completed Phases

### ✅ Phase 0: Shared status state

- `useStatusSync` hook exists at `web/hooks/useStatusSync.ts`
- `status: IStatusSnapshot | null` in `web/store/useStore.ts`
- `useStatusSync()` called in `App.tsx` — single SSE subscription app-wide
- Dashboard and Logs both read from store

### ✅ Phase 1: Dashboard Cleanup

- 4 stat cards: Board Ready, In Progress, Open PRs, Automation Status
- `AgentStatusBar` (`web/components/dashboard/AgentStatusBar.tsx`) — 6-agent compact grid
- "System Status" card removed
- "Scheduling summary" card removed
- "Next automation" teaser line added

### ✅ Phase 3: Sidebar Navigation Grouping

- Section labels: OVERVIEW / WORK / AUTOMATION / CONFIG
- Labels hidden when collapsed, visible when expanded
- "Scheduling" nav item present under AUTOMATION

### ✅ Phase 4: TopBar Cleanup

- Settings icon already removed from TopBar
- Bell icon present (no Settings duplication)

---

## 3. Remaining Work

---

### Phase 2 (Incomplete): Flatten Scheduling Page

**Status:** `ScheduleConfig` component extracted ✅ — but `Scheduling.tsx` still uses 5 tabs ❌

**Problem:** Scheduling has tabs: Overview, Schedules, Crontab, Parallelism, plus per-job sub-tabs. "Overview" and "Schedules" are still confusing. "Crontab" and "Parallelism" are obscure labels for advanced config that buries the primary use case (seeing what runs when).

**Files (max 4):**

- `web/pages/Scheduling.tsx` — replace Tabs with flat scrollable sections

**Implementation:**

Delete the `<Tabs>` component and `activeTab` state. New flat page structure:

```
Section A: Global Controls
  [Automation: Active/Paused]  [Schedule bundle name]  [Pause/Resume button]

Section B: Agent Schedule Cards
  6 cards (2-col grid): icon + name + Switch toggle + "every 3h" desc + next run countdown + start delay badge

Section C: Configure Schedules  ← was hidden in "Schedules" tab
  <ScheduleConfig /> with template picker / custom cron inputs
  [Save & Install] button

Section D: Cron Entries  ← was "Crontab" tab
  Installed crontab entries table (collapsible, default collapsed)
  Enable/disable/remove per entry

Section E: Parallelism & Queue  ← was "Parallelism" tab
  Queue mode (Auto/Manual), global max concurrency, provider buckets
  (collapsible, default collapsed)
```

- [ ] Remove `activeTab` state and `<Tabs>` import
- [ ] Move Overview tab content → inline Sections A + B
- [ ] Move Schedules tab content → Section C (already has `<ScheduleConfig />`)
- [ ] Move Crontab tab content → Section D (collapsible `<details>` or state toggle)
- [ ] Move Parallelism tab content → Section E (collapsible)
- [ ] Replace `navigate('/settings?tab=schedules...')` redirect with `scrollIntoView` to Section C anchor
- [ ] `expandedCrontab` + `expandedParallelism` local state (default `false`) for collapsible sections
- [ ] `ScheduleTimeline` moves into Section B as a visual beneath the agent cards

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `web/src/__tests__/Scheduling.test.tsx` | `renders all 6 agent cards without tabs` | 6 agent name elements, no Tabs component |
| `web/src/__tests__/Scheduling.test.tsx` | `ScheduleConfig section visible without clicking tabs` | Schedule config rendered directly |
| `web/src/__tests__/Scheduling.test.tsx` | `crontab section collapsed by default` | Crontab entries not visible initially |
| `web/src/__tests__/Scheduling.test.tsx` | `expanding crontab section shows entries` | Entries visible after expand click |

**User Verification:**

- Action: Open `/scheduling`
- Expected: No tabs. Scroll down past agents → see "Configure Schedules" inline. Crontab and Parallelism are collapsed advanced sections at the bottom. No redirect to Settings needed.

**Checkpoint:** Run `prd-work-reviewer` after this phase.

---

### Phase 5: Command Palette (Cmd+K)

**Why:** Power users trigger agents, navigate pages, and manage schedules frequently. Every action currently requires 2–4 clicks through the UI. A command palette eliminates navigation overhead and makes the tool feel fast.

**Files (max 5):**

- `web/components/CommandPalette.tsx` — new component
- `web/hooks/useCommandPalette.ts` — keyboard shortcut registration + open/close state
- `web/App.tsx` — render `<CommandPalette />` at root + `useCommandPalette()`
- `web/store/useStore.ts` — add `commandPaletteOpen: boolean` + `setCommandPaletteOpen`

**Component design:**

```
┌─────────────────────────────────────────────────┐
│  🔍 Search commands or navigate...               │
├─────────────────────────────────────────────────┤
│  ── NAVIGATE ──                                  │
│  → Dashboard                            ⌘1      │
│  → Logs                                 ⌘2      │
│  → Board                                ⌘3      │
│  → Scheduling                           ⌘4      │
│  → Settings                             ⌘,      │
├─────────────────────────────────────────────────┤
│  ── AGENTS ──                                    │
│  ▶ Run Executor          [only if idle]          │
│  ■ Stop Executor         [only if running]       │
│  ▶ Run Reviewer                                  │
│  ▶ Run QA                                        │
│  ▶ Run Auditor                                   │
│  ▶ Run Planner                                   │
├─────────────────────────────────────────────────┤
│  ── SCHEDULING ──                                │
│  ⏸ Pause Automation      [only if active]        │
│  ▶ Resume Automation     [only if paused]        │
└─────────────────────────────────────────────────┘
```

**Implementation:**

- [ ] `useCommandPalette.ts`: registers `keydown` listener for `Cmd+K` / `Ctrl+K`; writes `commandPaletteOpen` to store
- [ ] `CommandPalette.tsx`: modal overlay (semi-transparent backdrop), search input, grouped command list
  - Filter commands by search term (fuzzy or substring match)
  - Keyboard navigation: `↑`/`↓` to move, `Enter` to execute, `Esc` to close
  - Commands: navigate (uses `useNavigate`), trigger agent (calls `triggerJob` API), toggle automation
  - Agent trigger commands conditionally shown based on `useStore(s => s.status)` — only show "Run X" if X is idle
- [ ] `App.tsx`: add `<CommandPalette />` after routes, call `useCommandPalette()`
- [ ] `useStore.ts`: add `commandPaletteOpen` + `setCommandPaletteOpen` to store

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `web/src/__tests__/CommandPalette.test.tsx` | `opens on Cmd+K` | Palette visible after keydown event |
| `web/src/__tests__/CommandPalette.test.tsx` | `closes on Escape` | Palette hidden after Escape |
| `web/src/__tests__/CommandPalette.test.tsx` | `filters commands by search term` | Only matching commands shown |
| `web/src/__tests__/CommandPalette.test.tsx` | `navigates to page on Enter` | navigate called with correct path |
| `web/src/__tests__/CommandPalette.test.tsx` | `shows Run agent only when idle` | Run command absent when process running |

**User Verification:**

- Action: Press `Cmd+K` on any page
- Expected: Palette opens. Type "exec" → "Run Executor" appears. Press Enter → executor triggered. Press Escape → closes.

**Checkpoint:** Run `prd-work-reviewer` after this phase.

---

### Phase 6: Notification / Activity Center

**Why:** The TopBar Bell icon has a red dot but no implementation. Users have no way to see what happened recently (which PRDs ran, which failed, when schedules last fired) without digging through Logs. An activity feed surfaces this at a glance.

**Files (max 5):**

- `web/components/ActivityCenter.tsx` — slide-out panel
- `web/hooks/useActivityFeed.ts` — assembles activity events from status + logs API
- `web/components/TopBar.tsx` — wire Bell button to open panel
- `web/store/useStore.ts` — add `activityCenterOpen: boolean` + `setActivityCenterOpen`

**Activity event types (derive from existing data, no new API needed):**

```ts
type IActivityEvent =
  | { type: 'agent_completed'; agent: string; duration: string; prd?: string; ts: Date }
  | { type: 'agent_failed'; agent: string; error: string; ts: Date }
  | { type: 'schedule_fired'; agent: string; ts: Date }
  | { type: 'automation_paused' | 'automation_resumed'; ts: Date }
  | { type: 'pr_opened'; number: number; title: string; ts: Date };
```

**Panel design (slide-out from right, 360px wide):**

```
┌─ Activity ─────────────────── [×] ─┐
│ Today                               │
│ ● Executor completed  PRD-42  2m ago│
│ ● PR #18 opened              5m ago │
│ ● Reviewer completed        12m ago │
│ ─ Yesterday ─                       │
│ ● Automation paused         3h ago  │
│ ● QA failed: exit code 1    5h ago  │
└────────────────────────────────────┘
```

**Implementation:**

- [ ] `useStore.ts`: add `activityCenterOpen` + `setActivityCenterOpen`
- [ ] `useActivityFeed.ts`: builds `IActivityEvent[]` by watching `status` changes in store (compare previous vs next — if a process transitions running→idle, it "completed") + fetching recent log entries on mount
- [ ] `ActivityCenter.tsx`: fixed right-side panel, `translate-x-full` when closed, `translate-x-0` when open; grouped by day; each event is an icon + description + relative time
- [ ] `TopBar.tsx`: Bell button calls `setActivityCenterOpen(true)`; red dot shows only when `activityEvents.length > 0` and panel is closed (i.e., unread events)
- [ ] Clear unread count when panel is opened

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `web/src/__tests__/ActivityCenter.test.tsx` | `slides in when open` | Panel has translate-x-0 class |
| `web/src/__tests__/ActivityCenter.test.tsx` | `shows completed event when process transitions running→idle` | Completed event rendered |
| `web/src/__tests__/ActivityCenter.test.tsx` | `bell dot hidden when panel open` | Red dot not visible with panel open |

**User Verification:**

- Action: Click the Bell icon
- Expected: Right panel slides in showing recent agent completions and PR events. Bell dot disappears after opening.

**Checkpoint:** Run `prd-work-reviewer` after this phase.

---

### Phase 7: Log Page UX — Filter Bar + Agent Tabs

**Why:** Logs page currently shows a raw log dump with no way to filter by agent. When multiple agents run, logs interleave and become hard to read. Users must manually scan for the agent they care about.

**Files (max 4):**

- `web/pages/Logs.tsx` — add filter bar + per-agent view
- `web/components/logs/LogFilterBar.tsx` — new component

**Implementation:**

- [ ] `LogFilterBar.tsx`: horizontal pill bar showing all 6 agents + "All" option
  - Active pill: filled background (agent color); inactive: ghost
  - When an agent is "running" (from store status), show a pulsing green dot on its pill
  - Second row: search input (filter lines containing text) + "Errors only" toggle

- [ ] `Logs.tsx` changes:
  - Add `selectedAgent: string | null` state (null = "All")
  - Add `searchTerm: string` state
  - Add `errorsOnly: boolean` state
  - Filter `logLines` before render: by agent prefix (log lines are prefixed with `[executor]`, `[reviewer]` etc.), by `searchTerm`, by error keywords if `errorsOnly`
  - Render `<LogFilterBar>` above the log output
  - Keep existing auto-scroll behavior

- [ ] Log line parsing: each line starts with `[agent-name]` prefix — extract agent name from this prefix to drive per-agent filtering (no API change needed)

**Result layout:**

```
[All] [Executor ●] [Reviewer] [QA] [Auditor] [Planner] [Analytics]
🔍 Search logs...                              [Errors only ○]
─────────────────────────────────────────────────────────
2026-03-21 14:32:01 [executor] Starting PRD execution...
2026-03-21 14:32:05 [executor] Reading board...
```

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `web/src/__tests__/LogFilterBar.test.tsx` | `renders all 6 agent pills plus All` | 7 pills visible |
| `web/src/__tests__/LogFilterBar.test.tsx` | `shows running dot on active agent pill` | Pulse element present for running agent |
| `web/src/__tests__/Logs.test.tsx` | `filters log lines by selected agent` | Only executor lines shown when executor pill active |
| `web/src/__tests__/Logs.test.tsx` | `filters by search term` | Only matching lines shown |
| `web/src/__tests__/Logs.test.tsx` | `errors only toggle filters non-error lines` | Only error lines shown |

**User Verification:**

- Action: Open `/logs`, click "Executor" pill
- Expected: Only lines prefixed with `[executor]` shown. Other agents' lines hidden. Running agent has a pulsing dot on its pill.

**Checkpoint:** Run `prd-work-reviewer` after this phase.

---

## 4. Integration Points

```
Entry points: existing routes (/, /scheduling, /logs, sidebar, TopBar bell)
No new routes needed
No new API surface needed (all data derived from existing status + logs APIs)
User-facing: YES — all changes are visual
```

---

## 5. Verification Strategy

Each phase: `yarn verify` + phase-specific tests + `prd-work-reviewer` checkpoint.

```bash
cd /home/joao/projects/night-watch-cli
yarn verify
yarn workspace night-watch-web test --run
```

---

## 6. Acceptance Criteria

### Original phases (all complete)

- [x] Phase 0: Single SSE subscription; `status` in Zustand; Dashboard + Logs read from store
- [x] Phase 1: Dashboard has no "System Status" or "Scheduling summary" card; AgentStatusBar is compact
- [x] Phase 3: Sidebar shows section labels (OVERVIEW / WORK / AUTOMATION / CONFIG)
- [x] Phase 4: TopBar Settings icon removed

### Remaining

- [ ] Phase 2: Scheduling page has no Tabs; flat scroll layout with collapsible advanced sections
- [ ] Phase 5: `Cmd+K` opens command palette; can trigger agents + navigate without mouse
- [ ] Phase 6: Bell icon opens Activity Center slide-out with recent agent completions
- [ ] Phase 7: Logs page has agent filter pills + search bar + errors-only toggle
- [ ] All `yarn verify` passes after each phase
- [ ] All specified tests pass
- [ ] No regressions: process start/stop/cancel, schedule edit, job toggle, SSE streaming all still work
