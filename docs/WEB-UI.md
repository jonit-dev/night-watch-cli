# Night Watch Web UI

> Related: [Server API](server-api.md) | [Architecture Overview](architecture-overview.md) | [DEV-ONBOARDING](DEV-ONBOARDING.md) | [CLI Package](cli-package.md)

## Global Layout

- **Sidebar** (collapsible, left): navigation + project selector
- **Top bar**: project name, connection status indicator (live/stale), global search, notification bell, settings gear
- **Main content area**: changes based on active page
- **Toast system**: bottom-right corner, stacks notifications with auto-dismiss

---

## Sidebar Navigation

| Icon | Label         | Route       |
| ---- | ------------- | ----------- |
| Home | Dashboard     | `/`         |
| File | PRDs          | `/prds`     |
| Git  | Pull Requests | `/prs`      |
| Play | Actions       | `/actions`  |
| Log  | Logs          | `/logs`     |
| Gear | Settings      | `/settings` |

- **Project selector** dropdown at the top of the sidebar (supports multiple projects)
- **Collapse toggle** at the bottom: full sidebar or icon-only rail
- Highlight active page, show badge counts on PRDs (pending) and PRs (needs work)

---

## 1. Dashboard (`/`)

The landing page. Overview of everything at a glance.

### Top row: 4 stat cards

| Card             | Value             | Subtitle / Detail                |
| ---------------- | ----------------- | -------------------------------- |
| PRDs Ready       | count             | "of {total} total"               |
| PRDs In Progress | count             | show PRD name if exactly 1       |
| Open PRs         | count             | "{n} need work" in warning color |
| Cron Status      | Active / Inactive | next run countdown if active     |

Each card is clickable and navigates to the relevant page.

### Middle row: 2 panels side by side

**Left panel: PRD Pipeline (kanban-style horizontal swim lanes)**

Four columns:

| Blocked | Ready | In Progress | Done |
| ------- | ----- | ----------- | ---- |

- Each PRD is a small card showing name and priority badge
- Blocked cards show unmet dependency names as red chips
- In-progress cards show a pulsing dot and elapsed time
- Done cards are greyed/muted
- Drag-and-drop disabled (read-only visualization)
- "View all" link to `/prds`

**Right panel: Recent Activity feed**

Chronological feed of events:

- PRD claimed / completed / failed / timed out
- PR opened / reviewed / merged
- Cron run started / finished
- Config changed

Each entry: icon + timestamp + one-line description + link to relevant entity.

### Bottom row: 2 panels side by side

**Left: Process Status**

| Process  | Status         | PID   | Uptime |
| -------- | -------------- | ----- | ------ |
| Executor | Running / Idle | 12345 | 3m 22s |
| Reviewer | Running / Idle | —     | —      |

- Running status shows a green dot, idle shows grey
- If running: show elapsed time, link to live log

**Right: Quick Actions**

Row of action buttons:

- **Run Executor** (play icon)
- **Run Reviewer** (magnifying glass icon)
- **Install Cron** (calendar icon)
- **Uninstall Cron** (calendar-off icon)

Each button shows a spinner while executing and a toast on completion/error. Destructive actions (uninstall) require a confirmation popover.

---

## 2. PRDs (`/prds`)

### Header bar

- Page title "PRDs"
- Filter chips: All | Ready | Blocked | In Progress | Done
- Sort dropdown: Priority (default) | Name | Date Created
- **+ New PRD** button (opens creation modal/drawer)

### PRD List (table or card grid, togglable)

**Table view columns:**

| #   | Name | Status | Priority | Dependencies | Created | Actions |
| --- | ---- | ------ | -------- | ------------ | ------- | ------- |

- Status is a colored badge (green=ready, yellow=in-progress, red=blocked, grey=done)
- Priority shows position number from `prdPriority` or "—" if unset
- Dependencies column shows chips; unmet deps in red, met deps in green
- Actions: kebab menu with View, Edit Priority, Delete, Move to Done

**Card view:** same data in a card layout, one card per PRD.

### PRD Detail (slide-over drawer or `/prds/:name`)

- Full PRD markdown rendered (with Mermaid diagram support)
- Sidebar metadata:
  - Status badge
  - Priority position (editable inline, drag handle or number input)
  - Dependencies list with met/unmet indicators
  - Claim info (hostname, PID, timestamp) if claimed
  - Linked PR (number, link) if exists
  - Created / Last modified dates
- Action buttons:
  - Run Now (claim and execute this PRD)
  - Move to Done (manual override)
  - Delete

### New PRD Modal

