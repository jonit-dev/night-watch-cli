/**
 * Slack channel lifecycle manager for Night Watch.
 * Auto-creates and archives project channels based on project lifecycle events.
 */

import { INightWatchConfig, getRepositories } from '@night-watch/core';
import { SlackClient } from './client.js';

/**
 * Slugify a project name for use as a Slack channel name.
 * Channel names: lowercase, hyphens, max 80 chars, no special chars.
 */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      // eslint-disable-next-line sonarjs/slow-regex
      .replace(/^-+|-+$/g, '')
      .slice(0, 73)
  ); // "proj-" prefix = 5 chars, leaving 75 for name (80 total)
}

export class ChannelManager {
  private readonly slackClient: SlackClient;
  private readonly config: INightWatchConfig;

  constructor(slackClient: SlackClient, config: INightWatchConfig) {
    this.slackClient = slackClient;
    this.config = config;
  }

  /**
   * Ensure a project channel exists for the given project.
   * Creates it if it doesn't exist and stores the channel ID.
   * Posts an intro message from Carlos.
   */
  async ensureProjectChannel(projectPath: string, projectName: string): Promise<string | null> {
    if (!this.config.slack?.enabled || !this.config.slack?.autoCreateProjectChannels) {
      return null;
    }

    const repos = getRepositories();
    const projects = repos.projectRegistry.getAll();
    const project = projects.find((p) => p.path === projectPath);

    // If channel already exists, return it
    if (project?.slackChannelId) {
      return project.slackChannelId;
    }

    try {
      const channelName = `proj-${slugify(projectName)}`;
      const channelId = await this.slackClient.createChannel(channelName);

      // Store channel ID
      repos.projectRegistry.updateSlackChannel(projectPath, channelId);

      // Post intro message from Carlos
      const personas = repos.agentPersona.getActive();
      const carlos = personas.find((p) => p.name === 'Carlos') ?? personas[0];

      if (carlos && channelId) {
        await this.slackClient.postAsAgent(
          channelId,
          `New project: ${projectName}. I'll be watching the architecture calls here.`,
          carlos,
        );
      }

      return channelId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to create Slack channel for project ${projectName}: ${message}`);
      return null;
    }
  }

  /**
   * Archive a project channel when all PRDs are done.
   * Posts a farewell message from Carlos before archiving.
   */
  async archiveProjectChannel(projectPath: string, projectName: string): Promise<void> {
    if (!this.config.slack?.enabled) return;

    const repos = getRepositories();
    const projects = repos.projectRegistry.getAll();
    const project = projects.find((p) => p.path === projectPath);

    if (!project?.slackChannelId) return;

    try {
      const personas = repos.agentPersona.getActive();
      const carlos = personas.find((p) => p.name === 'Carlos') ?? personas[0];

      if (carlos) {
        await this.slackClient.postAsAgent(
          project.slackChannelId,
          `All PRDs shipped for ${projectName}. Archiving this one.`,
          carlos,
        );
        // Small delay before archiving
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      await this.slackClient.archiveChannel(project.slackChannelId);
      repos.projectRegistry.updateSlackChannel(projectPath, '');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to archive Slack channel for project ${projectName}: ${message}`);
    }
  }

  /**
   * Post a release announcement to #releases when a PR is auto-merged.
   */
  async postReleaseAnnouncement(prTitle: string, branch: string, prUrl?: string): Promise<void> {
    if (!this.config.slack?.enabled || !this.config.slack?.channels?.releases) return;

    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    const dev = personas.find((p) => p.name === 'Dev') ?? personas[0];

    if (!dev) return;

    try {
      const text = `Shipped: ${prTitle} → ${branch}${prUrl ? `\n${prUrl}` : ''}`;
      await this.slackClient.postAsAgent(this.config.slack.channels.releases, text, dev);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to post release announcement: ${message}`);
    }
  }

  /**
   * Post a cross-channel #eng announcement.
   * Used for weekly summaries or important team updates.
   */
  async postEngAnnouncement(message: string, personaName = 'Carlos'): Promise<void> {
    if (!this.config.slack?.enabled || !this.config.slack?.channels?.eng) return;

    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    const persona = personas.find((p) => p.name === personaName) ?? personas[0];

    if (!persona) return;

    try {
      await this.slackClient.postAsAgent(this.config.slack.channels.eng, message, persona);
    } catch (err) {
      const message2 = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to post #eng announcement: ${message2}`);
    }
  }
}
