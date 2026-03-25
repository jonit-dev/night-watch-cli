# PRD: Enhance Planner to Create Proper PRD-Quality GitHub Issues

**Complexity: 3 → LOW mode**

- +1 Touches 4 files
- +2 Multi-package changes (core template + cli command)

---

## 1. Context

**Problem:** The planner job creates GitHub issues with the raw roadmap item title as the issue title and a loosely formatted body that just dumps whatever the AI slicer produced. The issue should be a properly structured PRD following the prd-creator template so the executor agent can implement it without ambiguity.

**Files Analyzed:**

- `packages/cli/src/commands/slice.ts` — planner CLI command, `buildPlannerIssueBody()`, `createPlannerIssue()`
- `packages/core/src/templates/slicer-prompt.ts` — slicer prompt template rendering
- `templates/slicer.md` — the prompt template the AI provider receives
- `packages/core/src/utils/roadmap-scanner.ts` — roadmap parsing and slicing orchestration
- `packages/core/src/board/types.ts` — `ICreateIssueInput` interface
- `instructions/prd-creator.md` — the prd-creator skill instructions
- `docs/PRDs/prd-format.md` — expected PRD/ticket format guide

**Current Behavior:**

- `sliceNextItem()` spawns an AI provider with a slicer prompt to generate a local PRD file
- `createPlannerIssue()` creates a GitHub issue with `title: result.item.title` (raw roadmap title, e.g., "Structured Execution Telemetry")
- `buildPlannerIssueBody()` wraps the generated PRD file content in a "## Planner Generated PRD" header with metadata
- The issue title is a generic one-liner with no "PRD:" prefix or structure
- The issue body quality depends entirely on what the AI wrote — no validation or enforcement of PRD structure
- The slicer prompt template (`templates/slicer.md`) references `instructions/prd-creator.md` but doesn't embed the template structure inline, so the AI may not follow it consistently

---

## 2. Solution

**Approach:**

- Prefix issue titles with `PRD:` so they're clearly identifiable as PRDs on the board
- Improve `buildPlannerIssueBody()` to extract structured sections from the generated PRD and format them as a clean GitHub issue body (not wrapped in a "Planner Generated PRD" meta-section)
- Embed the prd-creator PRD template structure directly into `templates/slicer.md` so the AI always has the full template available (rather than relying on it reading an `instructions/` file that may not exist in the target repo)
- Add a lightweight PRD structure validator that checks the generated PRD file contains the required sections before creating the issue
- If the PRD file is malformed, fall back to the current behavior (dump the raw content) so we don't break the pipeline

**Key Decisions:**

- No new dependencies — pure string manipulation
- PRD validation is advisory, not blocking — a missing section logs a warning but still creates the issue
- The `ICreateIssueInput` interface is unchanged; only the values passed to it change
- The slicer template already has the PRD structure inline (as a fallback); we just need to make it the primary path and ensure it matches the prd-creator skill exactly

**Data Changes:** None

---

## 4. Execution Phases

### Phase 1: Improve issue title and body formatting — GitHub issues created by planner have "PRD:" prefix and clean body structure

**Files (max 5):**

- `packages/cli/src/commands/slice.ts` — update `buildPlannerIssueBody()` and `createPlannerIssue()`
- `packages/cli/src/__tests__/commands/slice.test.ts` — add tests for new formatting

**Implementation:**

- [ ] In `createPlannerIssue()`, change issue title from `result.item.title` to `PRD: ${result.item.title}`
- [ ] Also update the duplicate detection to normalize both sides (strip "PRD:" prefix before comparing)
- [ ] Rewrite `buildPlannerIssueBody()` to:
  1. Read the generated PRD file content
  2. Use it directly as the issue body (no "## Planner Generated PRD" wrapper, no source metadata preamble)
  3. Append a collapsible `<details>` section at the bottom with source metadata (section, item title, PRD file path) for traceability
