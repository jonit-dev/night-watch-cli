# PRD: Fix CI Status and Review Score in Pull Requests Web UI

**Status:** ready
**Complexity:** 4 → LOW mode
**Dependencies:** none

---

## 1. Context

**Problem:** The CI status and review score columns in the Pull Requests web UI page are not working correctly. Users see "unknown" for CI status and "null" (dash) for review scores, even when PRs have actual CI check results and review decisions.

**Files Analyzed:**

- `web/pages/PRs.tsx` — React component displaying PR list with CI status and review score columns
- `web/api.ts` — API client with `fetchPrs()` function and `PrInfo` type
- `src/server/index.ts` — Express server with `/api/prs` endpoint handler
- `src/utils/status-data.ts` — Core data layer with `collectPrInfo()`, `deriveCiStatus()`, `deriveReviewScore()`
- `src/commands/prs.ts` — CLI command that also uses `collectPrInfo()`
- `src/__tests__/utils/status-data.test.ts` — Tests for CI status derivation
- `src/__tests__/commands/prs.test.ts` — Tests for PRs command

**Current Behavior:**

1. The `/api/prs` endpoint calls `collectPrInfo()` which uses the `gh pr list` CLI command
2. The `gh pr list` command requests `statusCheckRollup` and `reviewDecision` fields
3. `deriveCiStatus()` processes `statusCheckRollup` array to determine `pass`, `fail`, `pending`, or `unknown`
4. `deriveReviewScore()` converts `reviewDecision` to a numeric score (100 for APPROVED, 0 for CHANGES_REQUESTED, null otherwise)
5. The web UI displays this data in the PRs table

**Root Cause Analysis:**

After analyzing the code flow, the logic appears correct but there may be issues with:

1. **GitHub API field structure changes**: The `statusCheckRollup` field structure has evolved in the GitHub GraphQL API. The current code handles both `CheckRun` format (with `status` and `conclusion`) and `StatusContext` format (with `state`), but GitHub may return nested structures or additional fields.

2. **Empty/null handling**: When `statusCheckRollup` is an empty array or null, the function returns "unknown", which may not be the desired behavior for PRs with no CI configured.

3. **Review decision null handling**: The `reviewDecision` field can be `null`, `undefined`, or an empty string in various scenarios (no reviews required, reviews not configured, etc.).

4. **Field mapping mismatch**: The gh CLI field names may differ from what the code expects (case sensitivity, nested objects).

**Integration Points Checklist**

- **How will this feature be reached?** Web UI PRs page (`/prs` route)
- **Is this user-facing?** YES — users need to see CI status and review scores to make informed decisions
- **Full user flow:** User opens PRs page → sees list of open PRs with CI status icons and review score bars → can filter by "Needs Work", "Pending", or "Passed" status

---

## 2. Solution

**Approach:**

1. **Debug and validate the actual gh CLI output**: Create a diagnostic mode to log the raw `statusCheckRollup` and `reviewDecision` data structure
2. **Add robust null/undefined handling**: Ensure all edge cases are handled (null, undefined, empty, nested objects)
3. **Add detailed logging**: Log when data parsing fails to aid debugging
4. **Enhance the status derivation logic**: Handle additional GitHub API response formats
5. **Add unit tests for edge cases**: Test various API response formats

**Key Decisions:**

- Fix in the backend (`status-data.ts`) rather than frontend — the data should be correct at the source
- Add optional debug logging that can be enabled via environment variable for troubleshooting
- Return more granular status information (e.g., distinguish "no CI" from "CI pending")
- Keep backward compatibility with existing API response format

**Data Flow:**

```
gh pr list --json statusCheckRollup,reviewDecision
  |
  v
collectPrInfo() [src/utils/status-data.ts]
  |
  v
deriveCiStatus(statusCheckRollup) -> 'pass' | 'fail' | 'pending' | 'unknown'
deriveReviewScore(reviewDecision) -> 0-100 | null
  |
  v
/api/prs endpoint [src/server/index.ts]
  |
  v
web/api.ts fetchPrs()
  |
  v
web/pages/PRs.tsx renders CI status icon and review score bar
```

---

## 3. Execution Phases

### Phase 1: Diagnose the actual GitHub API response format

**User-visible outcome:** A debug mode that logs the raw gh CLI output to help identify the exact structure of `statusCheckRollup` and `reviewDecision` fields.

**Files (2):**

- `src/utils/status-data.ts` — Add debug logging for raw API responses
- `src/commands/prs.ts` — Add `--debug` flag to enable diagnostic output

**Implementation:**

