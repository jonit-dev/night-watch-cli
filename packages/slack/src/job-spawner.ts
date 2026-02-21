/**
 * Job spawner for Night Watch CLI processes.
 * Handles spawning NW jobs, direct provider requests, and code-watch audits
 * as child processes from Slack interactions.
 */

import { IAgentPersona, INightWatchConfig, parseScriptResult } from '@night-watch/core';
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
  formatCommandForLog,
  getNightWatchTsconfigPath,
} from './utils.js';

const MAX_JOB_OUTPUT_CHARS = 12_000;

export interface IJobSpawnerCallbacks {
  markChannelActivity(channel: string): void;
  markPersonaReply(channel: string, threadTs: string, personaId: string): void;
}

function extractLastMeaningfulLines(output: string, maxLines = 4): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  return lines.slice(-maxLines).join(' | ');
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
      console.warn(
        `[slack][job] ${persona.name} cannot start ${job} for ${project.name}${prRef ? ` (${prRef.trim()})` : ''}: CLI entry path unavailable`,
      );
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

    console.log(
      `[slack][job] persona=${persona.name} project=${project.name}${opts?.prNumber ? ` pr=${opts.prNumber}` : ''} spawn=${formatCommandForLog(process.execPath, invocationArgs)}`,
    );

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
    console.log(
      `[slack][job] ${persona.name} spawned ${job} for ${project.name}${opts?.prNumber ? ` (PR #${opts.prNumber})` : ''} pid=${child.pid ?? 'unknown'}`,
    );

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
      console.warn(
        `[slack][job] ${persona.name} ${job} spawn error for ${project.name}${opts?.prNumber ? ` (PR #${opts.prNumber})` : ''}: ${err.message}`,
      );
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
      console.log(
        `[slack][job] ${persona.name} ${job} finished for ${project.name}${opts?.prNumber ? ` (PR #${opts.prNumber})` : ''} exit=${code ?? 'unknown'}`,
      );
      const parsed = parseScriptResult(output);
      const status = parsed?.status ? ` (${parsed.status})` : '';
      const detail = extractLastMeaningfulLines(output);

      if (code === 0) {
        const doneMessage =
          job === 'review'
            ? `Review done${prRef ? ` on${prRef}` : ''}.`
            : job === 'qa'
              ? `QA pass done${prRef ? ` on${prRef}` : ''}.`
              : `Run finished${prRef ? ` for${prRef}` : ''}.`;
        await this.slackClient.postAsAgent(channel, doneMessage, persona, threadTs);
      } else {
        if (detail) {
          console.warn(`[slack][job] ${persona.name} ${job} failure detail: ${detail}`);
        }
        await this.slackClient.postAsAgent(
          channel,
          `Hit a snag running ${job}${prRef ? ` on${prRef}` : ''}. Logged the details — looking into it.`,
          persona,
          threadTs,
        );
      }
      if (code !== 0 && status) {
        console.warn(`[slack][job] ${persona.name} ${job} status=${status.replace(/[()]/g, '')}`);
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

    console.log(
      `[slack][provider] persona=${persona.name} provider=${request.provider} project=${project.name} spawn=${formatCommandForLog(request.provider, args)}`,
    );

    const child = spawn(request.provider, args, {
      cwd: project.path,
      env: buildSubprocessEnv({
        ...(this.config.providerEnv ?? {}),
        NW_EXECUTION_CONTEXT: 'agent',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(
      `[slack][provider] ${persona.name} spawned ${request.provider} for ${project.name} pid=${child.pid ?? 'unknown'}`,
    );

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
      console.warn(
        `[slack][provider] ${persona.name} ${request.provider} spawn error for ${project.name}: ${err.message}`,
      );
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
      console.log(
        `[slack][provider] ${persona.name} ${request.provider} finished for ${project.name} exit=${code ?? 'unknown'}`,
      );

      const detail = extractLastMeaningfulLines(output);
      if (code === 0) {
        await this.slackClient.postAsAgent(
          channel,
          `${providerLabel} command finished.`,
          persona,
          threadTs,
        );
      } else {
        if (detail) {
          console.warn(
            `[slack][provider] ${persona.name} ${request.provider} failure detail: ${detail}`,
          );
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
      console.warn(
        `[slack][codewatch] audit skipped for ${project.name}: missing project path ${project.path}`,
      );
      return;
    }

    const invocationArgs = buildCurrentCliInvocation(['audit']);
    if (!invocationArgs) {
      console.warn(
        `[slack][codewatch] audit spawn failed for ${project.name}: CLI entry path unavailable`,
      );
      return;
    }

    console.log(
      `[slack][codewatch] spawning audit for ${project.name} → ${channel} cmd=${formatCommandForLog(process.execPath, invocationArgs)}`,
    );

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

    console.log(
      `[slack][codewatch] audit spawned for ${project.name} pid=${child.pid ?? 'unknown'}`,
    );
    let output = '';
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
      console.warn(`[slack][codewatch] audit spawn error for ${project.name}: ${err.message}`);
    });

    child.on('close', async (code) => {
      console.log(
        `[slack][codewatch] audit finished for ${project.name} exit=${code ?? 'unknown'}`,
      );
      if (spawnErrored) {
        return;
      }

      if (code !== 0) {
        const detail = extractLastMeaningfulLines(output);
        if (detail) {
          console.warn(`[slack][codewatch] audit failure detail for ${project.name}: ${detail}`);
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
          console.log(`[slack][codewatch] audit skipped for ${project.name} (${parsed.status})`);
        } else {
          console.log(`[slack][codewatch] no audit report found at ${reportPath}`);
        }
        return;
      }

      // Ignore old reports when an audit exits early without producing a fresh output.
      if (reportStat.mtimeMs + 1000 < startedAt) {
        console.log(`[slack][codewatch] stale audit report ignored at ${reportPath}`);
        return;
      }

      if (!report) {
        console.log(`[slack][codewatch] empty audit report ignored at ${reportPath}`);
        return;
      }

      try {
        await this.engine.handleAuditReport(report, project.name, project.path, channel);
        callbacks?.markChannelActivity(channel);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[slack][codewatch] handleAuditReport failed for ${project.name}: ${msg}`);
      }
    });
  }
}
