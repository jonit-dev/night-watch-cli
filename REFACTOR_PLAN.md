# Refactor: Slack God-Objects → Focused Modules

## Status

| Phase | Module                | Status     |
| ----- | --------------------- | ---------- |
| 1     | ThreadStateManager    | ✅ Done    |
| 2     | BoardIntegration      | ⬜ Pending |
| 3     | ConsensusEvaluator    | ⬜ Pending |
| 4     | TriggerRouter         | ⬜ Pending |
| 5     | CascadingReplyHandler | ⬜ Pending |

---

## Phase 1 — ThreadStateManager ✅

**Files touched:**

- `packages/slack/src/thread-state-manager.ts` — NEW
- `packages/slack/src/utils.ts` — added `randomInt(min, max)`
- `packages/slack/src/interaction-listener.ts` — replaced 6 maps + methods with `this.state.*`
- `packages/slack/src/__tests__/slack/thread-state-manager.test.ts` — NEW (20 tests)

**What moved:**

- `processedMessageKeys`, `processedMessageOrder` → `rememberMessageKey(key)`
- `lastPersonaReplyAt` → `isPersonaOnCooldown()`, `markPersonaReply()`
- `lastChannelActivityAt` → `markChannelActivity()`, `getLastChannelActivityAt()`
- `adHocThreadState` → `rememberAdHocThreadPersona()`, `getRememberedAdHocPersona()`
- `reviewedIssues` + `ISSUE_REVIEW_COOLDOWN_MS` → `isIssueOnReviewCooldown()`, `markIssueReviewed()`
- `pickRandomPersona()`, `findPersonaByName()`, `randomInt()` → delegated to state

---

## Phase 2 — BoardIntegration ⬜

**New file:** `packages/slack/src/board-integration.ts`

**Constructor:** `(slackClient: SlackClient, config: INightWatchConfig)`

**Methods to move from `DeliberationEngine`:**

- `resolveBoardConfig(projectPath)` — resolves board provider config
- `triggerIssueOpener(discussionId, trigger)` — create GitHub issue
- `triggerIssueStatusUpdate(verdict, discussionId, trigger)` — move/close issue
- `generateIssueBody(trigger, devPersona)` — AI-generated issue body
- `handleAuditReport(report, projectName, projectPath, channel)` — triage audit
- `analyzeCodeCandidate(fileContext, signalSummary, location)` — Dev evaluates code

**In DeliberationEngine:**

- Add `this.board = new BoardIntegration(slackClient, config)` in constructor
- Internal callers (`evaluateConsensus`, `evaluateIssueReviewConsensus`) → `this.board.*`
- Keep thin public delegates for `handleAuditReport`, `analyzeCodeCandidate`, `triggerIssueOpener`

**New test file:** `packages/slack/src/__tests__/slack/board-integration.test.ts`

---

## Phase 3 — ConsensusEvaluator ⬜

**New file:** `packages/slack/src/consensus-evaluator.ts`

**Constructor:** `(slackClient: SlackClient, config: INightWatchConfig, board: BoardIntegration)`

**Methods to move from `DeliberationEngine`:**

- `evaluateConsensus(discussionId, trigger, callbacks)` — main while-loop
- `evaluateIssueReviewConsensus(discussionId, trigger)` — issue triage variant

**Callback interface (avoids circular dep):**

```ts
interface IConsensusCallbacks {
  runContributionRound(discussionId, personas, trigger, context): Promise<void>;
  triggerPRRefinement(discussionId, changesSummary, prNumber): Promise<void>;
}
```

**In DeliberationEngine:**

- Add `this.consensus = new ConsensusEvaluator(slackClient, config, this.board)` in constructor
- `startDiscussionInternal` / `handleHumanMessage` pass callback closures to `this.consensus.evaluateConsensus(...)`

**New test file:** `packages/slack/src/__tests__/slack/consensus-evaluator.test.ts`

---

## Phase 4 — TriggerRouter ⬜

**New file:** `packages/slack/src/trigger-router.ts`

**Constructor:** `(parser, slackClient, engine, jobSpawner, state, contextFetcher, config)`

**Methods to move from `SlackInteractionListener`:**

- `triggerDirectProviderIfRequested(...)` (lines 703–776)
- `triggerSlackJobIfRequested(...)` (lines 778–870)
- `triggerIssuePickupIfRequested(...)` (lines 872–961)
- `triggerIssueReviewIfFound(...)` (lines 968–1007)
- `isMessageAddressedToBot(event)`
- `resolveTargetProject(channel, projects, hint?)`
- `resolveProjectByHint(projects, hint)`

**New method:** `async tryRoute(ctx: ITriggerContext): Promise<boolean>`
Calls triggers in priority order, returns on first match.

**In SlackInteractionListener:**

- Add `this.triggerRouter = new TriggerRouter(...)` in constructor
- `handleInboundMessage` replaces 4 trigger checks with `if (await this.triggerRouter.tryRoute(ctx)) return;`

**New test file:** `packages/slack/src/__tests__/slack/trigger-router.test.ts`

---

## Phase 5 — CascadingReplyHandler ⬜

**New file:** `packages/slack/src/cascading-reply-handler.ts`

**Constructor:** `(slackClient: SlackClient, engine: DeliberationEngine, state: ThreadStateManager)`

**Methods to move from `SlackInteractionListener`:**

- `followAgentMentions(postedText, channel, threadTs, personas, projectContext, skipPersonaId)`
- `maybePiggybackReply(channel, threadTs, text, personas, projectContext, excludePersonaId)`
- `engageMultiplePersonas(channel, threadTs, messageTs, text, personas, projectContext)`
- `recoverPersonaFromThreadHistory(channel, threadTs, personas)`
- `applyHumanResponseTiming(channel, messageTs, persona)`
- `maybeReactToHumanMessage(channel, messageTs, persona)`
- `reactionCandidatesForPersona(persona)`

**Constants to move:**

- `HUMAN_REACTION_PROBABILITY`, `RANDOM_REACTION_PROBABILITY`
- `REACTION_DELAY_MIN/MAX_MS`, `RESPONSE_DELAY_MIN/MAX_MS`
- `PIGGYBACK_REPLY_PROBABILITY`, `PIGGYBACK_DELAY_MIN/MAX_MS`

**In SlackInteractionListener:**

- Add `this.replyHandler = new CascadingReplyHandler(this.slackClient, this.engine, this.state)`
- `handleInboundMessage` becomes a clean ~80-line routing chain

**New test file:** `packages/slack/src/__tests__/slack/cascading-reply-handler.test.ts`

---

## Acceptance Criteria

- [ ] All 5 phases complete
- [ ] `yarn workspace @night-watch/slack test` — all pass
- [ ] `yarn verify` — type-check + lint clean
- [ ] `index.ts` exports unchanged
- [ ] `factory.ts` unchanged
- [ ] `deliberation.ts` < 800 lines
- [ ] `interaction-listener.ts` < 500 lines
- [ ] No new module > 400 lines
