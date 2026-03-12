# PRD: Web UI Refactoring & Test Coverage

**Status:** Draft
**Created:** 2026-03-11
**Scope:** `web/` package — refactoring, hook extraction, deduplication, and test infrastructure

---

## Problem Statement

The web UI has grown organically with several code quality issues:

- **Settings.tsx is 1,104 lines** — a monolith handling config loading, preset CRUD, tab navigation, auto-save, cron orchestration, and inline tab content
- **No form management abstraction** — manual `useState` + `updateField` scattered per page
- **Duplicated logic across pages** — cron reinstall (5x), trigger job (2x), loading spinners (8x), schedule state init (2x)
- **Prop drilling** — 5+ handler functions drilled from Settings into AiRuntimeTab
- **Inconsistent UI patterns** — `window.confirm()` in Board, `alert()` in ProviderEnvEditor, raw `<textarea>` bypassing the design system
- **Direct DOM manipulation** — `classList.add/remove` + `setTimeout` in Settings for scroll highlighting
- **Dead/redundant code** — `types.ts` re-exports with aliases, unused function parameters, meaningless `.bind()` call in `useApi`
- **Test suite is shallow** — Settings tests don't render components (just check arrays), 10 of 13 Scheduling tests are skipped, no unit tests for hooks/utilities

---

## Phase 1: Extract Shared Hooks & Utilities

**Goal:** Eliminate cross-page duplication by extracting reusable hooks.

### 1.1 — `useCronReinstall` hook

Extract the cron-reinstall-with-toast pattern (duplicated 5 times across Settings.tsx and Scheduling.tsx).

**Location:** `web/hooks/useCronReinstall.ts`

```ts
interface ICronReinstallOptions {
  successTitle: string;
  successMessage: string;
  failureTitle: string;
}

function useCronReinstall(): {
  reinstallCron: (opts: ICronReinstallOptions) => Promise<boolean>;
  isReinstalling: boolean;
}
```

**Files affected:** `Settings.tsx` (lines 470-494, 529-549), `Scheduling.tsx` (lines 188-209, 340-364)

### 1.2 — `useTriggerJob` hook

Extract the job-trigger pattern (duplicated in Dashboard.tsx and Scheduling.tsx).

**Location:** `web/hooks/useTriggerJob.ts`

```ts
type JobType = 'executor' | 'reviewer' | 'qa' | 'audit' | 'planner';

function useTriggerJob(): {
  triggerJob: (job: JobType) => Promise<void>;
  triggeringJob: JobType | null;
}
```

**Files affected:** `Dashboard.tsx` (lines 121-133), `Scheduling.tsx` (lines 221-247)

### 1.3 — `useConfigForm` hook

Extract the config-to-form-state mapping + `updateField` logic used by Settings and Scheduling.

**Location:** `web/hooks/useConfigForm.ts`

```ts
function useConfigForm<T extends Record<string, unknown>>(
  config: INightWatchConfig | null,
  toFormState: (config: INightWatchConfig) => T
): {
  form: T;
  updateField: <K extends keyof T>(field: K, value: T[K]) => void;
  resetForm: () => void;
  isDirty: boolean;
}
```

**Files affected:** `Settings.tsx` (form state + updateField), `Scheduling.tsx` (editState + field handlers)

### 1.4 — `usePresetManagement` hook

Encapsulate all preset CRUD handlers currently prop-drilled from Settings into AiRuntimeTab.

**Location:** `web/hooks/usePresetManagement.ts`

```ts
function usePresetManagement(form, updateField): {
  allPresets: Record<string, IProviderPreset>;
  presetOptions: IPresetOption[];
  handleAddPreset: () => void;
  handleEditPreset: (id: string) => void;
  handleDeletePreset: (id: string) => void;
  handleResetPreset: (id: string) => void;
  // modal state
  presetModalOpen: boolean;
  editingPreset: { id: string; preset: IProviderPreset } | null;
}
```

**Files affected:** `Settings.tsx` (lines 340-560, 819-831), `AiRuntimeTab.tsx`

---

## Phase 2: Break Up Settings.tsx

**Goal:** Reduce Settings.tsx from 1,104 lines to ~200-300 lines (orchestrator only).

### 2.1 — Extract remaining inline tab content to sub-components

Currently only General, AI & Runtime, and Jobs tabs are extracted. Extract the remaining:

