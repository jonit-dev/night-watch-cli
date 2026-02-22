# Adding a New Tool to the AI Agent System

When adding a new tool that Night Watch agents can call during deliberations or ad-hoc replies, follow this checklist.

## 1. Define the Tool Schema

In `packages/slack/src/ai/tools.ts`:

- Add an `IAnthropicTool` definition to the appropriate builder function (`buildFilesystemTools()`, `buildBoardTools()`, or create a new builder).
- Schema must include `name`, `description`, and `input_schema` with required fields.
- The description is critical — it steers when the agent calls the tool vs alternatives. Be explicit about when to use and when NOT to use.

## 2. Implement the Handler

In `packages/slack/src/ai/tools.ts`:

- Create an `execute*` function that takes parsed input and returns a string result.
- Filesystem tools should be synchronous (instant). Subprocess tools should return `Promise<string>`.
- For subprocess tools, use `spawn` with `stdio: ['ignore', 'pipe', 'pipe']` — never leave stdin as a pipe (causes hangs).
- Use `buildSubprocessEnv()` from `../utils.js` to strip Claude Code session vars.
- Always resolve (never reject) — return error strings so the AI can react to failures.
- Add `log.error(...)` on failure paths so errors surface in logs.

## 3. Export from Barrel

In `packages/slack/src/ai/index.ts`:

- Add the new `execute*` function to the barrel export.

## 4. Wire the Handler in All 3 Registries

In `packages/slack/src/deliberation.ts`, there are 3 places where tool registries are built:

1. **`runContributionRound`** (~line 290) — uses `discussion.projectPath`
2. **`replyAsAgent` first block** (~line 480) — uses `trigger.projectPath`
3. **`_buildAdHocReply`** (~line 780) — uses `projectPathForTools!`

For each registry:

- Add the tool definitions to the `tools` array (e.g., via `buildFilesystemTools()` or individually).
- Register the handler: `registry.set('tool_name', (input) => ...)`.
- Use the correct project path variable for that registry location.

## 5. Update Tool Guidance Prompt

In `packages/slack/src/deliberation.ts`, find the `toolGuidance` string (~line 741) and mention the new tool so agents know it exists and when to prefer it.

## 6. Verify

```bash
yarn eslint packages/slack/src/ai/tools.ts packages/slack/src/ai/index.ts packages/slack/src/deliberation.ts
npx tsc --noEmit -p packages/slack/tsconfig.json
```

## Common Pitfalls

- **Subprocess stdin**: Always use `stdio: ['ignore', 'pipe', 'pipe']` with `spawn`. Using `execFile` (async) does NOT support `stdio` — stdin defaults to an open pipe which can cause CLI tools to hang.
- **Silent failures**: Always log errors at `log.error` level. Never silently catch and return error strings without logging.
- **Missing registries**: There are 3 registry setups in deliberation.ts. Missing one means the tool works in some contexts but not others.
- **Project path**: Each registry uses a different variable (`discussion.projectPath`, `trigger.projectPath`, `projectPathForTools!`). Use the one that matches the registry location.