- [ ] Add `DEBUG_PR_DATA` environment variable check in `collectPrInfo()`
- [ ] When debug mode is enabled, log the raw JSON output from `gh pr list`
- [ ] Log the parsed `statusCheckRollup` and `reviewDecision` for each PR
- [ ] Add `--debug` flag to `prs` command that sets `DEBUG_PR_DATA=1`

**Verification Plan:**

1. **Manual Verification:**
   ```bash
   # Run with debug mode
   DEBUG_PR_DATA=1 night-watch prs --json

   # Expected: Console shows raw gh CLI output with statusCheckRollup structure
   ```

2. **Evidence Required:**
   - [ ] Debug output shows actual GitHub API response structure
   - [ ] Identify any discrepancies between expected and actual field names

---

### Phase 2: Fix CI status derivation logic

**User-visible outcome:** CI status column shows correct values (pass/fail/pending) based on actual GitHub check status.

**Files (3):**

- `src/utils/status-data.ts` — Fix `deriveCiStatus()` function
- `src/__tests__/utils/status-data.test.ts` — Add tests for edge cases
- `src/__tests__/commands/prs.test.ts` — Add tests for CI status scenarios

**Implementation:**

- [ ] Update `deriveCiStatus()` to handle nested `statusCheckRollup` structures:
  - Handle case where checks are wrapped in a `contexts` array
  - Handle case where each check has `conclusion` at top level OR nested in `status` object
  - Handle GitHub Actions workflow runs vs legacy status checks
- [ ] Add support for additional conclusion values:
  - `ACTION_REQUIRED` — needs user action
  - `NEUTRAL` — check passed but not required
  - `SKIPPED` — check was skipped
- [ ] Improve the "unknown" case to distinguish:
  - No CI configured (empty array) → could return "none" or "unknown"
  - CI data unavailable → "unknown"
- [ ] Add comprehensive logging when parsing fails
- [ ] Add unit tests for:
  - Empty `statusCheckRollup` array
  - Null/undefined `statusCheckRollup`
  - Nested context structures
  - Mixed CheckRun and StatusContext formats
  - All conclusion types

**Verification Plan:**

1. **Unit Tests:**
   ```typescript
   // Test cases to add
   describe("deriveCiStatus", () => {
     it("returns 'unknown' for null checks")
     it("returns 'unknown' for empty checks array")
     it("returns 'pass' for SUCCESS conclusion")
     it("returns 'fail' for FAILURE conclusion")
     it("returns 'fail' for ERROR conclusion")
     it("returns 'fail' for CANCELLED conclusion")
     it("returns 'fail' for TIMED_OUT conclusion")
     it("returns 'pending' for IN_PROGRESS status")
     it("returns 'pending' for QUEUED status")
     it("returns 'pending' for PENDING state")
     it("returns 'pass' for NEUTRAL conclusion")
     it("returns 'unknown' for SKIPPED conclusion (edge case)")
     it("handles StatusContext format with state field")
     it("handles CheckRun format with status + conclusion")
     it("handles mixed CheckRun and StatusContext formats")
     it("handles nested contexts array structure")
   })
   ```

2. **API Proof:**
   ```bash
   # Start server
   night-watch serve

   # Get PRs with CI status
   curl http://localhost:7575/api/prs | jq '.[] | {number, ciStatus}'

   # Expected: Real CI status values (not all "unknown")
   ```

3. **Evidence Required:**
   - [ ] `yarn verify` passes
   - [ ] All new unit tests pass
   - [ ] Manual test with real PRs shows correct CI status

---

### Phase 3: Fix review score derivation logic

**User-visible outcome:** Review score column shows correct values (100 for approved, 0 for changes requested, dash for pending).

**Files (3):**

- `src/utils/status-data.ts` — Fix `deriveReviewScore()` function
- `src/__tests__/utils/status-data.test.ts` — Add tests for edge cases
- `src/__tests__/commands/prs.test.ts` — Add tests for review score scenarios

**Implementation:**

