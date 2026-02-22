/**
 * Job spawner for Night Watch CLI processes.
 * Handles spawning NW jobs, direct provider requests, and code-watch audits
 * as child processes from Slack interactions.
 */

import {
  IAgentPersona,
  INightWatchConfig,
  createLogger,
  parseScriptResult,
} from '@night-watch/core';
import type { IRegistryEntry } from '@night-watch/core';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { injectable } from 'tsyringe';
import { SlackClient } from './client.js';
import { DeliberationEngine } from './deliberation.js';
import type { ISlackProviderRequest, TSlackJobName } from './message-parser.js';
import {
  buildCurrentCliInvocation,
  buildSubprocessEnv,
  extractErrorMessage,
  formatCommandForLog,
  getNightWatchTsconfigPath,
} from './utils.js';

const log = createLogger('job-spawner');

const MAX_JOB_OUTPUT_CHARS = 12_000;

export interface IJobSpawnerCallbacks {
  markChannelActivity(channel: string): void;
  markPersonaReply(channel: string, threadTs: string, personaId: string): void;
}

/**
 * Extract the most useful lines from process output for error logging.
 * For stack traces, the error message is at the top, not the bottom.
 * Returns the first few non-empty lines (where the actual error is).
 */
function extractErrorSummary(output: string, maxLines = 8): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').trim()) // eslint-disable-line no-control-regex
    .filter(Boolean);
  if (lines.length === 0) return '';
  return lines.slice(0, maxLines).join(' | ');
}

@injectable()
export class JobSpawner {
  private readonly slackClient: SlackClient;
  private readonly engine: DeliberationEngine;
  private readonly config: INightWatchConfig;

  constructor(slackClient: SlackClient, engine: DeliberationEngine, config: INightWatchConfig) {
    this.slackClient = slackClient;
    this.engine = engine;
    this.config = config;
  }

