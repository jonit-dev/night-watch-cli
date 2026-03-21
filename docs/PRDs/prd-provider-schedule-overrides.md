# PRD: Time-Based Provider Schedule Overrides

## Context

**Problem:** Claude has 2x usage capacity during weekday off-peak hours (11pm-4am), but there's no way to automatically switch providers during specific time windows. Users who normally run GLM-5 or other providers want to leverage Claude during these cheap/available windows without manually changing config.

**Solution:** Add a `providerScheduleOverrides` array to the config that lets users define time-based rules to temporarily switch providers. The rules are checked at job dispatch time and override the static per-job/global provider when active.

**Complexity: 5 → MEDIUM mode**

- Touches 8+ files (+2 multi-package)
- Multi-package: core, server, web

---

## Integration Points

- **Entry point:** `resolveJobProvider()` in `packages/core/src/config.ts` — called by `buildBaseEnvVars()` at job dispatch time
- **User-facing:** Yes — new "Schedule Overrides" card in Settings > AI Runtime tab
- **Full flow:** Cron triggers job → `buildBaseEnvVars()` → `resolveJobProvider()` checks time overrides → returns appropriate preset ID → job runs with that provider

---

## Interface Design

```typescript
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface IProviderScheduleOverride {
  label: string; // "Night Surge - Claude"
  presetId: string; // "claude" or "claude-opus-4-6"
  days: DayOfWeek[]; // [1,2,3,4,5] = weekdays
  startTime: string; // "23:00" (HH:mm, 24h)
  endTime: string; // "04:00"
  jobTypes?: JobType[] | null; // null = all jobs
  enabled: boolean;
}
```

**Resolution precedence:** CLI override > **schedule override** > per-job provider > global provider

**Overlap rules:** Job-specific override beats global; among same specificity, first in array wins.

**Cross-midnight:** `days` refers to the START day. At Thu 02:00 with window 23:00-04:00, checks if Wednesday is in `days`.

**Timezone:** System local time (via `new Date()`). Users can set `TZ` env var if needed.

---

## Phases

### Phase 1: Core Types & Resolution Logic (5 files)

**Files:**

- `packages/core/src/types.ts` — Add `DayOfWeek`, `IProviderScheduleOverride`, add `providerScheduleOverrides?: IProviderScheduleOverride[]` to `INightWatchConfig`
- `packages/core/src/shared/types.ts` — Mirror types for web client, add field to shared `INightWatchConfig` (line ~201)
- `packages/core/src/constants.ts` — Add `DEFAULT_PROVIDER_SCHEDULE_OVERRIDES: IProviderScheduleOverride[] = []`
- `packages/core/src/config.ts` — Add `findActiveScheduleOverride()` (exported, with injectable `now?: Date` param), update `resolveJobProvider()` signature to accept optional `now`, update `getDefaultConfig()`, update `mergeConfigLayer()` to handle the new array key alongside `branchPatterns`/`prdPriority`
- `packages/core/src/__tests__/config.test.ts` — Tests within existing `resolveJobProvider` describe block

**Key implementation — `config.ts`:**

- `parseTimeToMinutes(time: string): number` — parse "HH:mm" to minutes
- `isTimeInWindow(now: Date, override: IProviderScheduleOverride): boolean` — handles same-day and cross-midnight windows, checks previous day for after-midnight portion
- `findActiveScheduleOverride(overrides, jobType, now?): string | null` — iterates overrides, job-specific beats global, first match wins

**Tests (add to existing `describe('resolveJobProvider')` in config.test.ts):**

- Time matches → returns override preset
- Outside window → falls through to static provider
- Cross-midnight window at 02:00 → matches (previous day check)
- Job-specific override beats global override
- Disabled overrides are skipped
- Wrong day of week → no match
- CLI override still beats schedule overrides
- Same-day window (09:00-17:00)
- First matching override of same specificity wins

**Verification:** `yarn verify` + `yarn test --filter core`

---

### Phase 2: Normalization & Server Validation (2 files)

**Files:**

- `packages/core/src/config-normalize.ts` — Add parsing for `providerScheduleOverrides` array after the `jobProviders` block (~line 284). Validate: required fields (label, presetId, startTime, endTime), time format regex `^([01]\d|2[0-3]):[0-5]\d$`, non-empty days with valid 0-6 values, optional jobTypes filtered against `VALID_JOB_TYPES`, default `enabled` to `true`
- `packages/server/src/routes/config.routes.ts` — Add validation block in `validateConfigChanges()` after jobProviders validation (~line 301). Validate same constraints as normalization but return error strings.

