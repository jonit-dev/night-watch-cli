/**
 * Log utilities for Night Watch CLI
 * Replaces bash functions from night-watch-helpers.sh
 */

import * as fs from 'fs';
import { DEFAULT_MAX_LOG_SIZE } from '../constants.js';

/**
 * Rotate a log file if it exceeds the maximum size.
 * Renames the file to `${logFile}.old` if rotation occurs.
 * Returns true if rotated, false if no rotation needed.
 */
export function rotateLog(logFile: string, maxSize: number = DEFAULT_MAX_LOG_SIZE): boolean {
  if (!fs.existsSync(logFile)) {
    return false;
  }

  try {
    const stats = fs.statSync(logFile);
    if (stats.size > maxSize) {
      const oldPath = `${logFile}.old`;
      fs.renameSync(logFile, oldPath);
      return true;
    }
  } catch {
    // Ignore errors during rotation
  }

  return false;
}

/**
 * Check if a log file contains a rate limit (429) error.
 * If startLine is provided, only check lines after that position.
 * Otherwise, check the last 20 lines.
 * Returns true if rate limited, false otherwise.
 */
export function checkRateLimited(logFile: string, startLine?: number): boolean {
  if (!fs.existsSync(logFile)) {
    return false;
  }

  try {
    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n');

    let linesToCheck: string[];
    if (startLine !== undefined && startLine > 0) {
      // Check lines after startLine
      linesToCheck = lines.slice(startLine);
    } else {
      // Check last 20 lines
      linesToCheck = lines.slice(-20);
    }

    return linesToCheck.some((line) => line.includes('429'));
  } catch {
    // Ignore errors
    return false;
  }
}