  async spawnNightWatchJob(
    job: TSlackJobName,
    project: IRegistryEntry,
    channel: string,
    threadTs: string,
    persona: IAgentPersona,
    opts?: { prNumber?: string; fixConflicts?: boolean; issueNumber?: string },
    callbacks?: IJobSpawnerCallbacks,
  ): Promise<void> {
    const invocationArgs = buildCurrentCliInvocation([job]);
    const prRef = opts?.prNumber ? ` PR #${opts.prNumber}` : '';
    if (!invocationArgs) {
      log.warn('cannot start job: CLI entry path unavailable', {
        persona: persona.name,
        job,
        project: project.name,
      });
      await this.slackClient.postAsAgent(
        channel,
        `Can't start that ${job} right now — runtime issue. Checking it.`,
        persona,
        threadTs,
      );
      callbacks?.markChannelActivity(channel);
      callbacks?.markPersonaReply(channel, threadTs, persona.id);
      return;
    }

    log.info('spawning job', {
      persona: persona.name,
      project: project.name,
      ...(opts?.prNumber ? { pr: opts.prNumber } : {}),
      spawn: formatCommandForLog(process.execPath, invocationArgs),
    });

    const tsconfigPath = getNightWatchTsconfigPath();
    const child = spawn(process.execPath, invocationArgs, {
      cwd: project.path,
      env: buildSubprocessEnv({
        NW_EXECUTION_CONTEXT: 'agent',
        ...(tsconfigPath ? { TSX_TSCONFIG_PATH: tsconfigPath } : {}),
        ...(opts?.prNumber ? { NW_TARGET_PR: opts.prNumber } : {}),
        ...(opts?.issueNumber ? { NW_TARGET_ISSUE: opts.issueNumber } : {}),
        ...(opts?.fixConflicts
          ? {
              NW_SLACK_FEEDBACK: JSON.stringify({
                source: 'slack',
                kind: 'merge_conflict_resolution',
                prNumber: opts.prNumber ?? '',
                changes: 'Resolve merge conflicts and stabilize the PR for re-review.',
              }),
            }
          : {}),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    log.info('job spawned', {
      persona: persona.name,
      job,
      project: project.name,
      ...(opts?.prNumber ? { pr: opts.prNumber } : {}),
      pid: child.pid ?? 'unknown',
    });

    let output = '';
    let errored = false;
    const appendOutput = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.length > MAX_JOB_OUTPUT_CHARS) {
        output = output.slice(-MAX_JOB_OUTPUT_CHARS);
      }
    };

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    child.on('error', async (err) => {
      errored = true;
      log.warn('job spawn error', {
        persona: persona.name,
        job,
        project: project.name,
        ...(opts?.prNumber ? { pr: opts.prNumber } : {}),
        error: err.message,
      });
      await this.slackClient.postAsAgent(
        channel,
        `Couldn't kick off that ${job}. Error logged — looking into it.`,
        persona,
        threadTs,
      );
      callbacks?.markChannelActivity(channel);
      callbacks?.markPersonaReply(channel, threadTs, persona.id);
    });

    child.on('close', async (code) => {
      if (errored) return;
      log.info('job finished', {
        persona: persona.name,
        job,
        project: project.name,
        ...(opts?.prNumber ? { pr: opts.prNumber } : {}),
        exit: code ?? 'unknown',
      });
      const parsed = parseScriptResult(output);
      const status = parsed?.status ? ` (${parsed.status})` : '';
      const detail = extractErrorSummary(output);

      if (code === 0) {
        let doneMessage: string;
        if (job === 'review') {
          doneMessage = `Review done${prRef ? ` on${prRef}` : ''}.`;
        } else if (job === 'qa') {
          doneMessage = `QA pass done${prRef ? ` on${prRef}` : ''}.`;
        } else {
          doneMessage = `Run finished${prRef ? ` for${prRef}` : ''}.`;
        }
        await this.slackClient.postAsAgent(channel, doneMessage, persona, threadTs);
      } else {
        if (detail) {
          log.warn('job failure detail', { persona: persona.name, job, detail });
        }
        await this.slackClient.postAsAgent(
          channel,
          `Hit a snag running ${job}${prRef ? ` on${prRef}` : ''}. Logged the details — looking into it.`,
          persona,
          threadTs,
        );
      }
      if (code !== 0 && status) {
        log.warn('job non-zero status', {
          persona: persona.name,
          job,
          status: status.replace(/[()]/g, ''),
        });
      }
      callbacks?.markChannelActivity(channel);
      callbacks?.markPersonaReply(channel, threadTs, persona.id);
    });
  }

  async spawnDirectProviderRequest(
    request: ISlackProviderRequest,
    project: IRegistryEntry,
    channel: string,
    threadTs: string,
    persona: IAgentPersona,
    callbacks?: IJobSpawnerCallbacks,
  ): Promise<void> {
    const providerLabel = request.provider === 'claude' ? 'Claude' : 'Codex';
    const args =
      request.provider === 'claude'
        ? ['-p', request.prompt, '--dangerously-skip-permissions']
        : ['--quiet', '--yolo', '--prompt', request.prompt];

    log.info('spawning provider', {
      persona: persona.name,
      provider: request.provider,
      project: project.name,
      spawn: formatCommandForLog(request.provider, args),
    });

    const child = spawn(request.provider, args, {
      cwd: project.path,
      env: buildSubprocessEnv({
        ...(this.config.providerEnv ?? {}),
        NW_EXECUTION_CONTEXT: 'agent',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    log.info('provider spawned', {
      persona: persona.name,
      provider: request.provider,
      project: project.name,
      pid: child.pid ?? 'unknown',
    });

    let output = '';
    let errored = false;
    // eslint-disable-next-line sonarjs/no-identical-functions
    const appendOutput = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.length > MAX_JOB_OUTPUT_CHARS) {
        output = output.slice(-MAX_JOB_OUTPUT_CHARS);
      }
    };

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    child.on('error', async (err) => {
      errored = true;
      log.warn('provider spawn error', {
        persona: persona.name,
        provider: request.provider,
        project: project.name,
        error: err.message,
      });
      await this.slackClient.postAsAgent(
        channel,
        `Couldn't start ${providerLabel}. Error logged — looking into it.`,
        persona,
        threadTs,
      );
      callbacks?.markChannelActivity(channel);
      callbacks?.markPersonaReply(channel, threadTs, persona.id);
    });

    child.on('close', async (code) => {
      if (errored) return;
      log.info('provider finished', {
        persona: persona.name,
        provider: request.provider,
        project: project.name,
        exit: code ?? 'unknown',
      });

      const detail = extractErrorSummary(output);
      if (code === 0) {
        await this.slackClient.postAsAgent(
          channel,
          `${providerLabel} command finished.`,
          persona,
          threadTs,
        );
      } else {
        if (detail) {
          log.warn('provider failure detail', {
            persona: persona.name,
            provider: request.provider,
            detail,
          });
        }
        await this.slackClient.postAsAgent(
          channel,
          `${providerLabel} hit a snag. Logged the details — looking into it.`,
          persona,
          threadTs,
        );
      }

      callbacks?.markChannelActivity(channel);
      callbacks?.markPersonaReply(channel, threadTs, persona.id);
    });
  }

  spawnCodeWatchAudit(
    project: IRegistryEntry,
    channel: string,
    callbacks?: IJobSpawnerCallbacks,
  ): void {
    if (!fs.existsSync(project.path)) {
      log.warn('audit skipped: missing project path', {
        project: project.name,
        path: project.path,
      });
      return;
    }

    const invocationArgs = buildCurrentCliInvocation(['audit']);
    if (!invocationArgs) {
      log.warn('audit spawn failed: CLI entry path unavailable', { project: project.name });
      return;
    }

    log.info('spawning audit', {
      project: project.name,
      channel,
      cmd: formatCommandForLog(process.execPath, invocationArgs),
    });

    const startedAt = Date.now();
    const tsconfigPath = getNightWatchTsconfigPath();
    const child = spawn(process.execPath, invocationArgs, {
      cwd: project.path,
      env: buildSubprocessEnv({
        NW_EXECUTION_CONTEXT: 'agent',
        ...(tsconfigPath ? { TSX_TSCONFIG_PATH: tsconfigPath } : {}),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    log.info('audit spawned', { project: project.name, pid: child.pid ?? 'unknown' });
    let output = '';
    // eslint-disable-next-line sonarjs/no-identical-functions
    const appendOutput = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.length > MAX_JOB_OUTPUT_CHARS) {
        output = output.slice(-MAX_JOB_OUTPUT_CHARS);
      }
    };

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    let spawnErrored = false;
    child.on('error', (err) => {
      spawnErrored = true;
      log.warn('audit spawn error', { project: project.name, error: err.message });
    });

    child.on('close', async (code) => {
      log.info('audit finished', { project: project.name, exit: code ?? 'unknown' });
      if (spawnErrored) {
        return;
      }

      if (code !== 0) {
        const detail = extractErrorSummary(output);
        if (detail) {
          log.warn('audit failure detail', { project: project.name, detail });
        }
        return;
      }

      const reportPath = path.join(project.path, 'logs', 'audit-report.md');
      let reportStat: fs.Stats;
      let report: string;
      try {
        reportStat = fs.statSync(reportPath);
        report = fs.readFileSync(reportPath, 'utf-8').trim();
      } catch {
        const parsed = parseScriptResult(output);
        if (parsed?.status?.startsWith('skip_')) {
          log.info('audit skipped', { project: project.name, status: parsed.status });
        } else {
          log.info('no audit report found', { project: project.name, path: reportPath });
        }
        return;
      }

      // Ignore old reports when an audit exits early without producing a fresh output.
      if (reportStat.mtimeMs + 1000 < startedAt) {
        log.info('stale audit report ignored', { project: project.name, path: reportPath });
        return;
      }

      if (!report) {
        log.info('empty audit report ignored', { project: project.name, path: reportPath });
        return;
      }

      try {
        await this.engine.handleAuditReport(report, project.name, project.path, channel);
        callbacks?.markChannelActivity(channel);
      } catch (err) {
        log.warn('handleAuditReport failed', {
          project: project.name,
          error: extractErrorMessage(err),
        });
      }
    });
  }
}
