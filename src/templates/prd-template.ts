export const PRD_TEMPLATE = `# PRD: {{TITLE}}

{{DEPENDS_ON}}

**Complexity: {{COMPLEXITY_SCORE}} → {{COMPLEXITY_LEVEL}} mode**
{{COMPLEXITY_BREAKDOWN}}

\`\`\`
COMPLEXITY SCORE (sum all that apply):
+1  Touches 1-5 files
+2  Touches 6-10 files
+3  Touches 10+ files
+2  New system/module from scratch
+2  Complex state logic / concurrency
+2  Multi-package changes
+1  Database schema changes
+1  External API integration

| Score | Level  | Template Mode                                   |
| ----- | ------ | ----------------------------------------------- |
| 1-3   | LOW    | Minimal (skip sections marked with MEDIUM/HIGH) |
| 4-6   | MEDIUM | Standard (all sections)                         |
| 7+    | HIGH   | Full + mandatory checkpoints every phase        |
\`\`\`

---

## 1. Context

**Problem:** <!-- 1-2 sentences describing the issue being solved -->

**Files Analyzed:**
<!-- List all files you've inspected before planning -->

**Current Behavior:**
<!-- 3-5 bullets describing current state -->

### Integration Points Checklist

**How will this feature be reached?**
- [ ] Entry point identified: <!-- e.g., route, event, cron, CLI command -->
- [ ] Caller file identified: <!-- file that will invoke this new code -->
- [ ] Registration/wiring needed: <!-- e.g., add route to router, register handler, add menu item -->

**Is this user-facing?**
- [ ] YES → UI components required (list them)
- [ ] NO → Internal/background feature (explain how it's triggered)

**Full user flow:**
1. User does: <!-- action -->
2. Triggers: <!-- what code path -->
3. Reaches new feature via: <!-- specific connection point -->
4. Result displayed in: <!-- where user sees outcome -->

---

## 2. Solution

**Approach:**
<!-- 3-5 bullets explaining the chosen solution -->

**Architecture Diagram** <!-- (MEDIUM/HIGH complexity) -->:

\`\`\`mermaid
flowchart LR
    A[Component A] --> B[Component B] --> C[Component C]
\`\`\`

**Key Decisions:**
<!-- Library/framework choices, error-handling strategy, reused utilities -->

**Data Changes:** <!-- New schemas/migrations, or "None" -->

---

## 3. Sequence Flow <!-- (MEDIUM/HIGH complexity) -->

\`\`\`mermaid
sequenceDiagram
    participant A as Component A
    participant B as Component B
    A->>B: methodName(args)
    alt Error case
        B-->>A: ErrorType
    else Success
        B-->>A: Response
    end
\`\`\`

---

## 4. Execution Phases

**CRITICAL RULES:**
1. Each phase = ONE user-testable vertical slice
2. Max 5 files per phase (split if larger)
3. Each phase MUST include concrete tests
4. Checkpoint after each phase (automated ALWAYS required)

{{PHASES}}

---

## 5. Acceptance Criteria

- [ ] All phases complete
- [ ] All specified tests pass
- [ ] Verification commands pass
- [ ] All automated checkpoint reviews passed
- [ ] Feature is reachable (entry point connected, not orphaned code)
- [ ] <!-- additional criterion -->
- [ ] <!-- additional criterion -->
`;

export interface IPrdTemplateVars {
  title: string;
  dependsOn: string[];
  complexityScore: number;
  complexityLevel: "LOW" | "MEDIUM" | "HIGH";
  complexityBreakdown: string[];
  phaseCount: number;
}

function renderDependsOn(deps: string[]): string {
  if (deps.length === 0) {
    return "";
  }
  const formatted = deps.map((d) => `\`${d}\``).join(", ");
  return `**Depends on:** ${formatted}`;
}

function renderComplexityBreakdown(items: string[]): string {
  if (items.length === 0) {
    return "";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function renderPhases(count: number): string {
  const phases: string[] = [];
  for (let i = 1; i <= count; i++) {
    phases.push(`### Phase ${i}: [Name] — [User-visible outcome in 1 sentence]

**Files (max 5):**
- \`src/path/file.ts\` — what changes

**Implementation:**
- [ ] Step 1
- [ ] Step 2

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| \`src/__tests__/feature.test.ts\` | \`should do X when Y\` | \`expect(result).toBe(Z)\` |

**Verification Plan:**
1. **Unit Tests:** File and test names
2. **Integration Test:** (if applicable)
3. **User Verification:**
   - Action: [what to do]
   - Expected: [what should happen]

**Checkpoint:** Run automated review after this phase completes.`);
  }
  return phases.join("\n\n---\n\n");
}

export function renderPrdTemplate(
  vars: IPrdTemplateVars,
  customTemplate?: string,
): string {
  const template = customTemplate ?? PRD_TEMPLATE;

  let result = template;
  result = result.replace("{{TITLE}}", vars.title);
  result = result.replace("{{DEPENDS_ON}}", renderDependsOn(vars.dependsOn));
  result = result.replace(
    "{{COMPLEXITY_SCORE}}",
    String(vars.complexityScore),
  );
  result = result.replace("{{COMPLEXITY_LEVEL}}", vars.complexityLevel);
  result = result.replace(
    "{{COMPLEXITY_BREAKDOWN}}",
    renderComplexityBreakdown(vars.complexityBreakdown),
  );
  result = result.replace("{{PHASES}}", renderPhases(vars.phaseCount));

  return result;
}
