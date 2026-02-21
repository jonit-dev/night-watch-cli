/**
 * ConsensusEvaluator encapsulates consensus evaluation logic for the
 * Night Watch Slack bot. Extracted from DeliberationEngine to keep
 * consensus concerns in a focused, single-responsibility class.
 */

import {
  type IAgentPersona,
  type IDiscussionTrigger,
  type INightWatchConfig,
  createLogger,
  getRepositories,
} from '@night-watch/core';
import type { SlackClient } from './client.js';
import type { BoardIntegration } from './board-integration.js';
import { callAIForContribution } from './ai/index.js';
import { humanizeSlackReply, isSkipMessage } from './humanizer.js';
import { findCarlos, findDev, getParticipatingPersonas } from './personas.js';
import { MAX_ROUNDS, formatThreadHistory } from './deliberation-builders.js';
import { sleep } from './utils.js';

const log = createLogger('consensus-evaluator');

const HUMAN_DELAY_MIN_MS = 20_000;
const HUMAN_DELAY_MAX_MS = 60_000;
const MAX_AGENT_THREAD_REPLIES = 4;

function humanDelay(): number {
  return HUMAN_DELAY_MIN_MS + Math.random() * (HUMAN_DELAY_MAX_MS - HUMAN_DELAY_MIN_MS);
}

function countThreadReplies(messages: { ts: string }[]): number {
  return Math.max(0, messages.length - 1);
}

export interface IConsensusCallbacks {
  runContributionRound(
    discussionId: string,
    personas: IAgentPersona[],
    trigger: IDiscussionTrigger,
    context: string,
  ): Promise<void>;
  triggerPRRefinement(
    discussionId: string,
    changesSummary: string,
    prNumber: string,
  ): Promise<void>;
}

export class ConsensusEvaluator {
  constructor(
    private readonly slackClient: SlackClient,
    private readonly config: INightWatchConfig,
    private readonly board: BoardIntegration,
  ) {}

  /**
   * Evaluate whether consensus has been reached.
   * Lead agent (Carlos) decides: approve, request changes, or escalate.
   * Uses an iterative loop for multi-round handling (no recursion).
   */
  async evaluateConsensus(
    discussionId: string,
    trigger: IDiscussionTrigger,
    callbacks: IConsensusCallbacks,
  ): Promise<void> {
    const repos = getRepositories();

    // Re-check state each round; stop when consensus/blocked or discussion disappears.
    while (true) {
      const discussion = repos.slackDiscussion.getById(discussionId);
      if (!discussion || discussion.status !== 'active') return;

      // issue_review uses READY/CLOSE/DRAFT evaluation logic — handle separately
      if (trigger.type === 'issue_review') {
        await this.evaluateIssueReviewConsensus(discussionId, trigger);
        return;
      }

      const personas = repos.agentPersona.getActive();
      const carlos = findCarlos(personas);

      if (!carlos) {
        repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
        return;
      }

      // Get thread history and let Carlos evaluate
      const history = await this.slackClient.getChannelHistory(
        discussion.channelId,
        discussion.threadTs,
        20,
      );
      const historyText = formatThreadHistory(history);
      const repliesUsed = countThreadReplies(history);
      const repliesLeft = Math.max(0, MAX_AGENT_THREAD_REPLIES - repliesUsed);
      if (repliesLeft <= 0) {
        repos.slackDiscussion.updateStatus(discussionId, 'blocked', 'human_needed');
        return;
      }

      const consensusPrompt = `You are ${carlos.name}, ${carlos.role}. You're wrapping up a team discussion.

Thread:
${historyText || '(No thread history available)'}

Round: ${discussion.round}/${MAX_ROUNDS}

Make the call. Are we done, do we need one more pass, or does a human need to weigh in?
- Keep it brief and decisive. No recap of the whole thread.
- If you approve, do not restate prior arguments.

Respond with EXACTLY one of these formats (include the prefix):
- APPROVE: [one short closing message — e.g., "Clean. Let's ship it."]
- CHANGES: [what specifically still needs work — e.g., "The error handler in \`src/api/handler.ts#L45\` swallows the stack trace. Need to propagate it."]
- HUMAN: [why this needs a human decision — e.g., "The team is split on whether to cache at the API layer or DB layer. Need a product call."]

Write the prefix and your message. Nothing else.`;

      let decision: string;
      try {
        decision = await callAIForContribution(carlos, this.config, consensusPrompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('AI consensus evaluation failed', { error: msg });
        decision = 'HUMAN: AI evaluation failed — needs manual review';
      }

      if (decision.startsWith('APPROVE')) {
        const message = humanizeSlackReply(
          decision.replace(/^APPROVE:\s*/, '').trim() || 'Clean. Ship it.',
          { allowEmoji: false, maxSentences: 1 },
        );
        if (!isSkipMessage(message)) {
          await this.slackClient.postAsAgent(
            discussion.channelId,
            message,
            carlos,
            discussion.threadTs,
          );
        }
        repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
        log.info('consensus reached', { discussionId, result: 'approved', trigger: trigger.type });
        if (trigger.type === 'code_watch') {
          await this.board
            .triggerIssueOpener(discussionId, trigger)
            .catch((e: unknown) => log.warn('issue opener failed', { error: String(e) }));
        }
        return;
      }

      if (decision.startsWith('CHANGES') && discussion.round < MAX_ROUNDS && repliesLeft >= 3) {
        const changes = decision.replace(/^CHANGES:\s*/, '').trim();
        const changesMessage = humanizeSlackReply(
          changes || 'Need one more pass on a couple items.',
          {
            allowEmoji: false,
            maxSentences: 1,
          },
        );
        if (!isSkipMessage(changesMessage)) {
          await this.slackClient.postAsAgent(
            discussion.channelId,
            changesMessage,
            carlos,
            discussion.threadTs,
          );
        }
        await sleep(humanDelay());

        // Increment round and start another contribution round, then loop back.
        const nextRound = discussion.round + 1;
        repos.slackDiscussion.updateRound(discussionId, nextRound);

        const participants = getParticipatingPersonas(trigger.type, personas);
        const devPersona = findDev(personas);
        const reviewers = participants.filter((p) => !devPersona || p.id !== devPersona.id);
        await callbacks.runContributionRound(discussionId, reviewers, trigger, changes);
        continue;
      }

      if (decision.startsWith('CHANGES')) {
        const changesSummary = decision.replace(/^CHANGES:\s*/, '').trim();
        const summaryMessage = humanizeSlackReply(
          changesSummary
            ? `Need changes before merge: ${changesSummary}`
            : 'Need changes before merge. Please address the thread notes.',
          { allowEmoji: false, maxSentences: 2 },
        );
        if (!isSkipMessage(summaryMessage)) {
          await this.slackClient.postAsAgent(
            discussion.channelId,
            summaryMessage,
            carlos,
            discussion.threadTs,
          );
        }
        repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'changes_requested');
        log.info('consensus reached', {
          discussionId,
          result: 'changes_requested',
          trigger: trigger.type,
        });

        if (discussion.triggerType === 'pr_review') {
          await callbacks
            .triggerPRRefinement(discussionId, changesSummary, discussion.triggerRef)
            .catch((e) => log.warn('PR refinement trigger failed', { error: String(e) }));
        }
        return;
      }

      // HUMAN or fallback
      const humanReason = decision.replace(/^HUMAN:\s*/, '').trim();
      const humanMessage = humanizeSlackReply(
        humanReason
          ? `Need a human decision: ${humanReason}`
          : 'Need a human decision on this one.',
        { allowEmoji: false, maxSentences: 1 },
      );
      if (!isSkipMessage(humanMessage)) {
        await this.slackClient.postAsAgent(
          discussion.channelId,
          humanMessage,
          carlos,
          discussion.threadTs,
        );
      }
      repos.slackDiscussion.updateStatus(discussionId, 'blocked', 'human_needed');
      log.info('consensus reached', {
        discussionId,
        result: 'human_needed',
        trigger: trigger.type,
      });
      return;
    }
  }