| Tab | New file | Approximate lines moved |
|---|---|---|
| Schedules | `pages/settings/SchedulesTab.tsx` | ~60 lines |
| Integrations | `pages/settings/IntegrationsTab.tsx` | ~80 lines |
| Advanced | `pages/settings/AdvancedTab.tsx` | ~80 lines |

### 2.2 — Move preset data to shared constants

Extract `BUILT_IN_PRESET_IDS` and preset definitions (duplicated in Settings.tsx line 40 and AiRuntimeTab.tsx line 11) to:

**Location:** `web/constants/presets.ts`

```ts
export const BUILT_IN_PRESET_IDS = ['claude', 'claude-sonnet-4-6', 'claude-opus-4-6', 'codex', 'glm-47', 'glm-5'] as const;
export const BUILT_IN_PRESETS: Record<string, IProviderPreset> = { ... };
```

**Files affected:** `Settings.tsx`, `AiRuntimeTab.tsx`, `PresetFormModal.tsx`

### 2.3 — Remove `getPresetOptions` unused parameter

`getPresetOptions(_customPresets)` ignores its argument (line 618). Remove the parameter.

### 2.4 — Replace DOM manipulation with React patterns

Replace the `classList.add/remove` + `setTimeout` scroll-highlight pattern (lines 291-335) with a `highlightedSection` state + `useEffect` cleanup + ref-based `scrollIntoView`.

---

## Phase 3: Fix Inconsistencies & Dead Code

### 3.1 — Replace `window.confirm()` and `alert()`

| Location | Current | Replacement |
|---|---|---|
| `Board.tsx:144` | `confirm()` | Confirmation modal (reuse existing `Modal` component) |
| `ProviderEnvEditor.tsx:56` | `alert()` | `addToast()` from `useStore` |

### 3.2 — Fix `closeBoardIssue` to use `apiFetch`

`api.ts:391-401` manually reimplements error handling. Extend `apiFetch` to handle `204 No Content` responses, then use it.

### 3.3 — Create `<LoadingState>` component

Replace 8 identical loading spinner JSX blocks with:

**Location:** `web/components/ui/LoadingState.tsx`

```tsx
function LoadingState({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-slate-400">{message}</div>
    </div>
  );
}
```

**Files affected:** `PRs.tsx`, `Roadmap.tsx`, `Scheduling.tsx`, `Settings.tsx`, `Dashboard.tsx`, `Board.tsx`

### 3.4 — Create `<Textarea>` UI component

Raw `<textarea>` elements in `JobsTab.tsx:216-222` and `Board.tsx:78-98` bypass the design system with duplicated Tailwind classes. Create a `Textarea` component matching the existing `Input` component patterns.

**Location:** `web/components/ui/Textarea.tsx`

### 3.5 — Clean up `types.ts`

- Remove dead types: `PRD`, `PullRequest`, `ActionLog`, `Notification`, `Project` (unused)
- Remove alias re-exports that just rename `IPrInfo` → `PrInfo` (consumers should import from `api.ts` directly)
- Move `IScheduleConfigForm` from `ScheduleConfig.tsx:11-21` into `types.ts`

### 3.6 — Fix `useApi` stale refetch

Remove the meaningless `refetch.current = refetch.current.bind(refetch)` line in `api.ts:575`.

### 3.7 — Move `IAgentInfo` outside component body

`Scheduling.tsx:463-476` defines an interface inside a function body. Move it to the module level and `useMemo` the `agents` array.

---

## Phase 4: Testing Infrastructure & Coverage

### Current State

| Layer | Framework | Status |
|---|---|---|
| Unit (vitest + happy-dom) | vitest 4.x + RTL 16.x | Installed, 6 test files exist |
| E2E (Playwright) | Playwright 1.48 | Installed, 3 spec files in `tests/e2e/qa/` |

**Problems:**
- `Settings.test.tsx` — Tests check static arrays, never renders the component. Zero actual RTL tests.
- `Scheduling.test.tsx` — 10 of 13 tests are `.skip`ped (marked "SKIPPED: UX revamp changed this"). Only 1 active test.
- `Dashboard.snapshot.test.tsx` — Unknown state (needs review).
- No tests for any hooks or utilities (`cron.ts` has 497 lines, only `cron-utils.test.tsx` exists).
- E2E tests depend on live backend (`networkidle` + real API calls). No MSW mocking layer.

### 4.1 — Fix & unskip existing tests

**Priority:** High. Tests marked as skipped due to "UX revamp" need to be either updated to match current UI or deleted if the tested feature was removed.

