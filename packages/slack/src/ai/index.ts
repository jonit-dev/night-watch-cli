/**
 * AI module barrel exports.
 */

export type { IResolvedAIConfig } from './provider.js';
export { joinBaseUrl, resolveGlobalAIConfig, resolvePersonaAIConfig } from './provider.js';
export type { IAnthropicTool, ToolHandler, ToolRegistry } from './tools.js';
export {
  buildBoardTools,
  buildCodebaseQueryTool,
  buildFilesystemTools,
  executeBoardTool,
  executeCodebaseQuery,
  executeReadRoadmap,
  fetchRepoLabels,
} from './tools.js';
export { callAIForContribution, callAIWithTools, callSimpleAI } from './client.js';
export { matchPersonaToMessage } from './persona-matcher.js';
