/**
 * BoardIntegration encapsulates all board/GitHub integration logic for the
 * Night Watch Slack bot.  Extracted from DeliberationEngine to keep board
 * concerns in a focused, single-responsibility class.
 */

import { execFileSync } from 'node:child_process';
import {
  type IAgentPersona,
  type IBoardProviderConfig,
  type IDiscussionTrigger,
  type INightWatchConfig,
  createBoardProvider,
  createLogger,
  getRepositories,
  loadConfig,
} from '@night-watch/core';
import type { SlackClient } from './client.js';
import { callAIForContribution } from './ai/index.js';
import { humanizeSlackReply } from './humanizer.js';
import { findCarlos, findDev } from './personas.js';
import { buildIssueTitleFromTrigger } from './deliberation-builders.js';
import { buildCurrentCliInvocation } from './utils.js';

const log = createLogger('board-integration');

export class BoardIntegration {
  constructor(
    private readonly slackClient: SlackClient,
    private readonly config: INightWatchConfig,
  ) {}

  /**
   * Load and validate the board provider config for the given project path.
   * Returns null when the board is not configured or disabled.
   */
  resolveBoardConfig(projectPath: string): IBoardProviderConfig | null {
    try {
      const cfg = loadConfig(projectPath);
      const boardConfig = cfg.boardProvider;
      if (boardConfig?.enabled && typeof boardConfig.projectNumber === 'number') {
        return boardConfig;
      }
    } catch {
      // Ignore config loading failures and treat as board-not-configured.
    }
    return null;
  }

  /**
   * Generate a structured GitHub issue body written by the Dev persona.
   */
  async generateIssueBody(trigger: IDiscussionTrigger, devPersona: IAgentPersona): Promise<string> {
    const prompt = `You are ${devPersona.name}, ${devPersona.role}.
Use the PRD rigor from ~/.claude/skills/prd-creator/SKILL.md:
- explicit implementation plan
- testable phases
- concrete verification steps
- no vague filler

Write a concise GitHub issue body for this code scan finding.
Use this structure exactly (GitHub Markdown):

## Context
- Problem: one sentence
- Current behavior: one sentence
- Risk if ignored: one sentence

## Proposed Fix
- Primary approach
- Files likely touched (max 5, include paths when possible)

## Execution Plan
### Phase 1: [name]
- [ ] Implementation step
- [ ] Tests to add/update

### Phase 2: [name]
- [ ] Implementation step
- [ ] Tests to add/update

## Verification
- [ ] Automated: specific tests or commands to run
- [ ] Manual: one concrete validation step

## Done Criteria
- [ ] Bug condition is no longer reproducible
- [ ] Regression coverage is added
- [ ] Error handling/logging is clear and non-silent

Keep it under ~450 words. No fluff, no greetings, no generic "future work" sections.

Context:
${trigger.context}`;

    const raw = await callAIForContribution(devPersona, this.config, prompt);
    return raw.trim();
  }

