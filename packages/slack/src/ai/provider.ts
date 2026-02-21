/**
 * AI provider configuration resolution.
 * Handles Anthropic and OpenAI provider configs with per-persona overrides.
 */

import type { IAgentPersona, INightWatchConfig } from '@night-watch/core';

export interface IResolvedAIConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  baseUrl: string;
  envVars: Record<string, string>;
  maxTokens: number;
  temperature: number;
}

/**
 * Join a base URL with a route path, handling trailing slashes.
 */
export function joinBaseUrl(baseUrl: string, route: string): string {
  // eslint-disable-next-line sonarjs/slow-regex
  return `${baseUrl.replace(/\/+$/, '')}${route}`;
}

/**
 * Resolve the global AI configuration from Night Watch config.
 */
export function resolveGlobalAIConfig(config: INightWatchConfig): IResolvedAIConfig {
  const globalEnv = config.providerEnv ?? {};

  if (config.provider === 'claude') {
    return {
      provider: 'anthropic',
      model: config.claudeModel === 'opus' ? 'claude-opus-4-6' : 'claude-sonnet-4-6',
      baseUrl:
        globalEnv.ANTHROPIC_BASE_URL ??
        process.env.ANTHROPIC_BASE_URL ??
        'https://api.anthropic.com',
      envVars: globalEnv,
      maxTokens: 512,
      temperature: 0.8,
    };
  }

  return {
    provider: 'openai',
    model: globalEnv.OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o',
    baseUrl: globalEnv.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com',
    envVars: globalEnv,
    maxTokens: 512,
    temperature: 0.8,
  };
}

/**
 * Resolve AI configuration for a specific persona, with per-persona overrides.
 */
export function resolvePersonaAIConfig(
  persona: IAgentPersona,
  config: INightWatchConfig,
): IResolvedAIConfig {
  const modelConfig = persona.modelConfig;
  if (!modelConfig) {
    return resolveGlobalAIConfig(config);
  }

  const globalEnv = config.providerEnv ?? {};
  const envVars = { ...globalEnv, ...(modelConfig.envVars ?? {}) };
  const isAnthropic = modelConfig.provider === 'anthropic';

  return {
    provider: isAnthropic ? 'anthropic' : 'openai',
    model: modelConfig.model,
    baseUrl: isAnthropic
      ? (modelConfig.baseUrl ??
        globalEnv.ANTHROPIC_BASE_URL ??
        process.env.ANTHROPIC_BASE_URL ??
        'https://api.anthropic.com')
      : (modelConfig.baseUrl ??
        globalEnv.OPENAI_BASE_URL ??
        process.env.OPENAI_BASE_URL ??
        'https://api.openai.com'),
    envVars,
    maxTokens: modelConfig.maxTokens ?? 512,
    temperature: modelConfig.temperature ?? 0.8,
  };
}
