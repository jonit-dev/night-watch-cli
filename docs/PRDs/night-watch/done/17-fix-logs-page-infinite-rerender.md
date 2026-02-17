# PRD 17: Fix Logs Page Infinite Re-render & Flashing

**Status:** ready
**Complexity:** 2 → LOW mode
**Dependencies:** none

---

## 1. Context

**Problem:** The Logs page in the web UI enters an infinite re-render loop, causing constant flashing and continuous requests to the `/api/logs/executor` endpoint.

**Files Analyzed:**
- `web/api.ts` — `useApi` hook (root cause)
- `web/pages/Logs.tsx` — Logs page (triggers the bug)

**Current Behavior:**
- `Logs.tsx:17` passes an inline arrow function `() => fetchLogs(activeLog, 500)` to `useApi`
- `useApi` wraps it in `useCallback([fetchFn])` — since the inline fn is a new reference every render, `fetchData` is recreated every render
- `useEffect([...deps, fetchData, enabled])` fires on every render because `fetchData` changed
- Each fetch calls `setLoading(true)` + `setData()` → triggers re-render → new `fetchFn` → loop
- The polling `useEffect` in `Logs.tsx:42` also has `refetchLogs` (unstable) in deps → interval cleared/recreated every render
- `setLoading(true)` on every refetch replaces log content with "Loading logs..." → visual flashing

**Root Cause:** Unstable `fetchData` reference in `useApi` when consumers pass inline arrow functions.

## 2. Solution

**Approach:**
- Store `fetchFn` in a `useRef` so `refetch` callback is stable regardless of function identity
- Separate initial-fetch behavior (shows loading) from refetch behavior (silent, keeps existing data)
- Remove `fetchData` from the `useEffect` dependency array — only re-run on actual dependency changes

**Key Decisions:**
- Fix in `useApi` (not in Logs.tsx) so ALL consumers benefit and the same bug cannot recur
- `refetch` will NOT set `loading=true` — prevents flashing during polling
- Initial fetch and dependency changes will still show loading state

### Integration Points Checklist

- **How will this feature be reached?** Existing `useApi` hook — no new entry points
- **Is this user-facing?** YES — fixes visible UI bug (flashing, excessive network requests)
- **Full user flow:** User opens Logs page → logs load once → polling silently updates without flashing

---

## 3. Execution Phases

### Phase 1: Fix useApi hook — Stable refetch, no flashing on polling

**Files (2):**
- `web/api.ts` — Fix `useApi` hook
- `web/pages/Logs.tsx` — No changes needed (fix is in the hook)

**Implementation:**

- [ ] Add `useRef` to React imports in `web/api.ts`
- [ ] Replace `useCallback` for `fetchData` with a `useRef`-based stable `refetch` function that does NOT set `loading=true`
- [ ] Change the initial-fetch `useEffect` to call `fetchFnRef.current()` directly, with `setLoading(true)` and cancellation support
- [ ] Remove `fetchData` from the `useEffect` dependency array
- [ ] Return `refetch` (stable ref) instead of `fetchData`

**Verification Plan:**

1. **Unit Tests:**
   - File: `web/__tests__/api.test.ts` (or existing test file)
   - Test: Verify `refetch` identity is stable across renders
   - Test: Verify `loading` is only `true` on initial fetch, not on refetch

2. **Manual Verification:**
   - Open Logs page → should load once, no flashing
   - Network tab: requests should occur every 3s (polling), not continuously
   - Switch between executor/reviewer tabs → should trigger single fresh load
   - Pause auto-scroll → polling stops, no requests
   - Resume → polling resumes at 3s interval

3. **Evidence Required:**
   - [ ] `yarn verify` passes
   - [ ] No infinite network requests in browser devtools
   - [ ] Log content stays visible during polling (no "Loading logs..." flash)

**Acceptance Criteria:**
- [ ] Logs page loads without infinite re-rendering
- [ ] Polling occurs at 3-second intervals (not continuously)
- [ ] Log content does not flash/disappear during polling refetches
- [ ] `yarn verify` passes
- [ ] Other pages using `useApi` with polling (Scheduling, Roadmap) also benefit from fix
