# PRD: Lint-Staged and Pre-Push Hooks

**Status:** completed
**Created:** 2026-02-17
**Complexity:** LOW (Score: 2)

---

## 1. Context

### Problem

Developers can push code that fails type checks or tests, causing CI pipeline failures that could have been caught locally. This wastes CI resources and delays feedback.

### Files Analyzed

- `/home/joao/projects/night-watch-cli/package.json` - Project configuration, scripts, dependencies
- `/home/joao/projects/night-watch-cli/tsconfig.json` - TypeScript configuration (strict mode enabled)
- `/home/joao/projects/night-watch-cli/eslint.config.js` - ESLint configuration with TypeScript rules
- `/home/joao/projects/night-watch-cli/vitest.config.ts` - Test runner configuration
- `/home/joao/projects/night-watch-cli/.github/workflows/tests.yml` - CI test workflow
- `/home/joao/projects/night-watch-cli/.github/workflows/code-quality.yml` - CI lint workflow

### Current Behavior

- **Existing Scripts:**
  - `yarn lint` - Runs ESLint on `src/` directory
  - `yarn verify` - Runs `tsc --noEmit && eslint src/` (type check + lint)
  - `yarn test` - Runs Vitest tests

- **Current Git Hooks:** None configured (only sample hooks in `.git/hooks/`)

- **CI Workflows:** GitHub Actions runs tests and lint on PR creation/sync, but there's no local enforcement

- **Project Structure:**
  - TypeScript CLI tool with ES modules (`"type": "module"`)
  - Source files in `src/`, tests in `src/__tests__/`
  - ESLint ignores test files and dist
  - Vitest configured with thread pool (2-4 threads)

---

## 2. Solution

### Approach

1. Use **husky** for git hook management (industry standard, simple setup)
2. Use **lint-staged** to run linters on staged files only (fast feedback)
3. Add a **pre-push hook** that runs full type checks and tests before allowing push
4. Configure lint-staged to run ESLint with `--fix` on staged `.ts` files

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hook Manager | husky v9 | Most popular, simple, supports all hook types |
| Staged Linter | lint-staged | Only checks changed files, faster feedback |
| Hook Timing | pre-push (not pre-commit) | Pre-push allows WIP commits; tests run once before sharing code |
| Lint Auto-fix | Yes | Auto-fix trivial issues (formatting, imports) to reduce friction |

### Data Changes

None required. This is configuration-only.

---

## 3. Execution Phases

### Phase 1: Install Dependencies and Configure Husky

**User-visible outcome:** Husky is installed and initialized with git hooks directory.

**Files:**

- `package.json` - Add husky and lint-staged dependencies, add prepare script

**Implementation:**

- [ ] Install husky: `yarn add -D husky`
- [ ] Install lint-staged: `yarn add -D lint-staged`
- [ ] Add `prepare` script to package.json: `"prepare": "husky"`
- [ ] Run `yarn prepare` to initialize `.husky/` directory

**Tests Required:**

| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| Manual verification | `ls -la .husky/` | Directory exists with `_/` subdirectory |

**User Verification:**

- Action: Run `yarn prepare`
- Expected: `.husky/` directory created at project root

---

### Phase 2: Configure Lint-Staged

**User-visible outcome:** ESLint runs automatically on staged TypeScript files.

**Files:**

- `package.json` - Add lint-staged configuration

**Implementation:**

- [ ] Add `lint-staged` configuration to package.json:
  ```json
  "lint-staged": {
    "src/**/*.ts": [
      "eslint --fix"
    ]
  }
  ```
- [ ] Create pre-commit hook: `echo "yarn lint-staged" > .husky/pre-commit`
- [ ] Make hook executable: `chmod +x .husky/pre-commit`

**Tests Required:**

| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| Manual verification | Stage a file with lint issue | Auto-fixed on commit |

**User Verification:**

- Action: Stage a TypeScript file and run `git commit -m "test"`
- Expected: Lint-staged runs ESLint on staged files, auto-fixes issues

---

### Phase 3: Add Pre-Push Hook

**User-visible outcome:** Push is blocked if type checks or tests fail.

**Files:**

- `.husky/pre-push` - Pre-push hook script

**Implementation:**

- [ ] Create pre-push hook:
  ```bash
  #!/usr/bin/env sh
  . "$(dirname -- "$0")/_/husky.sh"

  echo "Running type checks..."
  yarn tsc --noEmit || exit 1

  echo "Running tests..."
  yarn test || exit 1

  echo "All checks passed!"
  ```
- [ ] Make hook executable: `chmod +x .husky/pre-push`

**Tests Required:**

| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| Manual verification | Introduce type error, try to push | Push blocked with error message |
| Manual verification | Introduce failing test, try to push | Push blocked with test failure |
| Manual verification | All checks pass, push | Push succeeds |

**User Verification:**

- Action: Run `git push` with failing code
- Expected: Push blocked with clear error message indicating which check failed
- Action: Run `git push` with passing code
- Expected: Push succeeds after all checks pass

---

## 4. Verification Strategy

### Unit Tests

Not applicable - this is configuration-only with no runtime code.

### Integration Verification

```bash
# Test 1: Verify husky installation
ls -la .husky/_/ && echo "Husky initialized"

# Test 2: Verify lint-staged runs on commit
echo "const x:any = 1" >> src/test-lint.ts
git add src/test-lint.ts
git commit -m "test lint-staged"
# Expected: ESLint runs on the file
git checkout HEAD -- src/test-lint.ts 2>/dev/null || rm -f src/test-lint.ts

# Test 3: Verify pre-push blocks on type errors
# Introduce a type error
sed -i 's/const x = 1/const x: string = 1/' src/config.ts
git add -A
git commit -m "introduce type error"
git push origin main --dry-run
# Expected: Type check fails, push blocked
git reset --hard HEAD~1

# Test 4: Verify pre-push blocks on test failures
# Skip - would require modifying test files

# Test 5: Verify all checks pass on clean code
yarn verify && yarn test
# Expected: All pass
git push origin main --dry-run
# Expected: Push simulation succeeds
```

### Evidence Required

- [ ] `yarn verify` passes
- [ ] `yarn test` passes
- [ ] `.husky/pre-commit` exists and is executable
- [ ] `.husky/pre-push` exists and is executable
- [ ] Lint-staged runs on staged files during commit
- [ ] Pre-push hook blocks pushes with failing checks

---

## 5. Acceptance Criteria

- [ ] husky and lint-staged installed as devDependencies
- [ ] `prepare` script in package.json initializes husky
- [ ] `.husky/pre-commit` hook runs lint-staged on staged TypeScript files
- [ ] `.husky/pre-push` hook runs `tsc --noEmit` and `yarn test`
- [ ] Push blocked when type checks fail
- [ ] Push blocked when tests fail
- [ ] Push succeeds when all checks pass
- [ ] `yarn verify` passes
- [ ] All existing tests pass

---

## 6. Final Package.json Changes

```json
{
  "scripts": {
    "prepare": "husky"
  },
  "devDependencies": {
    "husky": "^9.0.0",
    "lint-staged": "^15.0.0"
  },
  "lint-staged": {
    "src/**/*.ts": [
      "eslint --fix"
    ]
  }
}
```

---

## 7. File Structure After Implementation

```
.
├── .husky/
│   ├── _/
│   │   └── husky.sh
│   ├── pre-commit      # Runs lint-staged
│   └── pre-push        # Runs tsc --noEmit && yarn test
├── package.json        # Updated with deps and lint-staged config
└── ...
```
