/**
 * PRD utility functions shared between core and CLI.
 */
import * as fs from 'fs';
/**
 * Convert a name to a URL-friendly slug
 */
export function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
/**
 * Get the next PRD number based on existing files in the directory
 */
export function getNextPrdNumber(prdDir) {
    if (!fs.existsSync(prdDir))
        return 1;
    const files = fs
        .readdirSync(prdDir)
        .filter((f) => f.endsWith('.md') && f !== 'NIGHT-WATCH-SUMMARY.md');
    const numbers = files.map((f) => {
        const match = f.match(/^(\d+)-/);
        return match ? parseInt(match[1], 10) : 0;
    });
    return Math.max(0, ...numbers) + 1;
}
//# sourceMappingURL=prd-utils.js.map