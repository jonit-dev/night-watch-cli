/**
 * Tests for log utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { rotateLog, checkRateLimited } from '../../utils/log-utils.js';

let tmpDir: string;
let logFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-log-utils-test-'));
  logFile = path.join(tmpDir, 'test.log');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('rotateLog', () => {
  it('should not rotate when file does not exist', () => {
    expect(rotateLog(logFile)).toBe(false);
    expect(fs.existsSync(logFile)).toBe(false);
    expect(fs.existsSync(`${logFile}.old`)).toBe(false);
  });

  it('should not rotate when file is smaller than max size', () => {
    fs.writeFileSync(logFile, 'small content');

    expect(rotateLog(logFile, 1000)).toBe(false);
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.existsSync(`${logFile}.old`)).toBe(false);
  });

  it('should rotate when file exceeds max size', () => {
    const content = 'x'.repeat(1000);
    fs.writeFileSync(logFile, content);

    expect(rotateLog(logFile, 500)).toBe(true);
    expect(fs.existsSync(logFile)).toBe(false);
    expect(fs.existsSync(`${logFile}.old`)).toBe(true);
    expect(fs.readFileSync(`${logFile}.old`, 'utf-8')).toBe(content);
  });

  it('should use default max size of 512KB', () => {
    // Create a file larger than 512KB
    const content = 'x'.repeat(600000);
    fs.writeFileSync(logFile, content);

    expect(rotateLog(logFile)).toBe(true);
    expect(fs.existsSync(`${logFile}.old`)).toBe(true);
  });

  it('should not rotate when file is exactly at max size', () => {
    const content = 'x'.repeat(1000);
    fs.writeFileSync(logFile, content);

    expect(rotateLog(logFile, 1000)).toBe(false);
    expect(fs.existsSync(`${logFile}.old`)).toBe(false);
  });

  it('should overwrite existing .old file', () => {
    const oldContent = 'old log content';
    const newContent = 'x'.repeat(2000);

    fs.writeFileSync(logFile, newContent);
    fs.writeFileSync(`${logFile}.old`, oldContent);

    expect(rotateLog(logFile, 1000)).toBe(true);
    expect(fs.readFileSync(`${logFile}.old`, 'utf-8')).toBe(newContent);
  });
});

describe('checkRateLimited', () => {
  it('should return false when file does not exist', () => {
    expect(checkRateLimited(logFile)).toBe(false);
  });

  it('should return true when 429 is in last 20 lines', () => {
    const lines = Array(25).fill('normal log line');
    lines[22] = 'Error: 429 Too Many Requests';
    fs.writeFileSync(logFile, lines.join('\n'));

    expect(checkRateLimited(logFile)).toBe(true);
  });

  it('should return false when 429 is not in last 20 lines', () => {
    const lines = Array(25).fill('normal log line');
    lines[0] = 'Error: 429 Too Many Requests'; // First line, not in last 20
    fs.writeFileSync(logFile, lines.join('\n'));

    expect(checkRateLimited(logFile)).toBe(false);
  });

  it('should check all lines when fewer than 20', () => {
    fs.writeFileSync(logFile, 'line1\nError: 429\nline3');

    expect(checkRateLimited(logFile)).toBe(true);
  });

  it('should check lines after startLine when provided', () => {
    const lines = [
      'line1', // line index 0
      'Error: 429', // line index 1
      'line3', // line index 2
      'line4',
      'line5',
    ];
    fs.writeFileSync(logFile, lines.join('\n'));

    // startLine=2 means check from line index 2 onwards (excludes the 429 at index 1)
    expect(checkRateLimited(logFile, 2)).toBe(false);

    // startLine=1 means check from line index 1 onwards (includes the 429)
    expect(checkRateLimited(logFile, 1)).toBe(true);

    // startLine=0 or undefined means check last 20 lines (includes the 429)
    expect(checkRateLimited(logFile, 0)).toBe(true);
  });

  it('should return false for empty file', () => {
    fs.writeFileSync(logFile, '');

    expect(checkRateLimited(logFile)).toBe(false);
  });

  it('should return false for file with no 429', () => {
    fs.writeFileSync(logFile, 'line1\nline2\nline3\n');

    expect(checkRateLimited(logFile)).toBe(false);
  });

  it('should match 429 anywhere in line', () => {
    fs.writeFileSync(logFile, 'Request failed with status code 429');

    expect(checkRateLimited(logFile)).toBe(true);
  });
});