- Audit all `.skip` tests in `Scheduling.test.tsx`
- Update or remove tests for removed UI elements (edit mode button, provider lanes, bucket summary)
- Add actual RTL render tests for Settings page (replace the array-checking tests)

### 4.2 — Unit tests for extracted hooks

After Phase 1, add tests for each new hook using `renderHook` from RTL:

| Hook | Test file | Key scenarios |
|---|---|---|
| `useCronReinstall` | `hooks/__tests__/useCronReinstall.test.ts` | Success path, failure path, toast messages |
| `useTriggerJob` | `hooks/__tests__/useTriggerJob.test.ts` | Each job type, error handling, loading state |
| `useConfigForm` | `hooks/__tests__/useConfigForm.test.ts` | Init from config, updateField, resetForm, isDirty |
| `usePresetManagement` | `hooks/__tests__/usePresetManagement.test.ts` | CRUD operations, built-in vs custom preset handling |

### 4.3 — Unit tests for `cron.ts` utilities

`web/utils/cron.ts` is 497 lines with complex cron parsing logic. Add comprehensive tests:

**File:** `web/utils/__tests__/cron.test.ts`

- Cron expression parsing
- Next-run calculation
- Human-readable schedule formatting
- Edge cases (whitespace normalization, invalid expressions)

### 4.4 — Component integration tests

Add RTL tests for key page interactions:

| Component | Test file | Scenarios |
|---|---|---|
| Settings | `pages/__tests__/Settings.integration.test.tsx` | Tab navigation, form save, preset CRUD, toast messages |
| Dashboard | `pages/__tests__/Dashboard.test.tsx` | Stats card rendering, job trigger buttons, navigation |
| Board | `pages/__tests__/Board.test.tsx` | Issue list rendering, create issue modal, close issue confirmation |

**Mock strategy:** Mock `api.ts` exports (already done in Scheduling.test.tsx — follow that pattern).

### 4.5 — E2E test improvements

The existing Playwright tests in `tests/e2e/qa/` are functional but fragile:

- Add `data-testid` attributes to key UI elements for stable selectors
- Consider adding MSW (Mock Service Worker) for deterministic E2E tests in CI
- Add E2E coverage for Settings page (tab navigation, form submission)

### 4.6 — Add `test` to `yarn verify`

Currently `yarn verify` runs typecheck + lint. Consider adding `vitest run` so tests are always validated alongside types/lint.

---

## Phase 5: (Optional) Form Library Evaluation

Not proposing a form library right now — the `useConfigForm` hook from Phase 1 may be sufficient. But if form complexity grows, consider:

| Option | Pros | Cons |
|---|---|---|
| React Hook Form | Tiny bundle, great perf, uncontrolled by default | Learning curve for team |
| Formik | Mature, well-documented | Larger bundle, slower for large forms |
| Keep custom hook | Zero deps, full control, already fits the pattern | Must maintain validation ourselves |

**Recommendation:** Start with `useConfigForm` hook. Revisit if validation logic becomes complex.

---

## Execution Order

```
Phase 1 (hooks)  →  Phase 2 (Settings breakup)  →  Phase 3 (cleanup)  →  Phase 4 (tests)
      ↓                       ↓                           ↓                      ↓
  1.1 useCronReinstall   2.1 Tab extraction        3.1 confirm/alert      4.1 Fix skipped
  1.2 useTriggerJob      2.2 Preset constants       3.2 closeBoardIssue    4.2 Hook tests
  1.3 useConfigForm      2.3 Unused param           3.3 LoadingState       4.3 Cron tests
  1.4 usePresetManagement 2.4 DOM → React           3.4 Textarea           4.4 Integration
                                                    3.5 types.ts cleanup   4.5 E2E improve
                                                    3.6 useApi fix         4.6 verify script
                                                    3.7 IAgentInfo move
```

Phases 1-3 should be done sequentially (each builds on the previous). Phase 4 can run in parallel with Phase 3 for items that don't depend on the refactored code.

---

## Success Criteria

- [ ] No file in `web/` exceeds 400 lines
- [ ] Zero duplicated logic patterns (cron reinstall, trigger job, loading state)
- [ ] All hooks have unit tests with `renderHook`
- [ ] Settings.tsx is an orchestrator only (~200-300 lines)
- [ ] No `window.confirm()`, `alert()`, or direct DOM manipulation
- [ ] All existing skipped tests are either updated or removed
- [ ] `yarn test` passes in `web/` with >70% line coverage on new hooks
- [ ] `BUILT_IN_PRESET_IDS` defined in exactly one place