- [ ] Update `deriveReviewScore()` to handle all edge cases:
  - `null` → return null (no review yet)
  - `undefined` → return null (field not present)
  - `""` (empty string) → return null (no review)
  - `"APPROVED"` → return 100
  - `"CHANGES_REQUESTED"` → return 0
  - `"REVIEW_REQUIRED"` → return null (needs review but hasn't been reviewed)
- [ ] Add case-insensitive matching to handle potential API changes
- [ ] Add logging when review decision cannot be parsed
- [ ] Consider adding support for partial scores based on number of approving vs requesting changes reviews
- [ ] Add unit tests for all edge cases

**Verification Plan:**

1. **Unit Tests:**
   ```typescript
   describe("deriveReviewScore", () => {
     it("returns 100 for APPROVED")
     it("returns 0 for CHANGES_REQUESTED")
     it("returns null for REVIEW_REQUIRED")
     it("returns null for null input")
     it("returns null for undefined input")
     it("returns null for empty string")
     it("handles lowercase values")
     it("handles mixed case values")
   })
   ```

2. **API Proof:**
   ```bash
   curl http://localhost:7575/api/prs | jq '.[] | {number, reviewScore}'
   # Expected: Real review scores (100, 0, or null based on actual reviews)
   ```

3. **Evidence Required:**
   - [ ] `yarn verify` passes
   - [ ] All new unit tests pass
   - [ ] Manual test with real PRs shows correct review scores

---

### Phase 4: Enhance Web UI display

**User-visible outcome:** PRs page shows meaningful status indicators with proper fallbacks and tooltips.

**Files (1):**

- `web/pages/PRs.tsx` — Enhance UI feedback for status display

**Implementation:**

- [ ] Add tooltip to CI status icon explaining the status
- [ ] Add tooltip to review score bar explaining the score meaning
- [ ] Improve the "unknown" state display (e.g., gray question mark with tooltip "No CI data available")
- [ ] Add visual distinction between "no CI configured" and "CI pending"
- [ ] Ensure filter buttons work correctly with all status values
- [ ] Add accessibility labels for status icons

**Verification Plan:**

1. **Manual Verification:**
   - Hover over CI status icon → tooltip explains status
   - Hover over review score bar → tooltip explains score
   - Filter by "Needs Work" → shows failed CI and changes requested
   - Filter by "Pending" → shows pending CI and null reviews
   - Filter by "Passed" → shows passed CI and approved reviews

2. **Evidence Required:**
   - [ ] `cd web && yarn build` succeeds
   - [ ] All filter combinations work correctly
   - [ ] Tooltips display helpful information

---

### Phase 5: Integration testing and documentation

**User-visible outcome:** Complete test coverage and documentation for the CI status and review score feature.

**Files (2):**

- `src/__tests__/server.test.ts` — Add API endpoint tests for `/api/prs`
- `docs/WEB-UI.md` — Update documentation if needed

**Implementation:**

- [ ] Add integration tests for `/api/prs` endpoint
- [ ] Test with mock gh CLI responses
- [ ] Document the CI status and review score derivation logic
- [ ] Add troubleshooting section for common issues

**Verification Plan:**

1. **Integration Tests:**
   ```typescript
   describe("GET /api/prs", () => {
     it("returns empty array when no PRs")
     it("returns PRs with CI status and review scores")
     it("handles gh CLI not available")
     it("handles gh CLI errors gracefully")
   })
   ```

2. **Evidence Required:**
   - [ ] `yarn verify` passes
   - [ ] All integration tests pass
   - [ ] Documentation updated

---

## 4. Acceptance Criteria

- [ ] CI status column shows `pass`, `fail`, `pending`, or `unknown` correctly based on actual GitHub CI status
- [ ] Review score column shows `100` (approved), `0` (changes requested), or `-` (no review) correctly
- [ ] Filter buttons ("Needs Work", "Pending", "Passed") work correctly
- [ ] `yarn verify` passes
- [ ] All new and existing tests pass
- [ ] Debug mode available via `DEBUG_PR_DATA=1` environment variable
- [ ] Graceful handling of edge cases (no CI, gh CLI unavailable, API errors)
- [ ] Tooltips explain status icons and score meanings
- [ ] No console errors in browser when loading PRs page

---

## 5. Technical Details

### GitHub API `statusCheckRollup` Field Structure

The `statusCheckRollup` field from GitHub's GraphQL API can contain:

1. **CheckRun format** (GitHub Actions):
   ```json
   {
     "status": "COMPLETED",
     "conclusion": "SUCCESS",
     "name": "CI / Tests"
   }
   ```

2. **StatusContext format** (Legacy status API):
   ```json
   {
     "state": "SUCCESS",
     "description": "Build passed",
     "context": "ci/travis-ci"
   }
   ```

3. **Nested structure** (possible in some API versions):
   ```json
   {
     "contexts": [
       { "conclusion": "SUCCESS", "status": "COMPLETED" }
     ]
   }
   ```

### GitHub API `reviewDecision` Field Values

- `APPROVED` — PR has been approved by required reviewers
- `CHANGES_REQUESTED` — Reviewer requested changes
- `REVIEW_REQUIRED` — PR requires review but hasn't been reviewed yet
- `null` / undefined — No review required or not yet reviewed

### Status Derivation Priority

1. If any check has `FAILURE`, `ERROR`, `CANCELLED`, or `TIMED_OUT` conclusion → `fail`
2. If all checks have `SUCCESS` or `NEUTRAL` conclusion → `pass`
3. If any check has `IN_PROGRESS`, `QUEUED`, or `PENDING` status → `pending`
4. Otherwise → `unknown`
