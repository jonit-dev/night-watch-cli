/**
 * Roadmap Parser for Night Watch CLI
 * Parses ROADMAP.md files into structured items
 */

import * as crypto from 'crypto';

/**
 * Represents a single item parsed from ROADMAP.md
 */
export interface IRoadmapItem {
  /** First 8 chars of SHA-256 hash of lowercase trimmed title */
  hash: string;
  /** The title/heading of the item */
  title: string;
  /** Optional description text */
  description: string;
  /** Whether the item is checked/completed (from - [x] format) */
  checked: boolean;
  /** Parent section name (from ## heading) */
  section: string;
}

/**
 * Generate a hash for an item based on its title
 * Uses first 8 characters of SHA-256 hash of lowercase trimmed title
 */
export function generateItemHash(title: string): string {
  const normalizedTitle = title.toLowerCase().trim();
  return crypto.createHash('sha256').update(normalizedTitle).digest('hex').slice(0, 8);
}

/**
 * Parse ROADMAP.md content into structured items
 *
 * Supports two formats:
 * 1. Checklist format: Lines matching `- [ ] Title` or `- [x] Title`
 *    with optional description on following indented lines
 * 2. Heading format: `### Title` followed by body text (until next heading)
 *
 * @param content - The raw ROADMAP.md content
 * @returns Array of parsed roadmap items
 */
export function parseRoadmap(content: string): IRoadmapItem[] {
  const items: IRoadmapItem[] = [];
  const lines = content.split('\n');

  let currentSection = 'General';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track section headers (## headings)
    // eslint-disable-next-line sonarjs/slow-regex
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    // Parse checklist items: - [ ] Title or - [x] Title
    // eslint-disable-next-line sonarjs/slow-regex
    const checklistMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (checklistMatch) {
      const checked = checklistMatch[1].toLowerCase() === 'x';
      const title = checklistMatch[2].trim();

      // Collect description from following indented lines
      const description = collectDescription(lines, i + 1);

      items.push({
        hash: generateItemHash(title),
        title,
        description,
        checked,
        section: currentSection,
      });
      continue;
    }

    // Parse heading-based items: ### Title followed by body
    // eslint-disable-next-line sonarjs/slow-regex
    const headingMatch = line.match(/^###\s+(.+)$/);
    if (headingMatch) {
      const title = headingMatch[1].trim();

      // Collect description from following lines until next heading
      const description = collectDescriptionUntilNextHeading(lines, i + 1);

      items.push({
        hash: generateItemHash(title),
        title,
        description,
        checked: false, // Heading-based items are never checked
        section: currentSection,
      });
    }
  }

  return items;
}

/**
 * Collect description from indented lines following a checklist item
 * Stops when reaching a non-indented line, another list item, or a heading
 */
function collectDescription(lines: string[], startIndex: number): string {
  const descriptionLines: string[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];

    // Stop at empty line
    if (line.trim() === '') {
      break;
    }

    // Stop at non-indented line (including headings, other list items)
    if (!line.startsWith('  ') && !line.startsWith('\t')) {
      break;
    }

    // Add the line, stripping leading indentation
    descriptionLines.push(line.trim());
  }

  return descriptionLines.join('\n');
}

/**
 * Collect description from lines following a ### heading
 * Stops when reaching another heading (## or ###)
 */
function collectDescriptionUntilNextHeading(lines: string[], startIndex: number): string {
  const descriptionLines: string[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];

    // Stop at any heading
    if (line.match(/^#{1,3}\s+/)) {
      break;
    }

    // Stop at empty line followed by another heading
    if (line.trim() === '') {
      // Look ahead for heading
      if (i + 1 < lines.length && lines[i + 1].match(/^#{1,3}\s+/)) {
        break;
      }
    }

    descriptionLines.push(line);
  }

  // Trim trailing empty lines and join
  const result = descriptionLines.join('\n').trim();
  return result;
}

/**
 * Filter roadmap items to only unchecked items (pending work)
 */
export function getUncheckedItems(items: IRoadmapItem[]): IRoadmapItem[] {
  return items.filter((item) => !item.checked);
}

/**
 * Group roadmap items by section
 */
export function groupBySection(items: IRoadmapItem[]): Record<string, IRoadmapItem[]> {
  const groups: Record<string, IRoadmapItem[]> = {};

  for (const item of items) {
    if (!groups[item.section]) {
      groups[item.section] = [];
    }
    groups[item.section].push(item);
  }

  return groups;
}