  /**
   * Execute the board/GitHub action for an issue_review verdict.
   * - ready: moves the issue to the Ready column on the board
   * - close: closes the issue via `gh issue close`
   */
  async triggerIssueStatusUpdate(
    verdict: 'ready' | 'close',
    discussionId: string,
    trigger: IDiscussionTrigger,
  ): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion) return;

    const personas = repos.agentPersona.getActive();
    const executor = findDev(personas) ?? findCarlos(personas) ?? personas[0];
    if (!executor) return;

    // Expect trigger.ref in the form "{owner}/{repo}#{number}"
    const refMatch = trigger.ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (!refMatch) {
      log.warn('issue-review: unexpected trigger.ref format', { ref: trigger.ref });
      return;
    }
    const [, owner, repo, issueNumber] = refMatch;
    const repoArg = `${owner}/${repo}`;

    if (verdict === 'ready') {
      const boardConfig = this.resolveBoardConfig(trigger.projectPath);
      if (boardConfig) {
        try {
          const provider = createBoardProvider(boardConfig, trigger.projectPath);
          await provider.moveIssue(Number(issueNumber), 'Ready');
          await this.slackClient.postAsAgent(
            discussion.channelId,
            `Moved #${issueNumber} to Ready.`,
            executor,
            discussion.threadTs,
          );
          return;
        } catch (err) {
          log.warn('issue-review: board moveIssue failed, trying CLI fallback', {
            error: String(err),
          });
        }
      }
      // CLI fallback
      const boardArgs = buildCurrentCliInvocation([
        'board',
        'move-issue',
        issueNumber,
        '--column',
        'Ready',
      ]);
      if (boardArgs) {
        try {
          execFileSync(process.execPath, boardArgs, {
            cwd: trigger.projectPath,
            timeout: 15_000,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          await this.slackClient.postAsAgent(
            discussion.channelId,
            `Moved #${issueNumber} to Ready.`,
            executor,
            discussion.threadTs,
          );
        } catch {
          log.warn('issue-review: CLI board fallback also failed');
        }
      }
    } else if (verdict === 'close') {
      try {
        execFileSync('gh', ['issue', 'close', issueNumber, '-R', repoArg], {
          cwd: trigger.projectPath,
          timeout: 15_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        await this.slackClient.postAsAgent(
          discussion.channelId,
          `Closed #${issueNumber}.`,
          executor,
          discussion.threadTs,
        );
      } catch (err) {
        log.warn('issue-review: gh issue close failed', { error: String(err) });
      }
    }
  }

  /**
   * Open a GitHub issue from a code_watch finding and post back to the thread.
   * Called automatically after an approved code_watch consensus.
   */
  async triggerIssueOpener(discussionId: string, trigger: IDiscussionTrigger): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion) return;

    const devPersona = findDev(repos.agentPersona.getActive());
    if (!devPersona) return;

    // Acknowledge before doing async work
    await this.slackClient.postAsAgent(
      discussion.channelId,
      'Agreed. Writing up an issue for this.',
      devPersona,
      discussion.threadTs,
    );

    const title = buildIssueTitleFromTrigger(trigger);
    const body = await this.generateIssueBody(trigger, devPersona);

    const boardConfig = this.resolveBoardConfig(trigger.projectPath);
    if (boardConfig) {
      try {
        const provider = createBoardProvider(boardConfig, trigger.projectPath);
        const issue = await provider.createIssue({ title, body, column: 'In Progress' });
        if (issue.column !== 'In Progress') {
          await provider.moveIssue(issue.number, 'In Progress').catch(() => undefined);
        }
        await this.slackClient.postAsAgent(
          discussion.channelId,
          `Opened #${issue.number}: ${issue.title} — ${issue.url}\nTaking first pass now. It's in In Progress.`,
          devPersona,
          discussion.threadTs,
        );
      } catch (err) {
        log.warn('issue opener: board createIssue failed', { error: String(err) });
        await this.slackClient.postAsAgent(
          discussion.channelId,
          `Couldn't open the issue automatically — board might not be configured. Here's the writeup:\n\n${body.slice(0, 600)}`,
          devPersona,
          discussion.threadTs,
        );
      }
    } else {
      // No board configured — post the writeup in thread so it's not lost
      await this.slackClient.postAsAgent(
        discussion.channelId,
        `No board configured, dropping the writeup here:\n\n${body.slice(0, 600)}`,
        devPersona,
        discussion.threadTs,
      );
    }
  }

  /**
   * Have Dev read the actual code and decide whether a scanner finding is worth raising.
   * Returns Dev's Slack-ready observation, or null if Dev thinks it's not worth posting.
   */
  async analyzeCodeCandidate(
    fileContext: string,
    signalSummary: string,
    location: string,
  ): Promise<string | null> {
    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    const devPersona = findDev(personas);
    if (!devPersona) return null;

    const prompt =
      `You are ${devPersona.name}, ${devPersona.role}.\n` +
      `Your scanner flagged something. Before you bring it up with the team, read the actual code and decide if it's genuinely worth raising.\n\n` +
      `Signal: ${signalSummary}\n` +
      `Location: ${location}\n\n` +
      `Code:\n\`\`\`\n${fileContext.slice(0, 3000)}\n\`\`\`\n\n` +
      `Is this a real concern? Give your honest take in 1-2 sentences as a Slack message to the team.\n\n` +
      `Rules:\n` +
      `- If it's clearly fine (intentional, test code, well-handled, noise) → respond with exactly: SKIP\n` +
      `- If it's worth flagging, write what you'd drop in Slack in your own voice. Name the specific risk.\n` +
      `- Sound like a teammate noticing something, not a scanner filing a report.\n` +
      `- No markdown, no bullet points. No "I noticed" or "The code has".\n` +
      `- Never start with "Great question", "Of course", or similar.\n\n` +
      `Write only your message or SKIP.`;

    try {
      const result = await callAIForContribution(devPersona, this.config, prompt);
      if (!result || result.trim().toUpperCase() === 'SKIP') return null;
      return humanizeSlackReply(result, { allowEmoji: false, maxSentences: 2 });
    } catch {
      return null;
    }
  }

  /**
   * Triage an audit report, file a GitHub issue if warranted, and post a short Slack ping.
   * No discussion thread — Dev just drops a link in the channel and moves on.
   */
  async handleAuditReport(
    report: string,
    projectName: string,
    projectPath: string,
    channel: string,
  ): Promise<void> {
    if (!report || report.trim() === 'NO_ISSUES_FOUND') return;

    const repos = getRepositories();
    const personas = repos.agentPersona.getActive();
    const devPersona = findDev(personas);
    if (!devPersona) return;

    // Step 1: Dev triages the report — worth filing? If yes, give a one-liner for Slack.
    const triagePrompt =
      `You are ${devPersona.name}, ${devPersona.role}.\n` +
      `The code auditor just finished scanning ${projectName} and wrote this report:\n\n` +
      `${report.slice(0, 3000)}\n\n` +
      `Should this be filed as a GitHub issue for the team to track?\n\n` +
      `Rules:\n` +
      `- If the findings are genuinely worth tracking (medium or high severity, real risk) → reply with:\n` +
      `  FILE: [one short sentence you'd drop in Slack — specific about what was found, no filler]\n` +
      `- If everything is minor, intentional, or noise → reply with exactly: SKIP\n` +
      `- Be honest. Don't file issues for trivial noise.\n\n` +
      `Write only FILE: [sentence] or SKIP.`;

    let triage: string;
    try {
      triage = await callAIForContribution(devPersona, this.config, triagePrompt, 256);
    } catch {
      return;
    }

    if (!triage || triage.trim().toUpperCase() === 'SKIP' || !/^FILE:/i.test(triage.trim())) {
      log.info('audit: dev skipped filing', { project: projectName });
      return;
    }

    const slackOneliner = triage.replace(/^FILE:\s*/i, '').trim();
    if (!slackOneliner) return;

    // Step 2: Generate a proper GitHub issue body via Dev
    const fakeTrigger: IDiscussionTrigger = {
      type: 'code_watch',
      projectPath,
      ref: `audit-${Date.now()}`,
      context: `Project: ${projectName}\n\nAudit report:\n${report.slice(0, 2000)}`,
    };
    const issueTitle = `fix: ${slackOneliner
      .toLowerCase()
      // eslint-disable-next-line sonarjs/slow-regex
      .replace(/[.!?]+$/, '')
      .replace(/^(found|noticed|flagging|caught)\s+/i, '')
      .slice(0, 80)}`;
    const issueBody = await this.generateIssueBody(fakeTrigger, devPersona).catch(() =>
      report.slice(0, 1200),
    );

    // Step 3: Create GitHub issue (if board is configured for this project)
    const boardConfig = this.resolveBoardConfig(projectPath);
    let issueUrl: string | null = null;
    if (boardConfig) {
      try {
        const provider = createBoardProvider(boardConfig, projectPath);
        const issue = await provider.createIssue({
          title: issueTitle,
          body: issueBody,
          column: 'Ready',
        });
        issueUrl = issue.url;
        log.info('audit: filed issue', {
          project: projectName,
          issue: issue.number,
          url: issueUrl,
        });
      } catch (err) {
        log.warn('audit: failed to create GitHub issue', { error: String(err) });
      }
    }

    // Step 4: Post brief Slack notification — just a link drop, no thread
    const slackMsg = issueUrl
      ? `${slackOneliner} → ${issueUrl}`
      : humanizeSlackReply(slackOneliner, { allowEmoji: false, maxSentences: 2 });

    try {
      await this.slackClient.postAsAgent(channel, slackMsg, devPersona);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('audit: failed to post Slack notification', { error: msg });
    }
  }
}
