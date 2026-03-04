/**
 * PRD utility functions shared between core and CLI.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Convert a name to a URL-friendly slug
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Get the next PRD number based on existing files in the directory
 */
export function getNextPrdNumber(prdDir: string): number {
  if (!fs.existsSync(prdDir)) return 1;
  const files = fs.readdirSync(prdDir).filter((f) => f.endsWith('.md'));
  const numbers = files.map((f) => {
    const match = f.match(/^(\d+)-/);
    return match ? parseInt(match[1], 10) : 0;
  });
  return Math.max(0, ...numbers) + 1;
}

/**
 * Mark a PRD as done by moving it to the done/ subdirectory.
 * Creates the done/ directory if it doesn't exist.
 * Returns true on success, false if the PRD file was not found.
 */
export function markPrdDone(prdDir: string, prdFile: string): boolean {
  const sourcePath = path.join(prdDir, prdFile);

  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  const doneDir = path.join(prdDir, 'done');

  // Create done directory if it doesn't exist
  if (!fs.existsSync(doneDir)) {
    fs.mkdirSync(doneDir, { recursive: true });
  }

  const destPath = path.join(doneDir, prdFile);
  fs.renameSync(sourcePath, destPath);

  return true;
}
