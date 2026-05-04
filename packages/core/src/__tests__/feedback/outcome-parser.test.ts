/**
 * Tests for structured outcome parsing.
 */

import { describe, expect, it } from 'vitest';

import { buildSessionOutcomeInput, classifyFailure } from '../../feedback/outcome-parser.js';
import { parseScriptResult } from '../../utils/script-result.js';

describe('outcome parser', () => {
  it('should classify TypeScript errors', () => {
    const stderr = `
packages/core/src/feedback/outcome-parser.ts:42:7 - error TS2322: Type 'string' is not assignable to type 'number'.
`;

    const result = classifyFailure({
      projectPath: '/tmp/night-watch',
      stderr,
    });

    expect(result.category).toBe('typescript');
    expect(result.failureSignature).toContain('typescript|packages/core/src');
    expect(result.failureSignature).toContain('ts2322');
  });

  it('should classify ESLint errors', () => {
    const stdout = `
/tmp/night-watch/packages/cli/src/commands/run.ts
  12:8  error  'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (1 error, 0 warnings)
`;

    const result = buildSessionOutcomeInput({
      projectPath: '/tmp/night-watch',
      jobType: 'executor',
      providerKey: 'codex',
      startedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_001_500,
      exitCode: 1,
      stdout,
      scriptResult: parseScriptResult('NIGHT_WATCH_RESULT:failure|prd=97.md|branch=nw-97'),
    });

    expect(result.outcome).toBe('failure');
    expect(result.failureCategory).toBe('eslint');
    expect(result.failureSignature).toContain('eslint|packages/cli/src');
    expect(result.durationSeconds).toBe(2);
    expect(result.prdFile).toBe('97.md');
    expect(result.branchName).toBe('nw-97');
  });
});
