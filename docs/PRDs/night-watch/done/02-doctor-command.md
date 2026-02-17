# PRD: Doctor Command

**Depends on:** `01-terminal-ui-polish.md`

**Complexity: 3 → LOW mode**
- Touches 3 files (+1)
- New command but simple logic
- No complex state
- Single package
- No DB/API changes

---

## 1. Context

**Problem:** Users have no way to verify their environment is correctly set up before running night-watch. When something is missing (gh not authenticated, provider CLI not installed, config invalid), they discover it at runtime with cryptic errors from bash scripts.

**Files Analyzed:**
- `src/commands/init.ts` — already has `isGitRepo()`, `isGhAuthenticated()`, `isClaudeAvailable()`, `isCodexAvailable()`, `detectProviders()` — these should be extracted and reused
- `src/cli.ts` — command registration pattern
- `src/constants.ts` — `CONFIG_FILE_NAME`, `DEFAULT_PRD_DIR`, `VALID_PROVIDERS`
- `src/config.ts` — `loadConfig()` for validating config file
- `src/utils/ui.ts` — (from PRD 01) colored output helpers
- `package.json` — engines `>=18.0.0`

**Current Behavior:**
- `init` validates git, gh, and providers but only during setup — not available as standalone check
- Validation helpers are private functions inside `init.ts` — not reusable
- No way to check config file validity, crontab access, or Node version without running a command that fails

### Integration Points Checklist

- **Entry point:** `night-watch doctor` CLI command
- **Caller file:** `src/cli.ts` — register new command
- **Registration:** Add `doctorCommand(program)` call in `cli.ts`
- **User-facing:** YES — new command with colored pass/fail output
- **Full user flow:** User runs `night-watch doctor` → sees checklist of environment checks with pass/fail indicators → optionally runs `--fix` to auto-fix what's possible

---

## 2. Solution

**Approach:**
- Extract validation helpers from `init.ts` into a new `src/utils/checks.ts` shared utility
- Create `src/commands/doctor.ts` that runs all checks and displays results
- Add `--fix` flag that attempts to create missing directories
- Refactor `init.ts` to import from `checks.ts` instead of defining its own validators
- Use `ui.ts` helpers (from PRD 01) for colored pass/fail output

**Key Decisions:**
- Extract to `checks.ts` rather than duplicating — DRY principle
- Each check returns `{ passed: boolean; message: string; fixable: boolean }` for consistent handling
- `--fix` only does safe, non-destructive operations (create dirs, not install software)
- Exit code 0 if all pass, exit code 1 if any fail — useful for CI/scripts

---

## 4. Execution Phases

### Phase 1: Extract validation helpers — Shared checks utility available

**Files (2):**
- `src/utils/checks.ts` — NEW: extracted validation functions
- `src/commands/init.ts` — refactor to import from `checks.ts`

**Implementation:**
- [ ] Create `src/utils/checks.ts` with these exports:
  - `checkGitRepo(cwd: string): CheckResult` — uses `fs.existsSync(path.join(cwd, '.git'))`
  - `checkGhCli(): CheckResult` — runs `gh auth status`
  - `checkProviderCli(provider: Provider): CheckResult` — runs `which <provider>`
  - `detectProviders(): Provider[]` — checks all valid providers
  - `checkNodeVersion(minMajor: number): CheckResult` — parses `process.version`
  - `checkConfigFile(projectDir: string): CheckResult` — tries `loadConfig()`, catches parse errors
  - `checkPrdDirectory(projectDir: string, prdDir: string): CheckResult` — checks dir exists
  - `checkCrontabAccess(): CheckResult` — runs `crontab -l` to verify access
- [ ] Define `CheckResult` interface: `{ passed: boolean; message: string; fixable: boolean; fix?: () => void }`
- [ ] Refactor `init.ts` to import `checkGitRepo`, `checkGhCli`, `detectProviders` from `checks.ts` instead of defining local copies
- [ ] Verify all existing `init` tests still pass

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `src/__tests__/utils/checks.test.ts` | `checkGitRepo should pass in git repo` | `result.passed === true` |
| `src/__tests__/utils/checks.test.ts` | `checkGitRepo should fail outside git repo` | `result.passed === false` |
| `src/__tests__/utils/checks.test.ts` | `checkNodeVersion should pass for current node` | `result.passed === true` |
| `src/__tests__/utils/checks.test.ts` | `checkConfigFile should fail for invalid JSON` | `result.passed === false` |

**Verification:**
- `npm test` passes (including existing init tests)
- `init.ts` no longer defines its own `isGitRepo`, `isGhAuthenticated`, etc.

---

### Phase 2: Create doctor command — Users can validate environment with `night-watch doctor`

**Files (3):**
- `src/commands/doctor.ts` — NEW: doctor command implementation
- `src/cli.ts` — register doctor command
- `src/__tests__/commands/doctor.test.ts` — NEW: tests

**Implementation:**
- [ ] Create `src/commands/doctor.ts`:
  - Import `checks.ts` functions and `ui.ts` helpers
  - Define `DoctorOptions { fix: boolean }`
  - Run checks in order: Git repo → Node version → gh CLI → Provider CLI → Config file → PRD directory → Crontab access
  - For each check, print `success(message)` or `error(message)`
  - If `--fix` is passed and check is fixable, attempt fix and re-check
  - At the end, print summary: `N/M checks passed`
  - Exit with code 0 if all pass, 1 if any fail
- [ ] Register in `cli.ts`: `import { doctorCommand } from './commands/doctor.js'` + `doctorCommand(program)`
- [ ] Write tests

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `src/__tests__/commands/doctor.test.ts` | `should show all checks` | output contains each check name |
| `src/__tests__/commands/doctor.test.ts` | `should pass git repo check in project dir` | output contains success indicator for git |
| `src/__tests__/commands/doctor.test.ts` | `should show help text` | `--help` output contains `--fix` |
| `src/__tests__/cli.test.ts` | `should show doctor command in help` | help output contains `doctor` |

**Verification:**
- `npx tsx src/cli.ts doctor` shows all checks with pass/fail
- `npx tsx src/cli.ts doctor --fix` attempts to fix fixable issues
- `npx tsx src/cli.ts --help` lists `doctor` command
- `npm test` passes

---

## 5. Acceptance Criteria

- [ ] `night-watch doctor` runs all environment checks with colored pass/fail indicators
- [ ] `night-watch doctor --fix` creates missing PRD/logs directories
- [ ] Exit code 0 when all checks pass, 1 when any fail
- [ ] `init.ts` reuses `checks.ts` (no duplicated validation logic)
- [ ] `doctor` appears in `night-watch --help`
- [ ] All tests pass (`npm test`)