- **Name** text input (auto-slugified preview below)
- **Complexity** slider 1-10 (shows LOW/MEDIUM/HIGH label)
- **Phases** number stepper (1-5, default 3)
- **Dependencies** multi-select of existing PRDs
- **Custom template** file upload (optional)
- Preview pane showing rendered template
- Create button

### Priority Reordering

Accessible from the PRD list via a **"Reorder"** toggle button:

- Switches list to drag-and-drop mode
- Each row gets a drag handle
- Numbered positions update in real time
- "Save Order" / "Cancel" buttons appear at the top

---

## 3. Pull Requests (`/prs`)

### Header bar

- Page title "Pull Requests"
- Filter chips: All | Needs Work | Passing | Pending
- Branch pattern filter: dropdown or multi-select of configured patterns

### PR Table

| #   | Title | Branch | CI  | Review Score | Updated | Actions |
| --- | ----- | ------ | --- | ------------ | ------- | ------- |

- **#** links to GitHub PR
- **CI** column: icon + color (green check = pass, red X = fail, yellow spinner = pending, grey ? = unknown)
- **Review Score** column: progress bar 0-100 with number, colored (red < minReviewScore, green >= minReviewScore). Null shows "—"
- **Actions**: Review Now, View on GitHub (external link icon)

### PR Detail (slide-over drawer)

- PR title, number, branch, author
- CI Status section: list each check with name + status icon
- Review Score history: small sparkline or list of scores over time
- File changes summary: `+{additions} -{deletions}` across `{files}` files
- Body/description rendered as markdown
- Action buttons:
  - Trigger Review
  - View on GitHub

---

## 4. Actions (`/actions`)

Center-stage action controls with live feedback.

### Action Cards (grid of 4)

Each card has:

- Icon + title
- Description
- Primary action button
- "Last run" timestamp

