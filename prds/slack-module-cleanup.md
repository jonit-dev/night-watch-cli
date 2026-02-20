# PRD: `src/slack/` Module Cleanup

**Status:** Draft
**Priority:** High
**Scope:** `src/slack/` — 3,878 LOC across 5 files (two are ~1,730 lines each)

---

## Problem

The `src/slack/` module has grown into two monolith files — `deliberation.ts` (1,729 LOC) and `interaction-listener.ts` (1,738 LOC) — that each handle 8-12 unrelated concerns. This makes them hard to maintain, test, and extend without side-effect risk.

### Key Issues

**SRP violations** — single files own too many responsibilities:
- `deliberation.ts` mixes: AI provider HTTP calls, tool-use agentic loops, board tool definitions/execution, text humanization, prompt building, discussion orchestration, consensus evaluation, PR refinement, issue opening, audit report handling, proactive messages, and code analysis
- `interaction-listener.ts` mixes: Socket Mode event parsing, NLP-style message parsing (jobs, providers, issues), persona scoring/selection, handle/mention resolution, channel activity tracking, ad-hoc thread state, proactive scheduling, code watch spawning, process spawning, project resolution, roadmap context, GitHub context fetching, and a 160-line message routing method

**DRY violations** — logic duplicated across the two files:
- `buildCurrentCliInvocation()` — identical in both files
- `formatCommandForLog()` — identical in both files
- `sleep()` — identical in both files
- Persona lookup: `findDev`/`findCarlos`/`findPersona` in deliberation vs `_findPersonaByName`/`_pickRandomPersona` in interaction-listener — overlapping intent
- Error message extraction `err instanceof Error ? err.message : String(err)` — 10+ occurrences
- "Which project? Registered: ..." response — duplicated 3 times in interaction-listener
- Text normalization: `normalizeForComparison()` vs `normalizeForParsing()` — near-identical intent

**Testability** — `deliberation.ts` has only 47+191 lines of test coverage (humanizer + routing helpers). The `DeliberationEngine` class is untestable without mocking fetch, child_process, and the entire repository layer because all dependencies are hardcoded.

**Extensibility** — adding a new AI provider, trigger type, or board tool requires editing the 1,730-line deliberation file. No plugin points, no interface boundaries.

---

## Target Architecture

Extract single-responsibility modules from the two monoliths. Each module owns one concern, is independently testable, and communicates through explicit interfaces.

```
src/slack/
├── index.ts                        # barrel re-exports
├── client.ts                       # SlackClient (unchanged, already clean)
├── channel-manager.ts              # channel lifecycle (minor cleanup)
├── deliberation/
│   ├── index.ts                    # re-exports DeliberationEngine
│   ├── engine.ts                   # orchestration only: start, contribute, consensus loop
│   ├── consensus.ts                # _evaluateConsensus + related prompt
│   ├── prompts.ts                  # buildContributionPrompt, buildConsensusPrompt, buildOpeningMessage, etc.
│   └── issue-opener.ts             # triggerIssueOpener, handleAuditReport, _generateIssueBody
├── interaction/
│   ├── index.ts                    # re-exports SlackInteractionListener
│   ├── listener.ts                 # Socket Mode setup, event dispatch (thin router)
│   ├── message-router.ts           # _handleInboundMessage decomposed into strategy calls
│   ├── parsers.ts                  # parseSlackJobRequest, parseSlackProviderRequest, parseSlackIssuePickupRequest, isAmbientTeamMessage
│   ├── job-spawner.ts              # _spawnNightWatchJob, _spawnDirectProviderRequest
│   └── proactive.ts                # proactive message loop, code watch scheduling
├── ai/
│   ├── provider.ts                 # resolveGlobalAIConfig, resolvePersonaAIConfig, IResolvedAIConfig
│   ├── client.ts                   # callAIForContribution, callAIWithTools (HTTP calls)
│   └── tools.ts                    # buildBoardTools, executeBoardTool
├── humanizer.ts                    # humanizeSlackReply + all emoji/sentence/dedup helpers
├── personas.ts                     # findPersona, findDev, findCarlos, getParticipatingPersonas, scorePersonaForText, selectFollowUpPersona, getPersonaDomain, resolvePersonasByPlainName, resolveMentionedPersonas, extractMentionHandles
└── utils.ts                        # sleep, buildCurrentCliInvocation, formatCommandForLog, normalizeText, extractErrorMessage
```

---

## Phases

### Phase 1: Extract shared utilities (zero behavior change)

Move duplicated free functions into `src/slack/utils.ts`:
- `sleep()`
- `buildCurrentCliInvocation()`
- `formatCommandForLog()`
- Merge `normalizeForComparison()` + `normalizeForParsing()` into a single `normalizeText()` with options
- Add `extractErrorMessage(err: unknown): string` to replace the `err instanceof Error ? ...` pattern

Update imports in `deliberation.ts` and `interaction-listener.ts` to use `./utils.js`. Existing tests must still pass.

**Verify:** `yarn verify` passes. All existing tests pass. No behavior change.

### Phase 2: Extract persona helpers

Move all persona resolution logic into `src/slack/personas.ts`:
- From `deliberation.ts`: `findPersona`, `findDev`, `findCarlos`, `getParticipatingPersonas`
- From `interaction-listener.ts`: `getPersonaDomain`, `scorePersonaForText`, `selectFollowUpPersona`, `resolvePersonasByPlainName`, `resolveMentionedPersonas`, `extractMentionHandles`, `normalizeHandle`
- Consolidate `_findPersonaByName` in interaction-listener to use `findPersona` from the shared module

