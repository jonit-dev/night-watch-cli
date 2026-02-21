/**
 * Tests for AI provider configuration resolution.
 */

import { describe, expect, it } from 'vitest';
import type { INightWatchConfig } from '@night-watch/core';
import { resolveGlobalAIConfig, resolvePersonaAIConfig } from '../../ai/provider.js';

function buildClaudeConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    provider: 'claude',
    projectsPath: '/test/projects',
    ...overrides,
  } as INightWatchConfig;
}

function buildOpenAIConfig(overrides: Partial<INightWatchConfig> = {}): INightWatchConfig {
  return {
    provider: 'openai',
    projectsPath: '/test/projects',
    ...overrides,
  } as INightWatchConfig;
}

describe('resolveGlobalAIConfig', () => {
  it('should default maxTokens to 1024 for claude provider', () => {
    const config = resolveGlobalAIConfig(buildClaudeConfig());
    expect(config.maxTokens).toBe(1024);
  });

  it('should default maxTokens to 1024 for openai provider', () => {
    const config = resolveGlobalAIConfig(buildOpenAIConfig());
    expect(config.maxTokens).toBe(1024);
  });

  it('resolves anthropic provider for claude config', () => {
    const config = resolveGlobalAIConfig(buildClaudeConfig());
    expect(config.provider).toBe('anthropic');
  });

  it('resolves openai provider for openai config', () => {
    const config = resolveGlobalAIConfig(buildOpenAIConfig());
    expect(config.provider).toBe('openai');
  });
});

describe('resolvePersonaAIConfig', () => {
  it('should default maxTokens to 1024 when persona has no modelConfig', () => {
    const persona = { id: 'p1', name: 'Maya', role: 'Security', modelConfig: undefined } as any;
    const config = resolvePersonaAIConfig(persona, buildClaudeConfig());
    expect(config.maxTokens).toBe(1024);
  });

  it('should use persona modelConfig maxTokens when specified', () => {
    const persona = {
      id: 'p1',
      name: 'Dev',
      role: 'Implementer',
      modelConfig: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        maxTokens: 2048,
      },
    } as any;
    const config = resolvePersonaAIConfig(persona, buildClaudeConfig());
    expect(config.maxTokens).toBe(2048);
  });

  it('should fall back to 1024 when persona modelConfig omits maxTokens', () => {
    const persona = {
      id: 'p1',
      name: 'Dev',
      role: 'Implementer',
      modelConfig: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      },
    } as any;
    const config = resolvePersonaAIConfig(persona, buildClaudeConfig());
    expect(config.maxTokens).toBe(1024);
  });
});
