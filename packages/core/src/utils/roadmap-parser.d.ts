/**
 * Roadmap Parser for Night Watch CLI
 * Parses ROADMAP.md files into structured items
 */
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
export declare function generateItemHash(title: string): string;
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
export declare function parseRoadmap(content: string): IRoadmapItem[];
/**
 * Filter roadmap items to only unchecked items (pending work)
 */
export declare function getUncheckedItems(items: IRoadmapItem[]): IRoadmapItem[];
/**
 * Group roadmap items by section
 */
export declare function groupBySection(items: IRoadmapItem[]): Record<string, IRoadmapItem[]>;
//# sourceMappingURL=roadmap-parser.d.ts.map