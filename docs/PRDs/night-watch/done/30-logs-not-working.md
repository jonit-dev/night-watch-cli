# Fix Logs Page and Dashboard "View Log" CTA

## Problem

The Logs page in the Web UI and Dashboard's "View Log" CTA return empty lines. The API endpoint `/api/logs/executor` returns:

```json
{
  "name": "executor",
  "lines": []
}
```

## Root Cause Analysis

The log files are created with names `night-watch.log` and `night-watch-pr-reviewer.log`, but the code looks for `executor.log` and `reviewer.log`.

### Evidence

**Actual log files in the project:**

```
/home/joao/projects/night-watch-cli/logs/
  - night-watch.log           (27KB - executor logs)
  - night-watch-pr-reviewer.log (4KB - reviewer logs)
```

**Code expects different names:**

In `/home/joao/projects/night-watch-cli/src/utils/status-data.ts`:

```typescript
// Line 532
export function collectLogInfo(projectDir: string): ILogInfo[] {
  const logNames = ["executor", "reviewer"];  // <-- Wrong names!
  return logNames.map((name) => {
    const logPath = path.join(projectDir, LOG_DIR, `${name}.log`);
    // Looks for: logs/executor.log, logs/reviewer.log
```

In `/home/joao/projects/night-watch-cli/src/server/index.ts`:

```typescript
// Line 141
const logPath = path.join(projectDir, LOG_DIR, `${name as string}.log`);
// When name="executor", looks for: logs/executor.log
```

**Lock file naming convention shows correct pattern:**

In `/home/joao/projects/night-watch-cli/src/utils/status-data.ts`:

```typescript
// Lines 104-113
export function executorLockPath(projectDir: string): string {
  return `${LOCK_FILE_PREFIX}${projectRuntimeKey(projectDir)}.lock`;
  // Creates: /tmp/night-watch-{hash}.lock
}

export function reviewerLockPath(projectDir: string): string {
  return `${LOCK_FILE_PREFIX}pr-reviewer-${projectRuntimeKey(projectDir)}.lock`;
  // Creates: /tmp/night-watch-pr-reviewer-{hash}.lock
}
```

The lock files follow `night-watch` and `night-watch-pr-reviewer` naming, which matches the actual log file names.

## Files Analyzed

| File                                                           | Purpose                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| `/home/joao/projects/night-watch-cli/src/utils/status-data.ts` | Log reading utilities (`collectLogInfo`, `getLastLogLines`) |
| `/home/joao/projects/night-watch-cli/src/server/index.ts`      | API handler `handleGetLogs`                                 |
| `/home/joao/projects/night-watch-cli/src/constants.ts`         | `LOG_DIR = "logs"` constant                                 |
| `/home/joao/projects/night-watch-cli/web/pages/Logs.tsx`       | Logs page component                                         |
| `/home/joao/projects/night-watch-cli/web/pages/Dashboard.tsx`  | Dashboard with "View Log" CTA                               |
| `/home/joao/projects/night-watch-cli/web/api.ts`               | Frontend API client (`fetchLogs`)                           |

## Solution

Add constants for the correct log file names and update all references to use them.

### Key Decisions

1. **Use constants instead of hardcoded strings** - Define log file names in constants for DRY principle
2. **Maintain backward compatibility in API** - Keep API endpoint names (`/api/logs/executor`, `/api/logs/reviewer`) unchanged
3. **Map API names to file names** - Create a mapping function from logical names to actual file names

### Data Changes

Add to `/home/joao/projects/night-watch-cli/src/constants.ts`:

```typescript
// Log file names (must match what executor/reviewer create)
export const EXECUTOR_LOG_NAME = 'night-watch';
export const REVIEWER_LOG_NAME = 'night-watch-pr-reviewer';
```

## Execution Phases

### Phase 1: Add Log Name Constants and Mapping Function

**Files:**

- `/home/joao/projects/night-watch-cli/src/constants.ts` - Add log file name constants

**Implementation:**

