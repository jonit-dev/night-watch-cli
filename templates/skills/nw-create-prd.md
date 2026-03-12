# Skill: nw-create-prd

Create a new Product Requirements Document (PRD) for Night Watch to implement autonomously.

## When to use

When the user describes a feature, bug fix, or improvement they want Night Watch to implement.

## Steps

1. **Gather requirements** — if not fully described, ask:
   - What problem does this solve?
   - What is the expected outcome?

2. **Assess complexity**:
   - **1 (Simple)**: single-file fix, minor config change, small bug
   - **2 (Medium)**: multi-file feature, new endpoint, new component
   - **3 (Complex)**: new subsystem, architectural change, major refactor

3. **Split into phases** — each phase should be an independently testable checkpoint:
   - Phase 1: data models, interfaces, schema
   - Middle phases: services, API, core logic
   - Final phase: UI, integration, tests

4. **Write the PRD** to `docs/prds/<kebab-case-title>.md` using this structure:

```
# PRD: <Title>

**Complexity: <1|2|3> → <Simple|Medium|Complex> mode**

## Problem

<1-2 sentences describing the user problem or business need>

## Solution

- <bullet 1>
- <bullet 2>
- <bullet 3>

## Phases

### Phase 1: <Name>

- [ ] <specific implementation task>
- [ ] <write tests for above>

### Phase 2: <Name>

- [ ] <specific implementation task>
- [ ] <write integration tests>

## Acceptance Criteria

- [ ] All phases complete
- [ ] All tests pass
- [ ] Feature reachable from existing code (no orphaned code)
```

5. **Confirm** to the user: show the file path and remind them to run `night-watch run` to execute immediately, or it will run on the next scheduled cron cycle.
