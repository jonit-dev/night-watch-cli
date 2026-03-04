/**
 * Tests for PRD utility functions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { slugify, getNextPrdNumber, markPrdDone } from '../../utils/prd-utils.js';

let tmpDir: string;
let prdDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-prd-utils-test-'));
  prdDir = path.join(tmpDir, 'prds');
  fs.mkdirSync(prdDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('slugify', () => {
  it('should convert to lowercase', () => {
    expect(slugify('HelloWorld')).toBe('helloworld');
  });

  it('should replace spaces with hyphens', () => {
    expect(slugify('hello world')).toBe('hello-world');
  });

  it('should replace multiple spaces with single hyphen', () => {
    expect(slugify('hello    world')).toBe('hello-world');
  });

  it('should remove special characters', () => {
    expect(slugify('hello!@#$%world')).toBe('hello-world');
  });

  it('should remove leading and trailing hyphens', () => {
    expect(slugify('---hello world---')).toBe('hello-world');
  });

  it('should handle numbers', () => {
    expect(slugify('test 123 prd')).toBe('test-123-prd');
  });
});

describe('getNextPrdNumber', () => {
  it('should return 1 for empty directory', () => {
    expect(getNextPrdNumber(prdDir)).toBe(1);
  });

  it('should return 1 for non-existent directory', () => {
    fs.rmdirSync(prdDir);
    expect(getNextPrdNumber(prdDir)).toBe(1);
  });

  it('should return next number after highest existing', () => {
    fs.writeFileSync(path.join(prdDir, '1-first.md'), '');
    fs.writeFileSync(path.join(prdDir, '5-fifth.md'), '');
    fs.writeFileSync(path.join(prdDir, '3-third.md'), '');

    expect(getNextPrdNumber(prdDir)).toBe(6);
  });

  it('should ignore files without number prefix', () => {
    fs.writeFileSync(path.join(prdDir, '1-first.md'), '');
    fs.writeFileSync(path.join(prdDir, 'no-number.md'), '');

    expect(getNextPrdNumber(prdDir)).toBe(2);
  });
});

describe('markPrdDone', () => {
  it('should move PRD to done directory', () => {
    const prdFile = 'test-prd.md';
    fs.writeFileSync(path.join(prdDir, prdFile), '# Test PRD');

    const result = markPrdDone(prdDir, prdFile);

    expect(result).toBe(true);
    expect(fs.existsSync(path.join(prdDir, prdFile))).toBe(false);
    expect(fs.existsSync(path.join(prdDir, 'done', prdFile))).toBe(true);
  });

  it('should create done directory if it does not exist', () => {
    const prdFile = 'test-prd.md';
    fs.writeFileSync(path.join(prdDir, prdFile), '# Test PRD');

    // done/ should not exist yet
    expect(fs.existsSync(path.join(prdDir, 'done'))).toBe(false);

    const result = markPrdDone(prdDir, prdFile);

    expect(result).toBe(true);
    expect(fs.existsSync(path.join(prdDir, 'done'))).toBe(true);
  });

  it('should return false if PRD file does not exist', () => {
    const result = markPrdDone(prdDir, 'nonexistent.md');
    expect(result).toBe(false);
  });

  it('should preserve PRD content when moving', () => {
    const prdFile = 'content-test.md';
    const content = '# Test PRD\n\nSome content here.';
    fs.writeFileSync(path.join(prdDir, prdFile), content);

    markPrdDone(prdDir, prdFile);

    const movedContent = fs.readFileSync(path.join(prdDir, 'done', prdFile), 'utf-8');
    expect(movedContent).toBe(content);
  });

  it('should overwrite if done file already exists', () => {
    const prdFile = 'overwrite.md';
    fs.writeFileSync(path.join(prdDir, prdFile), 'new content');
    fs.mkdirSync(path.join(prdDir, 'done'), { recursive: true });
    fs.writeFileSync(path.join(prdDir, 'done', prdFile), 'old content');

    const result = markPrdDone(prdDir, prdFile);

    expect(result).toBe(true);
    const content = fs.readFileSync(path.join(prdDir, 'done', prdFile), 'utf-8');
    expect(content).toBe('new content');
  });
});