- [ ] Add `EXECUTOR_LOG_NAME = "night-watch"` constant
- [ ] Add `REVIEWER_LOG_NAME = "night-watch-pr-reviewer"` constant
- [ ] Add `LOG_FILE_NAMES` mapping object for logical name to file name mapping

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `src/__tests__/constants.test.ts` | `should have correct executor log name` | `expect(EXECUTOR_LOG_NAME).toBe("night-watch")` |
| `src/__tests__/constants.test.ts` | `should have correct reviewer log name` | `expect(REVIEWER_LOG_NAME).toBe("night-watch-pr-reviewer")` |

**User Verification:**

- Action: Build the project
- Expected: No TypeScript errors, constants exported correctly

---

### Phase 2: Update Status Data Utilities

**Files:**

- `/home/joao/projects/night-watch-cli/src/utils/status-data.ts` - Update `collectLogInfo` and add helper function

**Implementation:**

- [ ] Add `getLogFileName(logicalName: string): string` helper function
- [ ] Update `collectLogInfo()` to use actual log file names
- [ ] Update `getLogInfo()` to accept logical name and map to actual file name

**Code Changes:**

```typescript
// Add helper function
function getLogFileName(logicalName: string): string {
  const mapping: Record<string, string> = {
    executor: EXECUTOR_LOG_NAME,
    reviewer: REVIEWER_LOG_NAME,
  };
  return mapping[logicalName] || logicalName;
}

// Update collectLogInfo
export function collectLogInfo(projectDir: string): ILogInfo[] {
  const logNames = ['executor', 'reviewer'];
  return logNames.map((name) => {
    const fileName = getLogFileName(name);
    const logPath = path.join(projectDir, LOG_DIR, `${fileName}.log`);
    // ...
  });
}
```

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `src/__tests__/utils/status-data.test.ts` | `should collect info for executor log with correct filename` | `expect(executorLog.path).toContain("night-watch.log")` |
| `src/__tests__/utils/status-data.test.ts` | `should collect info for reviewer log with correct filename` | `expect(reviewerLog.path).toContain("night-watch-pr-reviewer.log")` |
| `src/__tests__/utils/status-data.test.ts` | `should read actual log files from project` | `expect(executorLog.lastLines.length).toBeGreaterThan(0)` |

**User Verification:**

- Action: Run `yarn test src/__tests__/utils/status-data.test.ts`
- Expected: All tests pass including new log filename tests

---

### Phase 3: Update Server API Handler

**Files:**

- `/home/joao/projects/night-watch-cli/src/server/index.ts` - Update `handleGetLogs`

**Implementation:**

- [ ] Import log name constants
- [ ] Add mapping from API parameter name to actual filename
- [ ] Update `handleGetLogs` to use correct file path

**Code Changes:**

```typescript
import { LOG_DIR, EXECUTOR_LOG_NAME, REVIEWER_LOG_NAME } from '../constants.js';

function getLogFileName(apiName: string): string {
  const mapping: Record<string, string> = {
    executor: EXECUTOR_LOG_NAME,
    reviewer: REVIEWER_LOG_NAME,
  };
  return mapping[apiName] || apiName;
}

function handleGetLogs(
  projectDir: string,
  _config: INightWatchConfig,
  req: Request,
  res: Response,
): void {
  const { name } = req.params;
  const validNames = ['executor', 'reviewer'];

  if (!validNames.includes(name as string)) {
    res.status(400).json({ error: `Invalid log name. Must be one of: ${validNames.join(', ')}` });
    return;
  }

  const linesParam = req.query.lines;
  const lines = typeof linesParam === 'string' ? parseInt(linesParam, 10) : 200;
  const linesToRead = isNaN(lines) || lines < 1 ? 200 : Math.min(lines, 10000);

  const fileName = getLogFileName(name as string);
  const logPath = path.join(projectDir, LOG_DIR, `${fileName}.log`);
  const logLines = getLastLogLines(logPath, linesToRead);

  res.json({ name, lines: logLines });
}
```

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `src/__tests__/server.test.ts` | `should return executor log lines from night-watch.log` | `expect(response.body.lines).toContain(actual log content)` |
| `src/__tests__/server.test.ts` | `should return reviewer log lines from night-watch-pr-reviewer.log` | `expect(response.body.lines).toContain(actual log content)` |

