export { SlackClient } from './client.js';
export type { ISlackMessage, ISlackChannel } from './client.js';
export { ChannelManager } from './channel-manager.js';
export { DeliberationEngine } from './deliberation.js';
export { createSlackStack } from './factory.js';
export type { ISlackStack } from './factory.js';
export { SlackInteractionListener } from './interaction-listener.js';

// Message parsing module
export { MessageParser } from './message-parser.js';
export type {
  IAdHocThreadState,
  IEventsApiPayload,
  IInboundSlackEvent,
  ISlackIssuePickupRequest,
  ISlackJobRequest,
  ISlackProviderRequest,
  TSlackJobName,
  TSlackProviderName,
} from './message-parser.js';

// Context fetching module
export { ContextFetcher } from './context-fetcher.js';

// Job spawner module
export { JobSpawner } from './job-spawner.js';
export type { IJobSpawnerCallbacks } from './job-spawner.js';

// Proactive loop module
export { ProactiveLoop } from './proactive-loop.js';
export type { IProactiveLoopCallbacks } from './proactive-loop.js';

// Humanizer module
export {
  humanizeSlackReply,
  isSkipMessage,
  MAX_HUMANIZED_SENTENCES,
  MAX_HUMANIZED_CHARS,
} from './humanizer.js';
export type { IHumanizeSlackReplyOptions } from './humanizer.js';

// Utils module
export {
  sleep,
  buildCurrentCliInvocation,
  getNightWatchTsconfigPath,
  formatCommandForLog,
  normalizeText,
  extractErrorMessage,
  normalizeProjectRef,
  stripSlackUserMentions,
  normalizeHandle,
} from './utils.js';
export type { INormalizeTextOptions } from './utils.js';

// Personas module
export {
  extractMentionHandles,
  findCarlos,
  findDev,
  findMaya,
  findPersona,
  findPriya,
  getParticipatingPersonas,
  getPersonaDomain,
  resolveMentionedPersonas,
  resolvePersonasByPlainName,
  scorePersonaForText,
  selectFollowUpPersona,
} from './personas.js';

// AI module
export type { IResolvedAIConfig, IAnthropicTool } from './ai/index.js';
export {
  buildBoardTools,
  callAIForContribution,
  callAIWithTools,
  executeBoardTool,
  joinBaseUrl,
  resolveGlobalAIConfig,
  resolvePersonaAIConfig,
} from './ai/index.js';