**Tests:** Add normalization tests in `packages/core/src/__tests__/config-normalize.test.ts` (or existing config.test.ts if normalize tests are there)

**Verification:** `yarn verify` + `yarn test --filter core` + `yarn test --filter server`

---

### Phase 3: Web UI (4 files)

**Files:**

- `web/api.ts` — Add `IProviderScheduleOverride`, `DayOfWeek` to import and re-export from `@shared/types`
- `web/pages/Settings.tsx` — Add `providerScheduleOverrides: IProviderScheduleOverride[]` to `ConfigForm` type, initialize in `toFormState()` with `config.providerScheduleOverrides ?? []`, include in save payload
- `web/pages/settings/AiRuntimeTab.tsx` — Add `providerScheduleOverrides` to `IConfigFormAiRuntime`, add new Card between "Job Assignments" and "Rate Limit Fallback" with `ScheduleOverrideEditor` component
- `web/components/providers/ScheduleOverrideEditor.tsx` — **New file**

#### ScheduleOverrideEditor Component Spec

**Props:**

```typescript
interface IScheduleOverrideEditorProps {
  overrides: IProviderScheduleOverride[];
  onChange: (overrides: IProviderScheduleOverride[]) => void;
  presetOptions: Array<{ label: string; value: string }>;
}
```

**Pattern:** Follow `WebhookEditor.tsx` edit-in-place pattern:

- `editingIndex` state for inline editing existing items
- `showAddForm` state for add-new-item form
- Summary view per item, click Edit to switch to inline form

**State:**

```typescript
const [editingIndex, setEditingIndex] = useState<number | null>(null);
const [showAddForm, setShowAddForm] = useState(false);
const [draft, setDraft] = useState<IProviderScheduleOverride>(emptyOverride);
```

**Default empty override:**

```typescript
const emptyOverride: IProviderScheduleOverride = {
  label: '',
  presetId: '',
  days: [1, 2, 3, 4, 5],
  startTime: '23:00',
  endTime: '04:00',
  jobTypes: null,
  enabled: true,
};
```

**Summary Row (read mode) — per override:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Toggle]  Night Surge - Claude Opus                                │
│            claude-opus-4-6 · Mon-Fri · 23:00–04:00 · executor only │
│                                                    [Edit] [Delete]  │
└─────────────────────────────────────────────────────────────────────┘
```

- Left: enabled toggle (checkbox or switch-style), label as `text-slate-100 font-medium`
- Below label: subtitle line in `text-sm text-slate-400` showing preset name, day abbreviations, time window, job scope ("All jobs" or comma-separated types)
- Right: Edit (pencil icon) and Delete (trash icon) buttons, `variant="ghost"` size small

**Inline Form (edit/add mode):**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Label:    [________________________]                               │
│  Provider: [Select preset ▾        ]                               │
│  Days:     ☐Su ☑Mo ☑Tu ☑We ☑Th ☑Fr ☐Sa    [Weekdays] [All]       │
│  Window:   [23:00] to [04:00]                                      │
│  Jobs:     ☑All Jobs  ☐ reviewer ☐ executor ☐ planner ...          │
│  Enabled:  [Toggle ☑]                                              │
│                                              [Cancel] [Save]        │
└─────────────────────────────────────────────────────────────────────┘
```

**Form fields detail:**

- **Label**: `<Input label="Label" placeholder="Night Surge - Claude" />` — required, text
- **Provider**: `<Select label="Provider Preset" options={presetOptions} />` — required, uses same `presetOptions` from `getPresetOptions()` already used in AiRuntimeTab
- **Days**: Row of 7 small toggle buttons (Su Mo Tu We Th Fr Sa), styled like tags/chips. Quick-select buttons: "Weekdays" (sets [1-5]), "Weekend" (sets [0,6]), "All" (sets [0-6]). Use `bg-indigo-600` for selected, `bg-slate-800` for unselected. Layout: `flex items-center gap-1`
- **Time Window**: Two `<input type="time" />` side by side with "to" label between. Use native HTML time input (HH:mm). Styled with same `Input` component classes: `bg-slate-900 border-slate-700 text-slate-100`
- **Job Types**: Toggle between "All Jobs" (sets `jobTypes: null`) and individual checkboxes. When "All Jobs" is unchecked, show checkboxes for each job type from `VALID_JOB_TYPES` (`executor`, `reviewer`, `qa`, `audit`, `slicer`, `analytics`, `planner`). Layout: `flex flex-wrap gap-2`
- **Enabled**: Simple checkbox toggle
- **Actions**: Cancel (`variant="ghost"`) + Save (`variant="primary"`) buttons, right-aligned