**User Verification:**

- Action: Run `curl http://localhost:PORT/api/logs/executor`
- Expected: Returns JSON with actual log lines from `night-watch.log`

---

### Phase 4: Update Test Fixtures

**Files:**

- `/home/joao/projects/night-watch-cli/src/__tests__/server.test.ts` - Update test to use correct filenames
- `/home/joao/projects/night-watch-cli/src/__tests__/utils/status-data.test.ts` - Update test to use correct filenames

**Implementation:**

- [ ] Update server test to create `night-watch.log` and `night-watch-pr-reviewer.log`
- [ ] Update status-data test for `collectLogInfo` to expect correct filenames

**Code Changes in server.test.ts:**

```typescript
// Before (line 89-96):
fs.writeFileSync(path.join(logDir, 'executor.log'), 'Executor log line 1\n...');
fs.writeFileSync(path.join(logDir, 'reviewer.log'), 'Reviewer log line 1\n...');

// After:
fs.writeFileSync(path.join(logDir, 'night-watch.log'), 'Executor log line 1\n...');
fs.writeFileSync(path.join(logDir, 'night-watch-pr-reviewer.log'), 'Reviewer log line 1\n...');
```

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `src/__tests__/server.test.ts` | `should return executor log lines` | `expect(response.body.lines).toContain("Executor log line 1")` |
| `src/__tests__/server.test.ts` | `should return reviewer log lines` | `expect(response.body.lines).toContain("Reviewer log line 1")` |

**User Verification:**

- Action: Run `yarn test src/__tests__/server.test.ts`
- Expected: All log-related tests pass

---

### Phase 5: Verify End-to-End Functionality

**Files:**

- No code changes - verification only

**Implementation:**

- [ ] Start the web UI (`night-watch ui`)
- [ ] Navigate to Logs page
- [ ] Verify executor and reviewer logs display correctly
- [ ] Navigate to Dashboard
- [ ] Click "View Log" CTA for Executor process
- [ ] Verify it navigates to Logs page with correct content

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| `src/__tests__/server.test.ts` | `GET /api/logs/executor returns actual log content` | Integration test with real log file |
| `src/__tests__/server.test.ts` | `GET /api/logs/reviewer returns actual log content` | Integration test with real log file |

**User Verification:**

- Action: Start web UI, navigate to Logs page
- Expected: Log content displays in terminal-style viewer

---

## Verification Strategy

### API Proof (curl commands)

```bash
# Test executor logs endpoint
curl http://localhost:3333/api/logs/executor | jq .

# Expected: {"name":"executor","lines":["line1","line2",...]}

# Test reviewer logs endpoint
curl http://localhost:3333/api/logs/reviewer | jq .

# Expected: {"name":"reviewer","lines":["line1","line2",...]}
```

### Test Coverage

1. **Unit Tests:**
   - `src/__tests__/constants.test.ts` - Verify log name constants
   - `src/__tests__/utils/status-data.test.ts` - Verify log file path construction

2. **Integration Tests:**
   - `src/__tests__/server.test.ts` - Verify API returns correct log content

3. **Verification Commands:**
   ```bash
   yarn verify  # Must pass
   yarn test    # All tests must pass
   ```

## Acceptance Criteria

- [ ] All phases complete
- [ ] All specified tests pass
- [ ] `yarn verify` passes
- [ ] API endpoint `/api/logs/executor` returns content from `logs/night-watch.log`
- [ ] API endpoint `/api/logs/reviewer` returns content from `logs/night-watch-pr-reviewer.log`
- [ ] Logs page displays log content correctly
- [ ] Dashboard "View Log" CTA navigates to Logs page with content
- [ ] Empty log response when log file doesn't exist (graceful handling)