- [ ] Keep the existing 60k char truncation logic

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `packages/cli/src/__tests__/commands/slice.test.ts` | `should prefix issue title with PRD:` | `expect(input.title).toBe('PRD: Test Feature')` |
| `packages/cli/src/__tests__/commands/slice.test.ts` | `should use PRD content directly as issue body` | `expect(input.body).not.toContain('## Planner Generated PRD')` |
| `packages/cli/src/__tests__/commands/slice.test.ts` | `should include source metadata in details section` | `expect(input.body).toContain('<details>')` |
| `packages/cli/src/__tests__/commands/slice.test.ts` | `should detect duplicates ignoring PRD: prefix` | `expect(result.skippedReason).toBe('already-exists')` |

**Verification Plan:**

1. **Unit Tests:** `packages/cli/src/__tests__/commands/slice.test.ts` — all new tests pass
2. **User Verification:**
   - Action: Run `night-watch slice --dry-run` then manually inspect a created issue
   - Expected: Issue title starts with "PRD:", body is clean PRD content

**Checkpoint:** Run automated review after this phase completes.

---

### Phase 2: Embed full prd-creator template in slicer prompt — AI provider always has the complete PRD structure available

**Files (max 5):**

- `templates/slicer.md` — embed the full prd-creator PRD template structure inline
- `packages/core/src/templates/slicer-prompt.ts` — update `DEFAULT_SLICER_TEMPLATE` fallback to match

**Implementation:**

- [ ] Update `templates/slicer.md` to embed the full PRD template structure from `instructions/prd-creator.md` inline (the critical sections: Complexity Scoring, PRD Template Structure with all subsections, Critical Instructions)
- [ ] Remove the "Load Planner Skill - Read and apply `instructions/prd-creator.md`" step — the instructions are now embedded, so the AI doesn't need to find a file
- [ ] Keep the `{{SECTION}}`, `{{TITLE}}`, `{{DESCRIPTION}}`, `{{OUTPUT_FILE_PATH}}`, `{{PRD_DIR}}` placeholders
- [ ] Add explicit instruction: "The PRD MUST include these sections: Context (with Problem, Files Analyzed, Current Behavior, Integration Points), Solution (with Approach, Key Decisions), Execution Phases (with Files, Implementation steps, Tests), and Acceptance Criteria"
- [ ] Update `DEFAULT_SLICER_TEMPLATE` in `slicer-prompt.ts` to match the new `templates/slicer.md` content
- [ ] Add instruction to the template that emphasizes: "Write the PRD so it can be used directly as a GitHub issue body — it must be self-contained and actionable"

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `packages/core/src/__tests__/slicer-prompt.test.ts` | `should not reference external prd-creator file` | `expect(rendered).not.toContain('Read and apply')` |
| `packages/core/src/__tests__/slicer-prompt.test.ts` | `should contain PRD template sections inline` | `expect(rendered).toContain('## 1. Context')` |

**Verification Plan:**

1. **Unit Tests:** `packages/core/src/__tests__/slicer-prompt.test.ts` — template rendering tests pass
2. **User Verification:**
   - Action: Run `night-watch slice` on a project with a ROADMAP.md
   - Expected: Generated PRD file follows the full prd-creator structure with all sections filled in

**Checkpoint:** Run automated review after this phase completes.

---

## 5. Acceptance Criteria

- [ ] All phases complete
- [ ] All specified tests pass
- [ ] `yarn verify` passes
- [ ] GitHub issues created by planner have "PRD:" prefixed titles
- [ ] GitHub issue body is the PRD content directly (not wrapped in metadata)
- [ ] Source metadata is preserved in a collapsible `<details>` section
- [ ] Duplicate detection works correctly with "PRD:" prefix
- [ ] Slicer prompt template embeds full PRD structure inline
- [ ] AI provider no longer needs to read an external `instructions/prd-creator.md` file
