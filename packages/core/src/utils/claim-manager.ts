/**
 * Claim management utilities for Night Watch CLI
 * Replaces bash functions from night-watch-helpers.sh
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { CLAIM_FILE_EXTENSION } from '../constants.js';

/**
 * Information stored in a PRD claim file
 */
export interface IClaimInfo {
  timestamp: number;
  hostname: string;
  pid: number;
}

/**
 * Claim a PRD for execution.
 * Creates a claim file with timestamp, hostname, and PID.
 */
export function claimPrd(prdDir: string, prdFile: string, pid?: number): void {
  const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);
  const claimData: IClaimInfo = {
    timestamp: Math.floor(Date.now() / 1000),
    hostname: os.hostname(),
    pid: pid ?? process.pid,
  };

  fs.writeFileSync(claimPath, JSON.stringify(claimData), 'utf-8');
}

/**
 * Release a PRD claim.
 * Removes the claim file if it exists.
 */
export function releaseClaim(prdDir: string, prdFile: string): void {
  const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);

  try {
    if (fs.existsSync(claimPath)) {
      fs.unlinkSync(claimPath);
    }
  } catch {
    // Silent failure
  }
}

/**
 * Check if a PRD is currently claimed.
 * Returns true if claim exists and is not stale.
 * Removes stale claims automatically.
 */
export function isClaimed(prdDir: string, prdFile: string, maxRuntime: number): boolean {
  const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);

  if (!fs.existsSync(claimPath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(claimPath, 'utf-8');
    const claimData = JSON.parse(content) as IClaimInfo;

    if (typeof claimData.timestamp !== 'number') {
      // Invalid claim file - remove it
      fs.unlinkSync(claimPath);
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    const age = now - claimData.timestamp;

    if (age >= maxRuntime) {
      // Stale claim - remove it
      fs.unlinkSync(claimPath);
      return false;
    }

    return true;
  } catch {
    // Invalid claim file - remove it
    try {
      fs.unlinkSync(claimPath);
    } catch {
      // Ignore
    }
    return false;
  }
}

/**
 * Read claim information for a PRD.
 * Returns null if no claim exists or claim is stale.
 * Removes stale claims automatically.
 */
export function readClaimInfo(
  prdDir: string,
  prdFile: string,
  maxRuntime: number,
): IClaimInfo | null {
  const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);

  if (!fs.existsSync(claimPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(claimPath, 'utf-8');
    const claimData = JSON.parse(content) as IClaimInfo;

    if (typeof claimData.timestamp !== 'number') {
      // Invalid claim file - remove it
      fs.unlinkSync(claimPath);
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const age = now - claimData.timestamp;

    if (age >= maxRuntime) {
      // Stale claim - remove it
      fs.unlinkSync(claimPath);
      return null;
    }

    return claimData;
  } catch {
    // Invalid claim file - remove it
    try {
      fs.unlinkSync(claimPath);
    } catch {
      // Ignore
    }
    return null;
  }
}
