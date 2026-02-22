/**
 * Tests for AI project matcher.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INightWatchConfig, IRegistryEntry } from '@night-watch/core';
import * as client from '../../ai/client.js';
import { matchProjectToMessage } from '../../ai/project-matcher.js';

const config: INightWatchConfig = {
  provider: 'claude',
  projectsPath: '/test/projects',
} as INightWatchConfig;

function makeProject(name: string, path: string): IRegistryEntry {
  return { name, path };
}

const nightWatch = makeProject('@jonit-dev/night-watch-cli', '/repos/night-watch-cli');
const autopilot = makeProject('autopilotrank', '/repos/autopilotrank');
const nwTest = makeProject('nw-test', '/repos/nw-test');
const projects = [nightWatch, autopilot, nwTest];

describe('matchProjectToMessage', () => {
  beforeEach(() => {
    vi.spyOn(client, 'callSimpleAI');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns matching project on exact name match', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('@jonit-dev/night-watch-cli');
    const result = await matchProjectToMessage('run yarn verify on night-watch-cli', projects, config);
    expect(result).toBe(nightWatch);
  });

  it('is case-insensitive', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('AUTOPILOTRANK');
    const result = await matchProjectToMessage('check autopilotrank pipeline', projects, config);
    expect(result).toBe(autopilot);
  });

  it('returns null when AI says "none"', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('none');
    const result = await matchProjectToMessage('just a general message', projects, config);
    expect(result).toBeNull();
  });

  it('returns null for unrecognized name', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('some-other-project');
    const result = await matchProjectToMessage('hello', projects, config);
    expect(result).toBeNull();
  });

  it('returns null for empty response', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('');
    const result = await matchProjectToMessage('hello', projects, config);
    expect(result).toBeNull();
  });

  it('returns null when callSimpleAI throws', async () => {
    vi.mocked(client.callSimpleAI).mockRejectedValue(new Error('API error'));
    const result = await matchProjectToMessage('hello', projects, config);
    expect(result).toBeNull();
  });

  it('returns null immediately for empty projects list', async () => {
    const result = await matchProjectToMessage('hello', [], config);
    expect(result).toBeNull();
    expect(client.callSimpleAI).not.toHaveBeenCalled();
  });

  it('returns the only project without AI call when list has one entry', async () => {
    const result = await matchProjectToMessage('hello', [nightWatch], config);
    expect(result).toBe(nightWatch);
    expect(client.callSimpleAI).not.toHaveBeenCalled();
  });

  it('passes only first 500 chars of message', async () => {
    vi.mocked(client.callSimpleAI).mockResolvedValue('none');
    const longMessage = 'x'.repeat(1000);
    await matchProjectToMessage(longMessage, projects, config);
    const userPrompt = vi.mocked(client.callSimpleAI).mock.calls[0]![1];
    expect(userPrompt).toContain('x'.repeat(500));
    expect(userPrompt).not.toContain('x'.repeat(501));
  });
});