| Card           | Button     | Description                                      |
| -------------- | ---------- | ------------------------------------------------ |
| Execute PRD    | Run Now    | Pick next eligible PRD and execute               |
| Review PRs     | Review Now | Check open PRs and fix issues                    |
| Install Cron   | Install    | Set up scheduled automation                      |
| Uninstall Cron | Uninstall  | Remove scheduled automation (confirmation req'd) |

### Live Output Panel (below cards)

- Appears when an action is running
- Terminal-style dark panel with monospace text
- Auto-scrolls, shows real-time log output
- Status indicator: Running (spinner) / Succeeded (green) / Failed (red) / Timed out (yellow)
- "Clear" button to dismiss

### Run History (below output panel)

Table of past action executions:

| Action | Status | Duration | PRD/PR | Timestamp |
| ------ | ------ | -------- | ------ | --------- |

- Clicking a row expands to show full log output inline

---

## 5. Logs (`/logs`)

### Header bar

- Page title "Logs"
- Toggle: Executor | Reviewer | Both (split view)
- Search/filter input (filters log lines in real time)
- **Auto-scroll** toggle (on by default)
- **Clear logs** button (confirmation required)
- Download button (exports log file)

### Log Viewer

- Full-height terminal-style panel, dark background, monospace font
- Line numbers on the left gutter
- Timestamps highlighted in a distinct color
- Error lines highlighted with red background
- Warning lines highlighted with yellow background
- "Follow" mode: auto-scrolls to bottom as new lines appear (like `tail -f`)
- Split view (when "Both" selected): two panels side by side, synced scrolling optional

### Log Stats (small bar above viewer)

- File size
- Line count
- Last updated timestamp
- Rotation indicator (shows if log was recently rotated)

---

## 6. Settings (`/settings`)

Tabbed settings page.

### Tab: General

| Field            | Input Type    | Notes                              |
| ---------------- | ------------- | ---------------------------------- |
| Project Name     | text          | read-only display                  |
| Provider         | select        | claude / codex                     |
| Default Branch   | text          | placeholder: "auto-detect"         |
| PRD Directory    | text          | relative path                      |
| Branch Prefix    | text          | default "night-watch"              |
| Branch Patterns  | tag input     | add/remove patterns (e.g. "feat/") |
| Reviewer Enabled | toggle switch |                                    |

### Tab: Runtime

| Field                | Input Type    | Notes                                |
| -------------------- | ------------- | ------------------------------------ |
| Max Runtime          | number + unit | seconds, show human-readable preview |
| Reviewer Max Runtime | number + unit | seconds, show human-readable preview |
| Min Review Score     | slider 0-100  | shows threshold line                 |
| Max Log Size         | number + unit | bytes, show KB/MB preview            |

### Tab: Schedules

Side-by-side panels for Executor and Reviewer.

Each panel:

- Cron expression text input with validation
- Human-readable description below (e.g. "Every hour from 9 AM to 5 PM, Monday through Friday")
- Preset buttons: Development | Production | Testing | Nightly
- Visual calendar/timeline showing when runs occur (24h strip with highlighted run times)
- "Apply" saves and reinstalls cron

### Tab: Notifications

**Webhook list** (card per webhook):

Each card shows:

- Type icon (Slack / Discord / Telegram)
- URL (masked, with reveal toggle) or bot token + chat ID
- Event chips: which events are subscribed
- Edit / Delete buttons

**+ Add Webhook** button opens a wizard:

1. **Type selection**: Slack | Discord | Telegram (card selector)
2. **Connection details**:
   - Slack/Discord: URL input with "Test" button
   - Telegram: Bot Token + Chat ID inputs with "Test" button
3. **Event selection**: checkboxes for each event
   - `run_succeeded`
   - `run_failed`
   - `run_timeout`
   - `review_completed`
4. Confirm and save

### Tab: Provider Environment

Key-value editor for `providerEnv`:

| Key               | Value        | Actions       |
| ----------------- | ------------ | ------------- |
| ANTHROPIC_API_KEY | •••••••••••• | Edit / Delete |
| API_TIMEOUT_MS    | 30000        | Edit / Delete |

- Values matching sensitive patterns (TOKEN, KEY, SECRET, PASSWORD) are masked with a reveal toggle
- **+ Add Variable** button: key input + value input
- **GLM-5 Quick Setup** button: auto-fills known GLM-5 env vars with placeholder values for the user to complete

### Tab: PRD Priority

- Drag-and-drop ordered list of all PRDs (pending + in-progress only)
- Each item shows PRD name + status badge
- Unranked PRDs appear in a separate "Unranked" section below, draggable into the ranked list
- "Save Order" button

### Settings Footer

- **Save** button (primary): persists all changes to config file
- **Reset** button (secondary): reverts to last saved state
- Unsaved changes indicator (dot on the Settings nav item)
- If schedule fields changed, saving triggers cron reinstall with a confirmation toast

---

## 7. Doctor / Health Check (`/settings` or dedicated modal)

Accessible via a "Run Health Check" button in Settings or a status bar icon.

### Health Check Results Panel

| Check             | Status                | Detail                  |
| ----------------- | --------------------- | ----------------------- |
| Git Repository    | Pass/Fail             | path                    |
| GitHub CLI (`gh`) | Pass/Fail             | version or error        |
| Provider CLI      | Pass/Fail             | which provider, version |
| PRD Directory     | Pass/Fail             | path, file count        |
| Webhooks          | Pass/Fail per webhook | URL validity, events    |
| Cron Installation | Pass/Fail             | entries found or not    |
| Lock Files        | Info                  | stale locks detected    |

- Each row: green check / red X / yellow warning icon
- Expand row for full diagnostic detail
- **Fix** button next to fixable issues (e.g. "Create PRD directory", "Install cron")
- Re-run button at the top

---

## 8. Notification Center

Accessible via the bell icon in the top bar.

### Dropdown Panel

- List of recent notifications (webhook events that fired)
- Each entry: event icon + title + timestamp + status (sent/failed)
- "Mark all read" button
- "View all" link to a full notification history page

### Full Notification History (`/notifications` or settings sub-page)

Table:

| Event | PRD/PR | Status | Webhook | Timestamp |
| ----- | ------ | ------ | ------- | --------- |

- Filterable by event type, webhook, status
- Expandable rows to see full payload sent

---

## Shared UI Patterns

### Confirmation Popovers

All destructive actions (delete PRD, uninstall cron, clear logs) show an inline popover: "Are you sure? This cannot be undone." with Cancel / Confirm buttons.

### Empty States

Every list/table has a friendly empty state:

- Icon illustration
- Short message ("No PRDs yet", "No open pull requests")
- CTA button where appropriate ("Create your first PRD")

### Loading States

- Skeleton loaders for cards and tables on initial load
- Spinners on action buttons while executing
- Progress indicators for long-running operations

### Responsive Behavior

- Sidebar collapses to icon rail on medium screens, becomes a hamburger menu on mobile
- Tables switch to card layouts on small screens
- Dashboard stat cards stack vertically on mobile
- Log viewer goes full-width on small screens

### Keyboard Shortcuts

Carry over from the TUI dashboard where applicable:

- `1-6` to switch pages
- `r` to refresh current view
- `/` to focus search
- `?` to show shortcut help overlay

### Real-time Updates

- Dashboard, PRD statuses, PR statuses, and process info should poll or use a websocket for live updates
- Stale data indicator if connection is lost (yellow banner at the top)
- Manual refresh button always available

### Dark / Light Theme

- Follow system preference by default
- Manual toggle in the top bar
- Terminal-style panels (logs, live output) always use dark theme regardless of global setting
