# Subprocess Patterns for Night Watch

Guidelines for spawning external processes from the Night Watch agent system.

## Non-blocking Subprocess with spawn

Never use `execFileSync` for tools called during agent deliberations — it blocks the Node.js event loop and stalls all other agents.

Use `spawn` wrapped in a Promise:

```typescript
import { spawn } from 'child_process';
import { buildSubprocessEnv } from '../utils.js';

function runSubprocess(cmd: string, args: string[], cwd: string): Promise<string> {
  const TIMEOUT_MS = 120_000;
  const MAX_OUTPUT = 512 * 1024;

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'], // stdin MUST be 'ignore'
      env: buildSubprocessEnv(),
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk;
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(`Failed: ${String(err)}`);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve(`Timed out after ${TIMEOUT_MS / 1000}s`);
        return;
      }
      if (code !== 0) {
        resolve(`Exit code ${code}: ${stderr.trim().slice(0, 300)}`);
        return;
      }
      resolve(stdout.trim());
    });
  });
}
```

## Key Rules

1. **stdin must be `'ignore'`** — CLI tools (especially `claude`) may hang when stdin is a pipe. `execFile` (async) does NOT support the `stdio` option, so use `spawn` instead.

2. **Always use `buildSubprocessEnv()`** — strips Claude Code session variables (`CLAUDECODE`, `CLAUDE_CODE_SSE_PORT`, etc.) that prevent nested `claude` CLI invocations.

3. **Never reject** — tool handlers should always resolve with a string. Return error messages as strings so the AI agent can react to them.

4. **Always log errors** — use `log.error(...)` on failure paths. Without explicit logging, errors are invisible (only shown in a 150-char preview at INFO level).

5. **Timeout guard** — use `setTimeout` + `child.kill('SIGTERM')`. Default to 120s for AI provider calls.

6. **Cap output** — limit collected stdout/stderr to prevent memory issues on large outputs. Truncate the final result to what the AI can reasonably process (e.g., 6000 chars).