**Empty state:**

```tsx
<p className="text-slate-500 text-sm italic">No schedule overrides configured.</p>
```

**Add button:**

```tsx
<Button variant="secondary" size="sm" onClick={() => setShowAddForm(true)}>
  <Plus className="w-4 h-4 mr-1" /> Add Override
</Button>
```

**Validation (client-side):** Disable Save button unless: label non-empty, presetId selected, at least one day selected, both times filled. Show inline `text-red-400 text-xs` error messages.

**Delete confirmation:** Use `window.confirm('Remove override "Label"?')` — simple, consistent with existing patterns.

**Icons:** `Plus`, `Trash2`, `Edit2` from `lucide-react`

**CSS classes used:**

- Card wrapper: existing `<Card className="p-6 space-y-6">`
- Card title: `<h3 className="text-lg font-medium text-slate-200">Schedule Overrides</h3>`
- Card subtitle: `<p className="text-sm text-slate-400 mt-1">Automatically switch providers during specific time windows</p>`
- Override list: `<div className="space-y-3">`
- Override row: `<div className="flex items-center justify-between p-3 bg-slate-950/40 rounded-lg border border-white/5">`
- Day chip (selected): `px-2 py-1 text-xs rounded bg-indigo-600 text-white cursor-pointer`
- Day chip (unselected): `px-2 py-1 text-xs rounded bg-slate-800 text-slate-400 cursor-pointer hover:bg-slate-700`

#### AiRuntimeTab Integration

In `AiRuntimeTab.tsx`, add after the "Job Assignments" card and before "Rate Limit Fallback":

```tsx
<Card className="p-6 space-y-6">
  <div>
    <h3 className="text-lg font-medium text-slate-200">Schedule Overrides</h3>
    <p className="text-sm text-slate-400 mt-1">
      Automatically switch providers during specific time windows (e.g., use Claude during off-peak
      hours)
    </p>
  </div>
  <ScheduleOverrideEditor
    overrides={form.providerScheduleOverrides}
    onChange={(overrides) => updateField('providerScheduleOverrides', overrides)}
    presetOptions={getPresetOptions(form.providerPresets)}
  />
</Card>
```

#### Settings.tsx Changes

1. Add to `ConfigForm` type:

   ```typescript
   providerScheduleOverrides: IProviderScheduleOverride[];
   ```

2. Add to `toFormState()`:

   ```typescript
   providerScheduleOverrides: config.providerScheduleOverrides ?? [],
   ```

3. Add to `handleSave()` payload:
   ```typescript
   providerScheduleOverrides: form.providerScheduleOverrides,
   ```

**Verification:** `yarn verify` + manual: open Settings > AI Runtime, add/edit/remove overrides, save, reload and verify persistence

---

## Example Config

```json
{
  "provider": "glm-5",
  "providerScheduleOverrides": [
    {
      "label": "Night Surge - Claude Opus",
      "presetId": "claude-opus-4-6",
      "days": [1, 2, 3, 4, 5],
      "startTime": "23:00",
      "endTime": "04:00",
      "jobTypes": ["executor"],
      "enabled": true
    },
    {
      "label": "Night Surge - Claude",
      "presetId": "claude",
      "days": [1, 2, 3, 4, 5],
      "startTime": "23:00",
      "endTime": "04:00",
      "jobTypes": null,
      "enabled": true
    }
  ]
}
```

Result: Weekday nights 23:00-04:00, executor uses Opus, other jobs use Claude Sonnet. All other times: GLM-5.

---

## Acceptance Criteria

- [ ] `resolveJobProvider()` returns schedule override when time window matches
- [ ] Cross-midnight windows work correctly (previous-day check)
- [ ] Job-specific overrides take precedence over global overrides
- [ ] Disabled overrides are skipped
- [ ] CLI `--provider` flag still beats schedule overrides
- [ ] Config normalizes and validates `providerScheduleOverrides`
- [ ] Web UI allows add/edit/delete/toggle overrides
- [ ] `yarn verify` passes
- [ ] All tests pass
