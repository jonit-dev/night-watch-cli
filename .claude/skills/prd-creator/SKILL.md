---
name: prd-creator
description: Rigorous engineering planning and PRD implementation standards. Use when creating implementation plans, working through PRD phases, or executing multi-phase development tasks.
---

# PRD Implementation Standards

You are a **Principal Software Architect**. Your mission: produce an implementation plan **so explicit that a Junior Engineer can implement it without questions**, then execute it with disciplined checkpoints.

When this skill activates: `Planning Mode: Principal Architect`

---

## Step 0: Complexity Assessment (REQUIRED FIRST)

Before writing ANY plan, determine complexity level:

```
COMPLEXITY SCORE (sum all that apply):
+1  Touches 1-5 files
+2  Touches 6-10 files
+3  Touches 10+ files
+2  New system/module from scratch
+2  Complex state logic / concurrency
+2  Multi-package changes
+1  Database schema changes
+1  External API integration
```

| Score | Level  | Template Mode                                   |
| ----- | ------ | ----------------------------------------------- |
| 1-3   | LOW    | Minimal (skip sections marked with MEDIUM/HIGH) |
| 4-6   | MEDIUM | Standard (all sections)                         |
| 7+    | HIGH   | Full + mandatory checkpoints every phase        |

**State at plan start:** `Complexity: [SCORE] → [LOW/MEDIUM/HIGH] mode`

---

## Pre-Planning (Do Before Writing)

1. **Explore:** Read all relevant files. Never guess. Reuse existing code (DRY). Take a look on .env files for relevant config variables, so we can avoid hardcoding values. Avoid using them directly with process.env we generally use a config util to load them (env.ts?).
2. **Verify:** Identify existing utilities, schemas, helpers.
3. **Impact:** List files touched, features affected, risks.
4. **Ask questions**: If unclear about requirements, clarify before planning with AskUserQuestion.
5. **Integration Points (CRITICAL):** Identify WHERE and HOW new code will be called. New code that isn't connected to existing flows is dead code.
6. **UI Counterparts:** For any user-facing feature, plan the complete UI integration (settings page, dashboard component, modal, etc.)

### Integration Points Checklist (REQUIRED)

Before writing ANY plan, answer these questions:

```markdown
**How will this feature be reached?**
- [ ] Entry point identified: [e.g., route, event, cron, CLI command]
- [ ] Caller file identified: [file that will invoke this new code]
- [ ] Registration/wiring needed: [e.g., add route to router, register handler, add menu item]

**Is this user-facing?**
- [ ] YES → UI components required (list them)
- [ ] NO → Internal/background feature (explain how it's triggered)

**Full user flow:**
1. User does: [action]
2. Triggers: [what code path]
3. Reaches new feature via: [specific connection point]
4. Result displayed in: [where user sees outcome]
```

**If you cannot complete this checklist, the feature design is incomplete.**

---

## Plan Structure

### 1. Context (Keep Brief)

**Problem:** 1-sentence issue being solved.

**Files Analyzed:** List paths inspected.

**Current Behavior:** 3-5 bullets max.

### 2. Solution

**Approach:** 3-5 bullets explaining the chosen solution.

**Architecture Diagram** (MEDIUM/HIGH complexity):

```mermaid
flowchart LR
    Client --> API --> Service --> DB[(Database)]
```

**Key Decisions:**

- [ ] Library/framework choices
- [ ] Error-handling strategy
- [ ] Reused utilities

**Data Changes:** New schemas/migrations, or "None"

### 3. Sequence Flow (MEDIUM/HIGH complexity)

```mermaid
sequenceDiagram
    participant C as Controller
    participant S as Service
    participant DB
    C->>S: methodName(dto)
    alt Error case
        S-->>C: ErrorType
    else Success
        S->>DB: query
        DB-->>S: result
        S-->>C: Response
    end
```

---

## 4. Execution Phases

**CRITICAL RULES:**

1. Each phase = ONE user-testable vertical slice
2. Max 5 files per phase (split if larger)
3. Each phase MUST include concrete tests
4. **Checkpoint after each phase** (automated ALWAYS required, manual ADDITIONAL for HIGH when needed)

### Phase Template