Write tests for the consolidated persona module. Update imports.

**Verify:** `yarn verify` passes. Existing + new persona tests pass.

### Phase 3: Extract humanizer

Move `humanizeSlackReply` and all supporting functions into `src/slack/humanizer.ts`:
- `humanizeSlackReply`
- `isSkipMessage`
- `dedupeRepeatedSentences`
- `limitEmojiCount`
- `isFacialEmoji`
- `applyEmojiPolicy`
- `trimToSentences`
- `CANNED_PHRASE_PREFIXES`
- Constants: `MAX_HUMANIZED_SENTENCES`, `MAX_HUMANIZED_CHARS`

The existing `deliberation-humanizer.test.ts` should work with updated import paths.

**Verify:** `yarn verify` passes. Humanizer tests pass unchanged.

### Phase 4: Extract AI provider layer

Create `src/slack/ai/` directory:
- `provider.ts`: `IResolvedAIConfig`, `resolveGlobalAIConfig()`, `resolvePersonaAIConfig()`, `joinBaseUrl()`
- `client.ts`: `callAIForContribution()`, `callAIWithTools()` — accept `IResolvedAIConfig` as parameter instead of resolving internally
- `tools.ts`: `IAnthropicTool`, `buildBoardTools()`, `executeBoardTool()`

This is the most impactful extraction — it decouples AI calling from discussion orchestration and makes provider logic testable/mockable independently.

**Verify:** `yarn verify` passes. Manual smoke test with a Slack discussion.

### Phase 5: Extract interaction sub-modules

Break `interaction-listener.ts` into focused files under `src/slack/interaction/`:
- `parsers.ts`: `parseSlackJobRequest`, `parseSlackProviderRequest`, `parseSlackIssuePickupRequest`, `isAmbientTeamMessage`, `stripSlackUserMentions`, `normalizeForParsing` (re-export from utils), related interfaces and constants
- `job-spawner.ts`: `_spawnNightWatchJob`, `_spawnDirectProviderRequest` — extract as a `JobSpawner` class or standalone functions that accept a `SlackClient` + config
- `proactive.ts`: proactive message loop, code watch scheduling, idle detection
- `message-router.ts`: the routing logic from `_handleInboundMessage` — extract the sequential "try job → try provider → try issue pickup → try mention → try discussion → try ad-hoc → try auto-engage" chain into a strategy/chain pattern
- `listener.ts`: slim `SlackInteractionListener` that owns Socket Mode lifecycle and delegates to the above

Existing `interaction-listener.test.ts` should continue to pass with updated imports.

**Verify:** `yarn verify` passes. All existing tests pass.

### Phase 6: Split deliberation engine

Break `deliberation.ts` into focused files under `src/slack/deliberation/`:
- `prompts.ts`: `buildContributionPrompt`, `buildOpeningMessage`, `buildIssueTitleFromTrigger`, `hasConcreteCodeContext`, `loadPrDiffExcerpt`, consensus prompt template
- `consensus.ts`: `_evaluateConsensus` logic (extract from the engine class, or keep as a method that calls helpers)
- `issue-opener.ts`: `triggerIssueOpener`, `handleAuditReport`, `_generateIssueBody`, `triggerPRRefinement`
- `engine.ts`: slim `DeliberationEngine` that orchestrates: start discussion, contribute, delegate to consensus/issue-opener

**Verify:** `yarn verify` passes. Existing deliberation tests pass.

### Phase 7: Test coverage for extracted modules

Add unit tests for modules that currently have zero coverage:
- `src/slack/ai/provider.ts` — config resolution for anthropic/openai, per-persona overrides
- `src/slack/ai/tools.ts` — board tool definitions, executeBoardTool with mocked provider
- `src/slack/interaction/parsers.ts` — extend existing parser tests
- `src/slack/interaction/job-spawner.ts` — verify spawn args, env vars
- `src/slack/deliberation/prompts.ts` — prompt construction for each trigger type

**Verify:** `yarn verify` passes. Test coverage for `src/slack/` improves meaningfully.

### Phase 8: Minor cleanups

- Move `roleAvatarColor()` and `getFallbackAvatarUrl()` from `client.ts` into a dedicated `src/slack/avatars.ts` (they are avatar concerns, not Slack API concerns)
- Clean up `channel-manager.ts`: extract the repeated "find persona, post as persona, catch error" pattern into a helper
- Update `src/slack/index.ts` barrel to re-export from new sub-module paths
- Remove any dead code surfaced by the refactor

**Verify:** `yarn verify` passes. Full test suite green.

---

## Constraints

- **Zero behavior change** — every phase is a pure refactor. No new features, no changed logic.
- **Incremental** — each phase produces a working, verifiable state. Phases can be committed independently.
- **Import convention** — use `@/slack/*` path aliases per project conventions. Single-level `./` is fine within the `src/slack/` tree.
- **No new dependencies** — this is restructuring, not rewriting.
- **Existing tests must pass** at every phase boundary.

---

## Done Criteria

- [ ] No file in `src/slack/` exceeds ~400 LOC
- [ ] `deliberation.ts` and `interaction-listener.ts` are replaced by focused sub-modules
- [ ] All duplicated functions exist in exactly one place
- [ ] `yarn verify` passes
- [ ] All existing tests pass with updated imports
- [ ] New unit tests cover extracted AI, persona, and parser modules
- [ ] Each module has a single, describable responsibility
