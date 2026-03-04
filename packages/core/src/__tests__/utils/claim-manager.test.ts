/**
 * Tests for claim management utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { claimPrd, releaseClaim, isClaimed, readClaimInfo } from '../../utils/claim-manager.js';
import { CLAIM_FILE_EXTENSION } from '../../constants.js';

let tmpDir: string;
let prdDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-claim-test-'));
  prdDir = path.join(tmpDir, 'prds');
  fs.mkdirSync(prdDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('claimPrd', () => {
  it('should create a claim file with correct format', () => {
    const prdFile = 'test-prd.md';
    claimPrd(prdDir, prdFile);

    const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);
    expect(fs.existsSync(claimPath)).toBe(true);

    const content = fs.readFileSync(claimPath, 'utf-8');
    const claim = JSON.parse(content);

    expect(claim).toHaveProperty('timestamp');
    expect(claim).toHaveProperty('hostname');
    expect(claim).toHaveProperty('pid');
    expect(typeof claim.timestamp).toBe('number');
    expect(claim.hostname).toBe(os.hostname());
    expect(claim.pid).toBe(process.pid);
  });

  it('should create claim file with custom PID', () => {
    const prdFile = 'custom-pid.md';
    const customPid = 12345;
    claimPrd(prdDir, prdFile, customPid);

    const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);
    const claim = JSON.parse(fs.readFileSync(claimPath, 'utf-8'));

    expect(claim.pid).toBe(customPid);
  });

  it('should overwrite existing claim', () => {
    const prdFile = 'overwrite.md';

    claimPrd(prdDir, prdFile);
    const firstClaim = readClaimInfo(prdDir, prdFile, 7200);

    // Wait a tiny bit and claim again
    claimPrd(prdDir, prdFile);
    const secondClaim = readClaimInfo(prdDir, prdFile, 7200);

    expect(secondClaim).not.toBeNull();
    expect(secondClaim!.timestamp).toBeGreaterThanOrEqual(firstClaim!.timestamp);
  });
});

describe('releaseClaim', () => {
  it('should remove claim file', () => {
    const prdFile = 'to-release.md';
    claimPrd(prdDir, prdFile);

    const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);
    expect(fs.existsSync(claimPath)).toBe(true);

    releaseClaim(prdDir, prdFile);
    expect(fs.existsSync(claimPath)).toBe(false);
  });

  it('should be silent when claim file does not exist', () => {
    const prdFile = 'nonexistent.md';
    // Should not throw
    expect(() => releaseClaim(prdDir, prdFile)).not.toThrow();
  });
});

describe('isClaimed', () => {
  it('should return false when no claim exists', () => {
    expect(isClaimed(prdDir, 'no-claim.md', 7200)).toBe(false);
  });

  it('should return true for fresh claim', () => {
    const prdFile = 'fresh.md';
    claimPrd(prdDir, prdFile);

    expect(isClaimed(prdDir, prdFile, 7200)).toBe(true);
  });

  it('should return false and remove stale claim', () => {
    const prdFile = 'stale.md';
    const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);

    // Create a stale claim (timestamp 3 hours ago)
    const staleTimestamp = Math.floor(Date.now() / 1000) - 10800; // 3 hours ago
    fs.writeFileSync(
      claimPath,
      JSON.stringify({
        timestamp: staleTimestamp,
        hostname: 'test',
        pid: 12345,
      }),
    );

    // With 2 hour maxRuntime, should be stale
    const result = isClaimed(prdDir, prdFile, 7200);
    expect(result).toBe(false);
    expect(fs.existsSync(claimPath)).toBe(false);
  });

  it('should return false for claim exactly at maxRuntime', () => {
    const prdFile = 'exactly-max.md';
    const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);

    // Create claim exactly at maxRuntime
    const timestamp = Math.floor(Date.now() / 1000) - 7200;
    fs.writeFileSync(
      claimPath,
      JSON.stringify({
        timestamp,
        hostname: 'test',
        pid: 12345,
      }),
    );

    expect(isClaimed(prdDir, prdFile, 7200)).toBe(false);
  });

  it('should return false and remove invalid JSON claim', () => {
    const prdFile = 'invalid.md';
    const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);

    fs.writeFileSync(claimPath, 'not valid json');

    expect(isClaimed(prdDir, prdFile, 7200)).toBe(false);
    expect(fs.existsSync(claimPath)).toBe(false);
  });

  it('should return false and remove claim without timestamp', () => {
    const prdFile = 'no-timestamp.md';
    const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);

    fs.writeFileSync(
      claimPath,
      JSON.stringify({
        hostname: 'test',
        pid: 12345,
      }),
    );

    expect(isClaimed(prdDir, prdFile, 7200)).toBe(false);
    expect(fs.existsSync(claimPath)).toBe(false);
  });
});

describe('readClaimInfo', () => {
  it('should return null when no claim exists', () => {
    expect(readClaimInfo(prdDir, 'no-claim.md', 7200)).toBeNull();
  });

  it('should return claim info for fresh claim', () => {
    const prdFile = 'fresh-info.md';
    claimPrd(prdDir, prdFile);

    const info = readClaimInfo(prdDir, prdFile, 7200);

    expect(info).not.toBeNull();
    expect(info!.hostname).toBe(os.hostname());
    expect(info!.pid).toBe(process.pid);
    expect(info!.timestamp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it('should return null and remove stale claim', () => {
    const prdFile = 'stale-info.md';
    const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);

    const staleTimestamp = Math.floor(Date.now() / 1000) - 10000;
    fs.writeFileSync(
      claimPath,
      JSON.stringify({
        timestamp: staleTimestamp,
        hostname: 'old-host',
        pid: 99999,
      }),
    );

    const info = readClaimInfo(prdDir, prdFile, 7200);
    expect(info).toBeNull();
    expect(fs.existsSync(claimPath)).toBe(false);
  });

  it('should return null for invalid JSON claim', () => {
    const prdFile = 'invalid-info.md';
    const claimPath = path.join(prdDir, prdFile + CLAIM_FILE_EXTENSION);

    fs.writeFileSync(claimPath, 'not json');

    expect(readClaimInfo(prdDir, prdFile, 7200)).toBeNull();
    expect(fs.existsSync(claimPath)).toBe(false);
  });
});