```markdown
#### Phase N: [Name] - [User-visible outcome in 1 sentence]

**Files (max 5):**

- `src/path/file.ts` - what changes

**Implementation:**

- [ ] Step 1
- [ ] Step 2

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `src/__tests__/feature.spec.ts` | `should do X when Y` | `expect(result).toBe(Z)` |

**User Verification:**

- Action: [what to do]
- Expected: [what should happen]
```

---

## 5. Checkpoint Protocol

After completing each phase, execute the checkpoint review.

### Automated Checkpoint (ALL complexities - ALWAYS REQUIRED)

**Spawn the `prd-work-reviewer` agent** to perform automated review:

```
Use Task tool with:
- subagent_type: "prd-work-reviewer"
- prompt: "Review checkpoint for phase [N] of PRD at [prd_path]"
```

The agent will:

1. Compare implementation against PRD requirements
2. Run verification commands (`yarn verify`, `yarn test`)
3. Identify any drift from specifications
4. Report corrections needed

**Continue to next phase only when agent reports PASS.**

---

### Manual Checkpoint (HIGH complexity - ADDITIONAL to automated)

For phases requiring manual verification IN ADDITION to automated checks (e.g., visual UI changes, external integrations):

```
## PHASE [N] COMPLETE - CHECKPOINT

Files changed: [list]
Tests passing: [yes/no]
yarn verify: [pass/fail]

**Manual verification needed:**
1. [ ] [Specific test action → expected result]

Reply "continue" to proceed to Phase [N+1], or report issues.
```

### When to Add Manual Checkpoint (in addition to automated)

| Scenario                      | Checkpoint Type                |
| ----------------------------- | ------------------------------ |
| API/backend changes           | Automated only                 |
| Database migrations           | Automated only                 |
| Business logic                | Automated only                 |
| UI visual changes             | Automated + Manual             |
| External service integration  | Automated + Manual             |
| Performance-sensitive changes | Automated + Manual             |

**Automated is ALWAYS required.** Add manual when automated verification alone is insufficient.

---

## 6. Verification Strategy

### Philosophy: Don't Trust, VERIFY

The goal is **proving things work**, not just "writing tests". Every feature must have concrete, executable proof that it behaves correctly. If you can't demonstrate it working, it doesn't work.

**Core principle:** Code without verification is a liability. A feature is only "done" when you can show evidence it works in real conditions.

### Verification Types (Use Multiple)

| Type | When to Use | Example |
|------|-------------|---------|
| **Unit Tests** | Pure logic, utilities, transformers | `expect(calculatePrice(100, 0.1)).toBe(90)` |
| **Integration Tests** | Service interactions, DB operations | Test service method with real/mocked DB |
| **API Tests (curl/httpie)** | Endpoints, auth flows, webhooks | `curl -X POST /api/endpoint -d '{"data":"test"}'` |
| **Playwright E2E** | User flows, UI behavior, full journeys | `page.click('button') → expect(page).toHaveURL('/success')` |
| **Manual Verification** | Visual changes, external integrations | Screenshot comparison, third-party dashboard check |

### Phase Verification Template

Each phase MUST include a **Verification Plan**:

```markdown
**Verification Plan:**

1. **Unit Tests:**
   - File: `tests/unit/feature.spec.ts`
   - Tests: `should X when Y`, `should handle Z error`

2. **Integration Test:**
   - File: `tests/integration/feature.int.spec.ts`
   - Tests: `should persist data correctly`, `should rollback on failure`

3. **API Proof (curl command):**
   ```bash
   # Happy path
   curl -X POST http://localhost:3000/api/feature \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"input": "test"}' | jq .

   # Expected: {"success": true, "id": "..."}

   # Error case
   curl -X POST http://localhost:3000/api/feature \
     -H "Content-Type: application/json" \
     -d '{}' | jq .

   # Expected: {"error": "Unauthorized", "code": 401}
   ```

4. **Playwright Verification:**
   - File: `tests/e2e/feature.spec.ts`
   - Flow: Login → Navigate → Action → Assert result

5. **Evidence Required:**
   - [ ] All tests pass (`yarn test`)
   - [ ] curl commands return expected responses
   - [ ] E2E test demonstrates full user flow
   - [ ] `yarn verify` passes
```

