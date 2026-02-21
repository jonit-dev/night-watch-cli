/**
 * ThreadStateManager — owns all per-thread and per-channel state for the
 * SlackInteractionListener.  Extracted so that state logic is testable in
 * isolation without needing a running Slack socket.
 */

import type { IAgentPersona } from '@night-watch/core';
import type { IAdHocThreadState } from './message-parser.js';
import { randomInt } from './utils.js';

export const MAX_PROCESSED_MESSAGE_KEYS = 2000;
export const PERSONA_REPLY_COOLDOWN_MS = 45_000;
export const AD_HOC_THREAD_MEMORY_MS = 60 * 60_000; // 1h
export const ISSUE_REVIEW_COOLDOWN_MS = 30 * 60_000;

export class ThreadStateManager {
  private readonly processedMessageKeys = new Set<string>();
  private readonly processedMessageOrder: string[] = [];
  private readonly lastPersonaReplyAt = new Map<string, number>();
  private readonly adHocThreadState = new Map<string, IAdHocThreadState>();
  private readonly lastChannelActivityAt = new Map<string, number>();
  private readonly reviewedIssues = new Map<string, number>();

  // ── Message dedup ──────────────────────────────────────────────────────────

  /**
   * Register a message key as seen.  Returns true on first sight, false on
   * duplicate.  Evicts the oldest keys once the cap is reached.
   */
  rememberMessageKey(key: string): boolean {
    if (this.processedMessageKeys.has(key)) return false;

    this.processedMessageKeys.add(key);
    this.processedMessageOrder.push(key);

    while (this.processedMessageOrder.length > MAX_PROCESSED_MESSAGE_KEYS) {
      const oldest = this.processedMessageOrder.shift();
      if (oldest) this.processedMessageKeys.delete(oldest);
    }

    return true;
  }

  // ── Persona cooldown ───────────────────────────────────────────────────────

  isPersonaOnCooldown(channel: string, threadTs: string, personaId: string): boolean {
    const last = this.lastPersonaReplyAt.get(this.threadKey(channel, threadTs, personaId));
    if (!last) return false;
    return Date.now() - last < PERSONA_REPLY_COOLDOWN_MS;
  }

  markPersonaReply(channel: string, threadTs: string, personaId: string): void {
    this.lastPersonaReplyAt.set(this.threadKey(channel, threadTs, personaId), Date.now());
  }

  // ── Channel activity ───────────────────────────────────────────────────────

  markChannelActivity(channel: string): void {
    this.lastChannelActivityAt.set(channel, Date.now());
  }

  /** Returns the live Map reference (shared with ProactiveLoop). */
  getLastChannelActivityAt(): Map<string, number> {
    return this.lastChannelActivityAt;
  }

  // ── Ad-hoc thread memory ───────────────────────────────────────────────────

  rememberAdHocThreadPersona(channel: string, threadTs: string, personaId: string): void {
    this.adHocThreadState.set(this.adHocKey(channel, threadTs), {
      personaId,
      expiresAt: Date.now() + AD_HOC_THREAD_MEMORY_MS,
    });
  }

  getRememberedAdHocPersona(
    channel: string,
    threadTs: string,
    personas: IAgentPersona[],
  ): IAgentPersona | null {
    const key = this.adHocKey(channel, threadTs);
    const remembered = this.adHocThreadState.get(key);
    if (!remembered) return null;
    if (Date.now() > remembered.expiresAt) {
      this.adHocThreadState.delete(key);
      return null;
    }
    return personas.find((p) => p.id === remembered.personaId) ?? null;
  }

  // ── Issue review cooldown ──────────────────────────────────────────────────

  isIssueOnReviewCooldown(issueUrl: string): boolean {
    const last = this.reviewedIssues.get(issueUrl);
    if (!last) return false;
    return Date.now() - last < ISSUE_REVIEW_COOLDOWN_MS;
  }

  markIssueReviewed(issueUrl: string): void {
    this.reviewedIssues.set(issueUrl, Date.now());
  }

  // ── Persona selection helpers ──────────────────────────────────────────────

  pickRandomPersona(
    personas: IAgentPersona[],
    channel: string,
    threadTs: string,
  ): IAgentPersona | null {
    if (personas.length === 0) return null;
    const available = personas.filter((p) => !this.isPersonaOnCooldown(channel, threadTs, p.id));
    const pool = available.length > 0 ? available : personas;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  findPersonaByName(personas: IAgentPersona[], name: string): IAgentPersona | null {
    const target = name.toLowerCase();
    return personas.find((p) => p.name.toLowerCase() === target) ?? null;
  }

  /** Convenience wrapper that delegates to the shared `randomInt` utility. */
  randomInt(min: number, max: number): number {
    return randomInt(min, max);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private threadKey(channel: string, threadTs: string, personaId: string): string {
    return `${channel}:${threadTs}:${personaId}`;
  }

  private adHocKey(channel: string, threadTs: string): string {
    return `${channel}:${threadTs}`;
  }
}
