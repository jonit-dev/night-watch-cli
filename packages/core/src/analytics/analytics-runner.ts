/**
 * Analytics runner: fetches Amplitude data, analyzes with AI provider, creates board issues.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BoardColumnName } from '../board/types.js';
import { createBoardProvider } from '../board/factory.js';
import { INightWatchConfig } from '../types.js';
import { resolveJobProvider, resolvePreset } from '../config.js';
import { CLAUDE_MODEL_IDS, DEFAULT_ANALYTICS_PROMPT, PROVIDER_COMMANDS } from '../constants.js';
import { executeScriptWithOutput } from '../utils/shell.js';
import { createLogger } from '../utils/logger.js';
import { fetchAmplitudeData } from './amplitude-client.js';

const logger = createLogger('analytics');

export interface IAnalyticsResult {
  issuesCreated: number;
  summary: string;
}

interface IRecommendedIssue {
  title: string;
  body: string;
  labels?: string[];
}

function parseIssuesFromResponse(text: string): IRecommendedIssue[] {
  // Find the first JSON array bracket pair in the response
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is IRecommendedIssue =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).title === 'string' &&
        typeof (item as Record<string, unknown>).body === 'string',
    );
  } catch {
    logger.warn('Failed to parse AI response as JSON');
    return [];
  }
}

export async function runAnalytics(
  config: INightWatchConfig,
  projectDir: string,
): Promise<IAnalyticsResult> {
  const apiKey = config.providerEnv?.AMPLITUDE_API_KEY;
  const secretKey = config.providerEnv?.AMPLITUDE_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error(
      'AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY must be set in providerEnv to run analytics',
    );
  }

  // 1. Fetch Amplitude data
  logger.info('Fetching Amplitude data', { lookbackDays: config.analytics.lookbackDays });
  const data = await fetchAmplitudeData(apiKey, secretKey, config.analytics.lookbackDays);

  // 2. Build prompt
  const systemPrompt = config.analytics.analysisPrompt?.trim() || DEFAULT_ANALYTICS_PROMPT;
  const prompt = `${systemPrompt}\n\n--- AMPLITUDE DATA ---\n${JSON.stringify(data, null, 2)}`;

  // 3. Write prompt to temp file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-analytics-'));
  const promptFile = path.join(tmpDir, 'analytics-prompt.md');
  fs.writeFileSync(promptFile, prompt, 'utf-8');

  try {
    // 4. Invoke AI provider
    const provider = resolveJobProvider(config, 'analytics');
    let providerCmd = PROVIDER_COMMANDS[provider];

    // Custom presets (e.g. glm-5) are not in PROVIDER_COMMANDS — resolve from preset
    if (!providerCmd) {
      const preset = resolvePreset(config, provider);
      providerCmd = preset.command;
    }

    let scriptContent: string;

    if (providerCmd === 'claude') {
      const modelId = CLAUDE_MODEL_IDS[config.claudeModel ?? 'sonnet'];
      scriptContent = `#!/usr/bin/env bash\nset -euo pipefail\n${providerCmd} -p "$(cat ${promptFile})" --model ${modelId} --dangerously-skip-permissions 2>&1\n`;
    } else {
      scriptContent = `#!/usr/bin/env bash\nset -euo pipefail\n${providerCmd} exec --yolo "$(cat ${promptFile})" 2>&1\n`;
    }

    const scriptFile = path.join(tmpDir, 'run-analytics.sh');
    fs.writeFileSync(scriptFile, scriptContent, { mode: 0o755 });

    const { exitCode, stdout, stderr } = await executeScriptWithOutput(
      scriptFile,
      [],
      config.providerEnv ?? {},
    );

    if (exitCode !== 0) {
      throw new Error(`AI provider exited with code ${exitCode}: ${stderr || stdout}`);
    }

    const fullOutput = `${stdout}\n${stderr}`;

    // 5. Parse issues from AI response
    const issues = parseIssuesFromResponse(fullOutput);

    if (issues.length === 0) {
      logger.info('No actionable insights found');
      return { issuesCreated: 0, summary: 'No actionable insights found' };
    }

    // 6. Create board issues
    const boardProvider = createBoardProvider(config.boardProvider, projectDir);
    const targetColumn: BoardColumnName = config.analytics.targetColumn;
    let created = 0;

    for (const issue of issues) {
      try {
        await boardProvider.createIssue({
          title: issue.title,
          body: issue.body,
          column: targetColumn,
          labels: issue.labels ?? ['analytics'],
        });
        created++;
        logger.info('Created board issue', { title: issue.title, column: targetColumn });
      } catch (err) {
        logger.error('Failed to create board issue', {
          title: issue.title,
          error: String(err),
        });
      }
    }

    return {
      issuesCreated: created,
      summary: `Created ${created} issue(s) from analytics insights`,
    };
  } finally {
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