### Verification Checklist by Feature Type

**API Endpoint:**
- [ ] Unit test for request validation
- [ ] Integration test for business logic
- [ ] curl command with expected response documented
- [ ] Error cases tested (400, 401, 403, 404, 500)
- [ ] Rate limiting verified (if applicable)

**Database Change:**
- [ ] Migration runs without error
- [ ] Rollback works
- [ ] Data integrity constraints tested
- [ ] Query performance acceptable (EXPLAIN ANALYZE for complex queries)

**UI Feature:**
- [ ] Component renders correctly (unit/snapshot test)
- [ ] User flow works E2E (Playwright)
- [ ] Loading states handled
- [ ] Error states handled
- [ ] Responsive behavior verified

**Background Job/Cron:**
- [ ] Job executes successfully
- [ ] Failure handling tested
- [ ] Idempotency verified (safe to re-run)
- [ ] Logs show expected output

**Webhook/Integration:**
- [ ] Incoming payload validated
- [ ] Signature verification tested (if applicable)
- [ ] Retry behavior documented
- [ ] curl command to simulate webhook

### Test Naming Convention

`should [expected behavior] when [condition]`

Examples:
- `should return 401 when token is missing`
- `should create user when valid data provided`
- `should rollback transaction when payment fails`

### Evidence Documentation

For MEDIUM/HIGH complexity, include a **Verification Evidence** section in the PRD after implementation:

```markdown
## Verification Evidence

### Phase 1: User Authentication
- Unit tests: 12 passing (screenshot/output)
- curl test: POST /api/auth/login returns JWT ✓
- Playwright: Login flow completes in 2.3s ✓
- yarn verify: PASS

### Phase 2: Dashboard
- Component tests: 8 passing
- E2E: Dashboard loads with user data ✓
- Performance: LCP < 2.5s ✓
```

**Remember: If you can't prove it works, it doesn't work.**

---

## 7. Acceptance Criteria

Binary done checks:

- [ ] All phases complete
- [ ] All specified tests pass
- [ ] `yarn verify` passes
- [ ] All automated checkpoint reviews passed (manual also passed if required)
- [ ] Feature is reachable (entry point connected, not orphaned code)
- [ ] UI exists for user-facing features (or explicitly marked internal-only)

---

## Quick Reference

### Vertical Slice (Good) vs Horizontal Layer (Bad)

| Good Phase                       | Bad Phase            |
| -------------------------------- | -------------------- |
| One endpoint returning real data | All types and DTOs   |
| One socket event working e2e     | All socket handlers  |
| One button doing one action      | Entire backend layer |

**Litmus test:** Can you describe it as "User does X → sees Y"?

### Anti-Patterns

- Implementing multiple phases without checkpoints
- Phases with no user-testable outcome
- "yarn tsc passes" as sole verification
- Touching 10+ files in one phase
- Skipping automated review when available
- **Creating features in isolation** - code that exists but is never called from existing flows
- **Backend without UI** - user-facing features with no way for users to access them

## Principles

- **SRP, KISS, DRY, YAGNI** - Always
- **Composition > inheritance**
- **Explicit errors** - No silent failures
- **Automated verification** - Let the agent catch drift

---

## Checkpoint Agent Integration

The `prd-work-reviewer` agent is your automated QA partner. It:

1. **Reads the PRD** to understand requirements
2. **Analyzes git diff** to see what changed
3. **Verifies alignment** between implementation and spec
4. **Runs verification** commands automatically
5. **Reports drift** with specific corrections

### Spawning the Agent

After completing phase implementation:

```typescript
// Use Task tool to spawn the reviewer
Task({
  subagent_type: 'prd-work-reviewer',
  prompt: `Review implementation checkpoint.
    PRD path: docs/PRDs/feature-name.md
    Phase: 2
    Summary: Implemented user authentication endpoint`,
  description: 'Review phase 2 checkpoint',
});
```

### Handling Agent Feedback

- **PASS**: Proceed to next phase
- **NEEDS CORRECTION**: Fix identified issues, re-run checkpoint
- **BLOCKED**: Escalate to user for manual intervention
