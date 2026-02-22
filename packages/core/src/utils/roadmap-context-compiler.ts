/**
 * Roadmap Context Compiler for Night Watch agents.
 *
 * Produces two formats from an IRoadmapStatus:
 * - Full digest: all horizons with items and descriptions (for lead roles)
 * - Smart summary: pending short-term items + first 3 medium-term (for others)
 *
 * Role detection uses case-insensitive substring matching so any custom
 * persona role string is handled without enum changes.
 */

import type { IAgentPersona } from '../shared/types.js';
import type { IRoadmapContextOptions } from '../shared/types.js';
import type { IRoadmapStatus } from './roadmap-scanner.js';

const DEFAULT_MAX_FULL = 3000;
const DEFAULT_MAX_SUMMARY = 800;

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
  if (!status.found || !status.enabled || status.items.length === 0) return '';

  const maxChars =
    options.maxChars ?? (options.mode === 'full' ? DEFAULT_MAX_FULL : DEFAULT_MAX_SUMMARY);

  const output = options.mode === 'full' ? buildFullDigest(status) : buildSmartSummary(status);

  return output.slice(0, maxChars).trim();
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
 * Full digest: all sections with pending items + descriptions + done counts.
 */
function buildFullDigest(status: IRoadmapStatus): string {
  const bySection = groupBySection(status.items);
  let result = '';

  for (const [section, items] of bySection) {
    const done = items.filter((i) => i.checked || i.processed);
    const pending = items.filter((i) => !i.checked && !i.processed);

    result += `### ${section} (${done.length}/${items.length} done)\n`;

    for (const item of pending) {
      result += `- [ ] ${item.title}\n`;
      if (item.description) {
        // Truncate long descriptions to keep per-item overhead reasonable
        const desc = item.description.slice(0, 200).replace(/\n/g, ' ');
        result += `  ${desc}\n`;
      }
    }

    if (done.length > 0) {
      result += `- ${done.length} item${done.length > 1 ? 's' : ''} completed\n`;
    }

    result += '\n';
  }

  return result;
}

/**
 * Smart summary: pending items from the first section (Short Term) plus
 * the first 3 pending items from subsequent sections (Medium Term etc.).
 * Titles only — no descriptions.
 */
function buildSmartSummary(status: IRoadmapStatus): string {
  const pending = status.items.filter((i) => !i.processed && !i.checked);
  if (pending.length === 0) return '';

  const bySection = groupBySection(pending);
  const sections = [...bySection.entries()];

  let result = '';
  sections.forEach(([section, items], idx) => {
    const maxItems = idx === 0 ? items.length : 3; // All from first section, 3 from others
    const slice = items.slice(0, maxItems);
    result += `### ${section}\n`;
    for (const item of slice) {
      result += `- [ ] ${item.title}\n`;
    }
    result += '\n';
  });

  return result;
}