  /**
   * Evaluate issue_review discussions using READY/CLOSE/DRAFT verdict logic.
   * The lead persona (tech lead role) makes the triage call; no multi-round loop.
   */
  async evaluateIssueReviewConsensus(
    discussionId: string,
    trigger: IDiscussionTrigger,
  ): Promise<void> {
    const repos = getRepositories();
    const discussion = repos.slackDiscussion.getById(discussionId);
    if (!discussion || discussion.status !== 'active') return;

    const personas = repos.agentPersona.getActive();
    const lead = findCarlos(personas);

    if (!lead) {
      repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
      return;
    }

    const history = await this.slackClient.getChannelHistory(
      discussion.channelId,
      discussion.threadTs,
      20,
    );
    const historyText = formatThreadHistory(history);

    const consensusPrompt = `You are ${lead.name}, ${lead.role}. You're wrapping up a team issue review.

Thread:
${historyText || '(No thread history available)'}

Based on the discussion above, make the triage call for this issue.

Respond with EXACTLY one of these formats (include the prefix):
- READY: [why — move to Ready column, issue is valid and prioritized]
- CLOSE: [why — invalid, duplicate, or won't fix]
- DRAFT: [why — valid but needs more context or lower priority]

Be concise and decisive. No recap of the whole thread. Write the prefix and your message. Nothing else.`;

    let decision: string;
    try {
      decision = await callAIForContribution(lead, this.config, consensusPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('issue-review: consensus evaluation failed', { error: msg });
      decision = 'DRAFT: AI evaluation failed — leaving in Draft for manual review';
    }

    if (decision.startsWith('READY')) {
      const message = humanizeSlackReply(
        decision.replace(/^READY:\s*/, '').trim() || 'Looks good — moving to Ready.',
        { allowEmoji: false, maxSentences: 1 },
      );
      if (!isSkipMessage(message)) {
        await this.slackClient.postAsAgent(
          discussion.channelId,
          message,
          lead,
          discussion.threadTs,
        );
      }
      repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
      await this.board
        .triggerIssueStatusUpdate('ready', discussionId, trigger)
        .catch((e: unknown) =>
          log.warn('issue-review: status update failed', { error: String(e) }),
        );
      return;
    }

    if (decision.startsWith('CLOSE')) {
      const message = humanizeSlackReply(
        decision.replace(/^CLOSE:\s*/, '').trim() || 'Closing this — not worth tracking.',
        { allowEmoji: false, maxSentences: 1 },
      );
      if (!isSkipMessage(message)) {
        await this.slackClient.postAsAgent(
          discussion.channelId,
          message,
          lead,
          discussion.threadTs,
        );
      }
      repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
      await this.board
        .triggerIssueStatusUpdate('close', discussionId, trigger)
        .catch((e: unknown) =>
          log.warn('issue-review: status update failed', { error: String(e) }),
        );
      return;
    }

    // DRAFT or fallback
    const message = humanizeSlackReply(
      decision.replace(/^DRAFT:\s*/, '').trim() || 'Leaving in Draft — needs more context.',
      { allowEmoji: false, maxSentences: 1 },
    );
    if (!isSkipMessage(message)) {
      await this.slackClient.postAsAgent(discussion.channelId, message, lead, discussion.threadTs);
    }
    repos.slackDiscussion.updateStatus(discussionId, 'consensus', 'approved');
  }
}
