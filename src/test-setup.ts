/**
 * Global test setup for Night Watch CLI
 * Clears environment variables that may interfere with tests when running
 * in an agent execution context (NW_EXECUTION_CONTEXT=agent)
 */

// Clear Night Watch environment variables that could interfere with tests
const NW_ENV_VARS = [
  'NW_EXECUTION_CONTEXT',
  'NW_AUTO_MERGE',
  'NW_AUTO_MERGE_METHOD',
  'NW_FALLBACK_ON_RATE_LIMIT',
  'NW_CLAUDE_MODEL',
  'NW_PROVIDER',
  'NW_DEFAULT_BRANCH',
  'NW_MAX_RUNTIME',
  'NW_REVIEWER_ENABLED',
  'NW_REVIEWER_MAX_RUNTIME',
  'NW_EXECUTOR_SCHEDULE',
  'NW_REVIEWER_SCHEDULE',
  'NW_MIN_SCORE',
  'NW_BRANCH_PATTERNS',
  'NW_QA_ENABLED',
  'NW_QA_SCHEDULE',
  'NW_QA_MAX_RUNTIME',
  'NW_QA_BRANCH_PATTERNS',
];

// Store original values for potential restoration
const originalValues: Record<string, string | undefined> = {};

for (const varName of NW_ENV_VARS) {
  originalValues[varName] = process.env[varName];
  delete process.env[varName];
}
