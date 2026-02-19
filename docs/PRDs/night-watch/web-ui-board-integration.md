# PRD: Web UI Board Integration

**Complexity: 6 → MEDIUM mode**

---

## 1. Context

**Problem:** The GitHub Projects board is now the primary workflow driver for Night Watch, but the web UI has no awareness of it. Users must use the CLI (`night-watch board status`, `night-watch board move-issue`, etc.) to manage board issues. There is no visual way to see what's in progress, move issues, or create new PRDs from the UI.

**Current state:**
- `GET /api/prds` — lists filesystem PRDs only, unaware of board
- `web/pages/PRDs.tsx` — shows filesystem-based PRDs, no board column info
- Dashboard — no board summary widget
- No API endpoints for board operations

**Goal:** Add a Board page and board-aware API endpoints so users can fully manage their GitHub Projects board from the web UI.

---

## 2. Solution

### API Layer (Backend)

Add board endpoints to `src/server/index.ts` (and the multi-project router):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/board/status` | Board enabled flag + all issues grouped by column |
| `GET` | `/api/board/issues` | Flat list of all board issues |
| `POST` | `/api/board/issues` | Create a new issue (title + body + column) |
| `PATCH` | `/api/board/issues/:number/move` | Move issue to a column |
| `POST` | `/api/board/issues/:number/comment` | Add a comment |
| `DELETE` | `/api/board/issues/:number` | Close an issue |

All endpoints return `{ error: "Board not configured" }` with 404 when `boardProvider.projectNumber` is missing from config.

### New Page: Board (`web/pages/Board.tsx`)

A Kanban-style board view with 5 columns: **Draft → Ready → In Progress → Review → Done**.

- Each column shows its issues as cards (number, title, assignees)
- Click a card to expand the full issue body (PRD markdown rendered)
- **Move button** on each card to select target column
- **+ New Issue** button in column header to create a new issue (opens modal)
- Empty state: "No issues in this column"
- Board disabled state: "Board not configured — run `night-watch board setup`"
- Auto-refreshes every 30s via polling

### Dashboard Widget

Add a "Board" widget row to `web/pages/Dashboard.tsx`:
- Shows issue count per column as colored badges
- Shows "Board not configured" if disabled
- Clicking a column count navigates to Board page filtered to that column

### Navigation

Add "Board" link to `web/App.tsx` nav alongside PRDs, PRs, Logs, etc.

---

## 3. Execution Phases

### Phase 1: Backend — Board API endpoints

**User-visible outcome:** REST API available for all board operations.

**Files:**
- `src/server/index.ts` — add board route handlers
- `src/server/actions.ts` (or inline) — board action implementations

**Implementation:**

- [ ] Import `createBoardProvider` and `loadConfig` in server
- [ ] Helper `getBoardProvider(config, projectDir)` — returns provider or throws if not configured
- [ ] `GET /api/board/status`:
  ```ts
  const provider = getBoardProvider(config, projectDir);
  const issues = await provider.getAllIssues();
  // Group by column
  const grouped = { Draft: [], Ready: [], "In Progress": [], Review: [], Done: [] };
  for (const issue of issues) grouped[issue.column ?? "Draft"].push(issue);
  res.json({ enabled: true, columns: grouped });
  ```
- [ ] `GET /api/board/issues` — `provider.getAllIssues()`
- [ ] `POST /api/board/issues` — `provider.createIssue({ title, body, column })`
- [ ] `PATCH /api/board/issues/:number/move` — `provider.moveIssue(number, column)`
- [ ] `POST /api/board/issues/:number/comment` — `provider.commentOnIssue(number, body)`
- [ ] `DELETE /api/board/issues/:number` — `provider.closeIssue(number)`
- [ ] Register all routes in both single-project (`app.*`) and multi-project (`router.*`) handlers
- [ ] Error handling: 404 when board not configured, 500 for API failures

**Verification:**
- [ ] `yarn verify` passes
- [ ] `yarn test` — add unit tests for board endpoints in `src/__tests__/server.test.ts`

---

### Phase 2: Frontend — Board page

**User-visible outcome:** `/board` route shows Kanban board with issues.

**Files:**
- `web/pages/Board.tsx` — new Kanban page
- `web/api.ts` — add board API client functions
- `web/App.tsx` — add `/board` route and nav link
- `web/types.ts` — add `IBoardIssue`, `IBoardStatus` types

**Implementation:**

`web/api.ts` additions:
```ts
export async function fetchBoardStatus(): Promise<IBoardStatus>
export async function createBoardIssue(input: ICreateIssueInput): Promise<IBoardIssue>
export async function moveBoardIssue(number: number, column: BoardColumnName): Promise<void>
export async function commentBoardIssue(number: number, body: string): Promise<void>
export async function closeBoardIssue(number: number): Promise<void>
```

`web/pages/Board.tsx`:
- State: `status: IBoardStatus | null`, `loading: boolean`, `selectedIssue: IBoardIssue | null`
- Columns rendered side by side with overflow scroll
- Each issue card: `#N — Title`, column badge, move dropdown
- Issue detail panel (slide-in or modal): full body rendered as markdown (`react-markdown`)
- Create issue modal: title input + body textarea + column selector
- 30s polling with `useEffect` + `setInterval`
- Loading skeleton while fetching

`web/App.tsx`:
```tsx
<Route path="/board" element={<Board />} />
// Nav: <Link to="/board">Board</Link>
```

**Verification:**
- [ ] `yarn verify` passes
- [ ] `cd web && yarn build` succeeds
- [ ] Board page renders without errors when board is configured
- [ ] Board page shows "not configured" message when `boardProvider.projectNumber` is absent

---

### Phase 3: Dashboard widget + PRDs page badge

**User-visible outcome:** Dashboard shows board summary; PRDs page indicates board-linked issues.

**Files:**
- `web/pages/Dashboard.tsx` — add board widget
- `web/pages/PRDs.tsx` — add board column badge when issue exists

**Implementation:**

Dashboard board widget (add after existing widgets):
```tsx
<BoardWidget status={boardStatus} onNavigate={() => navigate("/board")} />
```
- Shows 5 column counts as colored badges
- "Board not configured" fallback
- Fetches via `fetchBoardStatus()` on mount

PRDs page — for each filesystem PRD, if a board issue with matching title exists, show a badge with its column and link to the issue URL.

**Verification:**
- [ ] Dashboard shows board widget with correct counts
- [ ] Clicking a column count navigates to `/board`
- [ ] `yarn verify` + `cd web && yarn build` pass

---

## 4. Acceptance Criteria

- [ ] `GET /api/board/status` returns issues grouped by column
- [ ] `POST /api/board/issues` creates a new GitHub issue on the board
- [ ] `PATCH /api/board/issues/:number/move` moves the issue column
- [ ] Board page at `/board` shows Kanban layout with all 5 columns
- [ ] Issues display number, title, and current column
- [ ] Clicking an issue shows the full PRD body
- [ ] Move dropdown lets user move an issue to any column
- [ ] Create Issue button opens a modal and creates the issue on submit
- [ ] Dashboard board widget shows per-column counts
- [ ] All endpoints work in both single-project and multi-project server modes
- [ ] Board disabled state handled gracefully in UI and API
- [ ] `yarn verify` passes
- [ ] `cd web && yarn build` passes
- [ ] New server tests cover board endpoints
