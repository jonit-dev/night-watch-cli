/**
 * AI client for making calls to Anthropic and OpenAI APIs.
 */

import type { IAgentPersona } from '@night-watch/core/shared/types.js';
import type { INightWatchConfig } from '@night-watch/core/types.js';
import { compileSoul } from '@night-watch/core/agents/soul-compiler.js';
import { joinBaseUrl, resolvePersonaAIConfig } from './provider.js';
import type { IAnthropicTool, ToolRegistry } from './tools.js';

/**
 * Call the AI provider to generate an agent contribution.
 * Uses the persona's model config or falls back to global config.
 * Returns the generated text.
 */
export async function callAIForContribution(
  persona: IAgentPersona,
  config: INightWatchConfig,
  contributionPrompt: string,
  maxTokensOverride?: number,
): Promise<string> {
  const soulPrompt = compileSoul(persona);
  const resolved = resolvePersonaAIConfig(persona, config);
  const maxTokens = maxTokensOverride ?? resolved.maxTokens;

  if (resolved.provider === 'anthropic') {
    const apiKey =
      resolved.envVars['ANTHROPIC_API_KEY'] ??
      resolved.envVars['ANTHROPIC_AUTH_TOKEN'] ??
      process.env.ANTHROPIC_API_KEY ??
      process.env.ANTHROPIC_AUTH_TOKEN ??
      '';

    const response = await fetch(joinBaseUrl(resolved.baseUrl, '/v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: resolved.model,
        max_tokens: maxTokens,
        system: soulPrompt,
        messages: [{ role: 'user', content: contributionPrompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${error}`);
    }

    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    return data.content[0]?.text?.trim() ?? '';
  } else if (resolved.provider === 'openai') {
    const apiKey = resolved.envVars['OPENAI_API_KEY'] ?? process.env.OPENAI_API_KEY ?? '';

    const response = await fetch(joinBaseUrl(resolved.baseUrl, '/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: resolved.model,
        max_tokens: maxTokens,
        temperature: resolved.temperature,
        messages: [
          { role: 'system', content: soulPrompt },
          { role: 'user', content: contributionPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() ?? '';
  }

  return `[${persona.name}: No AI provider configured]`;
}

/**
 * Agentic loop for Anthropic with tool use.
 * Calls the AI, executes any tool_use blocks, and loops until a final text reply is produced.
 * Tool execution is delegated to `registry` — a Map of tool name → handler function.
 */
export async function callAIWithTools(
  persona: IAgentPersona,
  config: INightWatchConfig,
  prompt: string,
  tools: IAnthropicTool[],
  registry: ToolRegistry,
): Promise<string> {
  const soulPrompt = compileSoul(persona);
  const resolved = resolvePersonaAIConfig(persona, config);

  const apiKey =
    resolved.envVars['ANTHROPIC_API_KEY'] ??
    resolved.envVars['ANTHROPIC_AUTH_TOKEN'] ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.ANTHROPIC_AUTH_TOKEN ??
    '';

  interface IAnthropicMessage {
    role: 'user' | 'assistant';
    content: unknown;
  }
  const messages: IAnthropicMessage[] = [{ role: 'user', content: prompt }];

  const MAX_TOOL_ITERATIONS = 5;
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await fetch(joinBaseUrl(resolved.baseUrl, '/v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: resolved.model,
        max_tokens: 1024,
        system: soulPrompt,
        tools,
        messages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${error}`);
    }

    type AnthropicContent =
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
    const data = (await response.json()) as {
      stop_reason: string;
      content: AnthropicContent[];
    };

    if (data.stop_reason !== 'tool_use') {
      // Final reply — extract text
      const textBlock = data.content.find((b) => b.type === 'text') as
        | { type: 'text'; text: string }
        | undefined;
      return textBlock?.text?.trim() ?? '';
    }

    // Execute all tool_use blocks
    const toolUseBlocks = data.content.filter((b) => b.type === 'tool_use') as Array<{
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }>;
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

    for (const block of toolUseBlocks) {
      let result: string;
      try {
        const handler = registry.get(block.name);
        result = handler ? await handler(block.input) : `Unknown tool: ${block.name}`;
      } catch (err) {
        result = `Error: ${String(err)}`;
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }

    // Append assistant turn and tool results to message history
    messages.push({ role: 'assistant', content: data.content });
    messages.push({ role: 'user', content: toolResults });
  }

  return `[${persona.name}: tool loop exceeded max iterations]`;
}
