/**
 * AI module barrel exports.
 */

export type { IResolvedAIConfig } from './provider.js';
export { joinBaseUrl, resolveGlobalAIConfig, resolvePersonaAIConfig } from './provider.js';
export type { IAnthropicTool, ToolHandler, ToolRegistry } from './tools.js';
export {
  buildBoardTools,
  buildCodebaseQueryTool,
  executeBoardTool,
  executeCodebaseQuery,
} from './tools.js';
export { callAIForContribution, callAIWithTools } from './client.js';
