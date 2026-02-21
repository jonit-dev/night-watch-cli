/**
 * Proactive messaging loop for the Slack interaction listener.
 * Periodically sends idle-channel messages and code-watch audits.
 */

import { IAgentPersona, INightWatchConfig, createLogger, getRepositories } from '@night-watch/core';

const log = createLogger('proactive');
import type { IRegistryEntry } from '@night-watch/core';
import * as fs from 'fs';
import { basename } from 'node:path';
import { injectable } from 'tsyringe';
import { DeliberationEngine } from './deliberation.js';
import { JobSpawner } from './job-spawner.js';
import type { IJobSpawnerCallbacks } from './job-spawner.js';

const PROACTIVE_IDLE_MS = 20 * 60_000; // 20 min
const PROACTIVE_MIN_INTERVAL_MS = 90 * 60_000; // per channel
const PROACTIVE_SWEEP_INTERVAL_MS = 60_000;
const PROACTIVE_CODEWATCH_MIN_INTERVAL_MS = 3 * 60 * 60_000; // per project

export interface IProactiveLoopCallbacks {
  markChannelActivity(channel: string): void;
  buildProjectContext(channel: string, projects: IRegistryEntry[]): string;
  buildRoadmapContext(channel: string, projects: IRegistryEntry[]): string;
}

@injectable()
export class ProactiveLoop {
  private readonly config: INightWatchConfig;
  private readonly engine: DeliberationEngine;
  private readonly jobSpawner: JobSpawner;
  private readonly jobCallbacks: IJobSpawnerCallbacks;
  private readonly callbacks: IProactiveLoopCallbacks;
  private readonly channelActivityAt: Map<string, number>;
  private readonly lastProactiveAt = new Map<string, number>();
  private readonly lastCodeWatchAt = new Map<string, number>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: INightWatchConfig,
    engine: DeliberationEngine,
    jobSpawner: JobSpawner,
    jobCallbacks: IJobSpawnerCallbacks,
    lastChannelActivityAt: Map<string, number>,
    callbacks: IProactiveLoopCallbacks,
  ) {
    this.config = config;
    this.engine = engine;
    this.jobSpawner = jobSpawner;
    this.jobCallbacks = jobCallbacks;
    this.channelActivityAt = lastChannelActivityAt;
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.sweepTimer) return;

    this.sweepTimer = setInterval(() => {
      void this.sendProactiveMessages();
    }, PROACTIVE_SWEEP_INTERVAL_MS);

    this.sweepTimer.unref?.();
  }

  stop(): void {
    if (!this.sweepTimer) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  private resolveProactiveChannelForProject(project: IRegistryEntry): string | null {
    if (!this.config.slack) return null;
    return project.slackChannelId || null;
  }

  private async runProactiveCodeWatch(projects: IRegistryEntry[], now: number): Promise<void> {
    for (const project of projects) {
      if (!fs.existsSync(project.path)) continue;

      const channel = this.resolveProactiveChannelForProject(project);
      if (!channel) continue;

      const lastScan = this.lastCodeWatchAt.get(project.path) ?? 0;
      if (now - lastScan < PROACTIVE_CODEWATCH_MIN_INTERVAL_MS) {
        continue;
      }
      this.lastCodeWatchAt.set(project.path, now);

      this.jobSpawner.spawnCodeWatchAudit(project, channel, this.jobCallbacks);
    }
  }

  private async sendProactiveMessages(): Promise<void> {
    const slack = this.config.slack;
    if (!slack?.enabled || !slack.discussionEnabled) return;

    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    if (personas.length === 0) return;

    const now = Date.now();
    const projects = repos.projectRegistry.getAll();
    await this.runProactiveCodeWatch(projects, now);

    const channelProjects = projects.filter((p) => p.slackChannelId);
    if (channelProjects.length === 0) return;

    for (const project of channelProjects) {
      const channel = project.slackChannelId!;
      const lastActivity = this.channelActivityAt.get(channel) ?? now;
      const lastProactive = this.lastProactiveAt.get(channel) ?? 0;
      if (now - lastActivity < PROACTIVE_IDLE_MS) continue;
      if (now - lastProactive < PROACTIVE_MIN_INTERVAL_MS) continue;

      const persona = this.pickRandomPersona(personas);
      if (!persona) continue;

      const projectContext = this.callbacks.buildProjectContext(channel, projects);
      const roadmapContext = this.callbacks.buildRoadmapContext(channel, projects);
      const projectSlug = basename(project.path);

      try {
        await this.engine.postProactiveMessage(
          channel,
          persona,
          projectContext,
          roadmapContext,
          projectSlug,
        );
        this.lastProactiveAt.set(channel, now);
        this.callbacks.markChannelActivity(channel);
        log.info('proactive message posted', { agent: persona.name, channel });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('proactive message failed', { error: msg, channel });
      }
    }
  }

  private pickRandomPersona(personas: IAgentPersona[]): IAgentPersona | null {
    if (personas.length === 0) return null;
    return personas[Math.floor(Math.random() * personas.length)] ?? null;
  }
}
