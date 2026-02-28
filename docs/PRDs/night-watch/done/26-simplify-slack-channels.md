# Simplify Slack Channels: 1 Channel Per Project

## Context

Currently the Slack integration uses two parallel channel systems:

1. **4 global topic channels** (`eng`, `prs`, `incidents`, `releases`) — shared across ALL projects
2. **Per-project channels** (`proj-{slug}`) — optional, underutilized

This creates a mess: agents post about any project into shared channels (mostly `#eng`/`#prs`), mixing context from different projects with no clear scoping. When agents deliberate about something ("hey I found this issue..."), it's unclear which project they're talking about.

**Goal:** Simplify to 1 channel per project. All notifications, deliberations, proactive messages, and announcements for a project go to that project's channel. Remove the 4 global topic channels.

## Plan

### 1. Remove `channels` from `ISlackBotConfig`

**File:** `packages/core/src/shared/types.ts` (lines 155-169)

Remove the `channels` property from `ISlackBotConfig`:

```diff
 export interface ISlackBotConfig {
   enabled: boolean;
   botToken: string;
   appToken?: string;
-  channels: {
-    eng: string;
-    prs: string;
-    incidents: string;
-    releases: string;
-  };
   autoCreateProjectChannels: boolean;
   discussionEnabled: boolean;
   replicateApiToken?: string;
   serverBaseUrl?: string;
 }
```

### 2. Update `DEFAULT_SLACK_BOT_CONFIG`

**File:** `packages/core/src/constants.ts` (lines 121-127)

Remove `channels` from the default config.

### 3. Update config parsing

**File:** `packages/core/src/config.ts` (lines 279-294)

Remove the `channels` parsing block (lines 282-290). Remove the channel merge in the file+env merge section (line 437).

### 4. Replace `getChannelForTrigger()` with project-based resolution

**File:** `packages/slack/src/deliberation-builders.ts` (lines 194-215)

Replace the entire function. Instead of routing by trigger type to topic channels, resolve the project's channel from the registry:

```ts
export function getChannelForProject(projectPath: string, channelIdOverride?: string): string {
  if (channelIdOverride) return channelIdOverride;
  const repos = getRepositories();
  const projects = repos.projectRegistry.getAll();
  const project = projects.find((p) => p.path === projectPath);
  return project?.slackChannelId ?? '';
}
```

Update the call site in `deliberation.ts` (line 189) to use `getChannelForProject(resolvedTrigger.projectPath, resolvedTrigger.channelId)`. Also remove the `prd_kickoff` special-casing (lines 174-182) since ALL triggers now resolve from the project channel.

### 5. Replace `getChannelForEvent()` with project-based resolution

**File:** `packages/slack/src/notify.ts` (lines 128-144)

Delete `getChannelForEvent()`. In `sendSlackBotNotification()` (line 187), resolve the channel from the project registry using `ctx.projectName`:

```ts
const repos = getRepositories();
const projects = repos.projectRegistry.getAll();
const project = projects.find((p) => p.name === ctx.projectName) ?? projects[0];
const channel = project?.slackChannelId;
```

For non-project events (like `rate_limit_fallback`), the fallback `projects[0]` handles it — posts to the first registered project's channel.

### 6. Update `proactive-loop.ts`

**File:** `packages/slack/src/proactive-loop.ts` (lines 95-140)

Instead of iterating over `Object.values(slack.channels)` (line 99), iterate over project channels:

```ts
const projects = repos.projectRegistry.getAll();
const channelProjects = projects.filter((p) => p.slackChannelId);
// ...
for (const project of channelProjects) {
  const channel = project.slackChannelId!;
  // idle check, proactive message, etc. — same logic but channel comes from project
}
```

Also simplify `resolveProactiveChannelForProject()` (line 72-76) — remove the `slack.channels.eng` fallback since that no longer exists.

### 7. Update `channel-manager.ts`

**File:** `packages/slack/src/channel-manager.ts`

- `postReleaseAnnouncement()` (lines 117-133): Change to accept a `projectPath` param, resolve the channel from the project registry instead of `slack.channels.releases`. Post to the project's channel.
- `postEngAnnouncement()` (lines 139-154): Same — accept `projectPath`, resolve from project registry instead of `slack.channels.eng`.

### 8. Update `interaction-listener.ts` channel joining

**File:** `packages/slack/src/interaction-listener.ts` (lines 141-158)

In `postPersonaIntros()`, instead of joining `Object.values(slack.channels)`, join all project channels:

```ts
const repos = getRepositories();
const projects = repos.projectRegistry.getAll();
const channelIds = projects.map((p) => p.slackChannelId).filter(Boolean);
```

### 9. Simplify `deliberation.ts` channel resolution

**File:** `packages/slack/src/deliberation.ts` (lines 174-189)

Remove the `prd_kickoff`-specific channel resolution block (lines 174-182). The new `getChannelForProject()` from step 4 handles all trigger types uniformly.

Also simplify `resolveReplyProjectSlug()` (lines 98-110) — remove the `slack.channels` object iteration since it no longer exists.

### 10. Update Settings UI

**File:** `web/pages/Settings.tsx` (lines 811-873)

Replace the 4 channel ID inputs (`#eng`, `#prs`, `#incidents`, `#releases`) with a note that channels are auto-created per project. Remove `channels` from the `DEFAULT_SLACK_CONFIG` local constant (line 46) and `ConfigForm` type.

### 11. Update config template

**File:** `templates/night-watch.config.json`

No change needed — the template doesn't include `slack` config at all.

### 12. Update tests

Files to update:

- `packages/slack/src/__tests__/slack/channel-manager.test.ts` — remove `channels` from `buildConfig()`, update `postReleaseAnnouncement`/`postEngAnnouncement` tests
- `packages/slack/src/__tests__/slack/board-integration.test.ts` (line 118) — remove `channels` from config
- `packages/slack/src/__tests__/slack/consensus-evaluator.test.ts` (line 104) — remove `channels` from config
- `packages/slack/src/__tests__/slack/deliberation-builders.test.ts` — update `getChannelForTrigger` tests to use new `getChannelForProject`
- `packages/slack/src/__tests__/slack/deliberation-routing.test.ts` — update channel routing tests
- `packages/slack/src/__tests__/slack/thread-state-manager.test.ts` — remove `channels` if referenced
- `packages/server/src/__tests__/server.test.ts` — remove `channels` from mock configs
- `packages/server/src/__tests__/server-global-agents-routes.test.ts` — remove `channels` from mock configs

### 13. Update `trigger-router.ts`

**File:** `packages/slack/src/trigger-router.ts` (lines 134-144)

`resolveTargetProject()` already correctly uses `p.slackChannelId === channel` — this continues to work as-is since messages now only arrive in project channels.

## Verification

1. `yarn verify` — type-check + lint passes
2. Run all affected tests: `yarn test` (vitest)
3. Manual: register a project with `night-watch init`, verify `proj-{slug}` channel is auto-created
4. Manual: trigger a notification (e.g. `run_succeeded`), verify it posts to the project channel
5. Manual: check proactive loop posts to project channels (not topic channels)
