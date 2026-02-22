/**
 * Roadmap Context Compiler for Night Watch agents.
 *
 * Produces agent-visible context from an IRoadmapStatus by combining:
 * - The raw ROADMAP.md content (so agents can reference exact sections/wording)
 * - A progress overlay showing which items are done vs pending
 *
 * Role detection uses case-insensitive substring matching so any custom
 * persona role string is handled without enum changes.
 */

import type { IAgentPersona } from '../shared/types.js';
import type { IRoadmapContextOptions } from '../shared/types.js';
import type { IRoadmapStatus } from './roadmap-scanner.js';

/** Max chars for the raw file content portion. */
const RAW_CONTENT_MAX = 6000;

/** Max chars for the progress overlay. */
const PROGRESS_MAX_FULL = 2000;
const PROGRESS_MAX_SUMMARY = 600;

/** Keywords that identify a "lead" persona who gets the full roadmap digest. */
const LEAD_KEYWORDS = ['lead', 'architect', 'product', 'manager', 'pm', 'director'] as const;

/**
 * Returns true if the persona role string indicates a lead / decision-making role.
 * Matching is case-insensitive and substring-based so free-form role names work.
 */
export function isLeadRole(role: string): boolean {
  const lower = role.toLowerCase();
  return LEAD_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Compile an IRoadmapStatus into a string suitable for injection into agent prompts.
 *
 * @param status  - The roadmap status returned by getRoadmapStatus
 * @param options - Mode ('full' | 'summary') and optional character cap
 * @returns Formatted markdown string, or empty string when there is nothing to show
 */
export function compileRoadmapContext(
  status: IRoadmapStatus,
  options: IRoadmapContextOptions,
): string {
  if (!status.found || status.items.length === 0) return '';

  const parts: string[] = [];

  // Include raw file content so agents can reference exact sections and wording
  if (status.rawContent) {
    const truncated = status.rawContent.slice(0, options.maxChars ?? RAW_CONTENT_MAX);
    parts.push(`### ROADMAP.md (file content)\n${truncated}`);
  }

  // Append progress overlay
  const progressMax = options.mode === 'full' ? PROGRESS_MAX_FULL : PROGRESS_MAX_SUMMARY;
  const progress =
    options.mode === 'full' ? buildFullProgress(status) : buildSmartProgress(status);
  if (progress) {
    parts.push(`### Progress Status\n${progress.slice(0, progressMax).trim()}`);
  }

  return parts.join('\n\n');
}

/**
 * Convenience wrapper: picks mode based on the persona's role string.
 * Lead roles get the full digest; all others get the smart summary.
 */
export function compileRoadmapForPersona(persona: IAgentPersona, status: IRoadmapStatus): string {
  const mode = isLeadRole(persona.role) ? 'full' : 'summary';
  return compileRoadmapContext(status, { mode });
}

// ---------------------------------------------------------------------------
// Private builders
// ---------------------------------------------------------------------------

/** Group items by section, preserving insertion order. */
function groupBySection<T extends { section: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    let bucket = map.get(item.section);
    if (!bucket) {
      bucket = [];
      map.set(item.section, bucket);
    }
    bucket.push(item);
  }
  return map;
}

/**
 * Full progress: all sections with pending items + done counts.
 */
function buildFullProgress(status: IRoadmapStatus): string {
  const bySection = groupBySection(status.items);
  let result = '';

  for (const [section, items] of bySection) {
    const done = items.filter((i) => i.checked || i.processed);
    const pending = items.filter((i) => !i.checked && !i.processed);

    result += `**${section}**: ${done.length}/${items.length} done`;
    if (pending.length > 0) {
      result += ` — pending: ${pending.map((i) => i.title).join(', ')}`;
    }
    result += '\n';
  }

  return result;
}

/**
 * Smart progress: summary counts + next pending items.
 */
function buildSmartProgress(status: IRoadmapStatus): string {
  const pending = status.items.filter((i) => !i.processed && !i.checked);
  const done = status.items.filter((i) => i.processed || i.checked);
  if (pending.length === 0) return '';

  let result = `${done.length}/${status.items.length} items done. Pending:\n`;
  const bySection = groupBySection(pending);

  for (const [section, items] of bySection) {
    const slice = items.slice(0, 5);
    result += `- ${section}: ${slice.map((i) => i.title).join(', ')}`;
    if (items.length > slice.length) result += `, +${items.length - slice.length} more`;
    result += '\n';
  }

  return result;
}
