/**
 * Tests for the prd command
 *
 * Tests utility functions directly and integration tests via execSync.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import {
  slugify,
  getNextPrdNumber,
  buildPrdPrompt,
  buildNativeClaudeEnv,
  resolvePrdCreateDir,
  extractPrdMarkdown,
  extractPrdTitle,
} from '@/cli/commands/prd.js';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const NODE_BIN = process.execPath;
const CLI_PATH = path.join(CLI_ROOT, '..', 'dist', 'cli.js');
const NODE_CMD = `"${NODE_BIN}" "${CLI_PATH}"`;

describe('prd command', () => {
  describe('slugify', () => {
    it('should slugify name correctly', () => {
      expect(slugify('Add User Auth')).toBe('add-user-auth');
    });

    it('should handle special characters', () => {
      expect(slugify('Hello World!!! @#$')).toBe('hello-world');
    });

    it('should handle leading and trailing hyphens', () => {
      expect(slugify('--test--')).toBe('test');
    });

    it('should handle multiple consecutive spaces', () => {
      expect(slugify('foo   bar   baz')).toBe('foo-bar-baz');
    });

    it('should handle single word', () => {
      expect(slugify('Authentication')).toBe('authentication');
    });

    it('should handle numbers', () => {
      expect(slugify('Phase 2 Implementation')).toBe('phase-2-implementation');
    });
  });

  describe('getNextPrdNumber', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-prd-num-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should return 1 for empty directory', () => {
      expect(getNextPrdNumber(tempDir)).toBe(1);
    });

    it('should return 1 for non-existent directory', () => {
      expect(getNextPrdNumber(path.join(tempDir, 'nonexistent'))).toBe(1);
    });

    it('should auto-number based on existing files', () => {
      fs.writeFileSync(path.join(tempDir, '01-first.md'), '');
      fs.writeFileSync(path.join(tempDir, '02-second.md'), '');
      fs.writeFileSync(path.join(tempDir, '05-fifth.md'), '');

      expect(getNextPrdNumber(tempDir)).toBe(6);
    });

    it('should ignore non-numbered files', () => {
      fs.writeFileSync(path.join(tempDir, 'readme.md'), '');
      fs.writeFileSync(path.join(tempDir, '03-some-prd.md'), '');
      expect(getNextPrdNumber(tempDir)).toBe(4);
    });
  });

  describe('prd create helpers', () => {
    it('builds a prompt that forces direct PRD output', () => {
      const prompt = buildPrdPrompt(
        'Add OAuth login',
        '/tmp/project',
        'Use phased delivery and concrete acceptance criteria.',
      );

      expect(prompt).toContain('Return only the final PRD markdown.');
      expect(prompt).toContain('- Do not ask follow-up questions');
      expect(prompt).toContain('Planning guide:');
      expect(prompt).toContain('User request:\nAdd OAuth login');
    });

    it('strips proxy and provider-routing env vars for native Claude', () => {
      const env = buildNativeClaudeEnv({
        PATH: '/usr/bin',
        ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5',
        NW_CLAUDE_MODEL_ID: 'glm-5',
        NW_PROVIDER_CMD: 'claude',
      });

      expect(env.PATH).toBe('/usr/bin');
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
      expect(env.NW_CLAUDE_MODEL_ID).toBeUndefined();
      expect(env.NW_PROVIDER_CMD).toBeUndefined();
    });

    it('always uses docs/PRDs for prd create output', () => {
      expect(resolvePrdCreateDir()).toBe('docs/PRDs');
    });

    it('extracts markdown and drops chatty preamble text', () => {
      const output = extractPrdMarkdown('I will create that now.\n\n# PRD: OAuth\n\nBody');
      expect(output).toBe('# PRD: OAuth\n\nBody');
    });

    it('extracts PRD title from markdown', () => {
      expect(extractPrdTitle('# PRD: Morning Summary Command\n\nBody')).toBe(
        'Morning Summary Command',
      );
    });

    it('returns null when no PRD title found', () => {
      expect(extractPrdTitle('# Some Other Heading\n\nBody')).toBeNull();
    });
  });

  describe('prd list (integration)', () => {
    let tempDir: string;
    let prdDir: string;
    let doneDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-prd-list-test-'));
      prdDir = path.join(tempDir, 'docs', 'PRDs', 'night-watch');
      doneDir = path.join(prdDir, 'done');
      fs.mkdirSync(doneDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'night-watch.config.json'),
        JSON.stringify({ prdDir: 'docs/PRDs/night-watch' }),
      );
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function runPrdList(args = ''): string {
      return execSync(`${NODE_CMD} prd list ${args}`, {
        encoding: 'utf-8',
        cwd: tempDir,
        env: { ...process.env, NODE_ENV: 'test' },
      });
    }

    it('should show pending PRDs', () => {
      fs.writeFileSync(
        path.join(prdDir, '01-feature.md'),
        '# PRD: Feature\n\n**Depends on:** `setup.md`\n',
      );
      fs.writeFileSync(path.join(prdDir, '02-other.md'), '# PRD: Other\n');

      const output = runPrdList();

      expect(output).toContain('01-feature.md');
      expect(output).toContain('02-other.md');
      expect(output).toContain('pending');
    });

    it('should show done PRDs', () => {
      fs.writeFileSync(path.join(doneDir, '00-setup.md'), '# PRD: Setup\n');

      const output = runPrdList();

      expect(output).toContain('00-setup.md');
      expect(output).toContain('done');
    });

    it('should output valid JSON with --json flag', () => {
      fs.writeFileSync(
        path.join(prdDir, '01-feat.md'),
        '# PRD: Feat\n\n**Depends on:** `base.md`\n',
      );
      fs.writeFileSync(path.join(doneDir, '00-base.md'), '# PRD: Base\n');

      const output = runPrdList('--json');
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty('pending');
      expect(parsed).toHaveProperty('done');
      expect(parsed.pending).toHaveLength(1);
      expect(parsed.done).toHaveLength(1);
      expect(parsed.pending[0].name).toBe('01-feat.md');
      expect(parsed.pending[0].dependencies).toContain('base.md');
      expect(parsed.done[0].name).toBe('00-base.md');
    });

    it('should show no PRDs message when empty', () => {
      // Remove all md files
      const files = fs.readdirSync(prdDir);
      for (const f of files) {
        if (f.endsWith('.md')) fs.unlinkSync(path.join(prdDir, f));
      }

      const output = runPrdList();

      expect(output).toContain('No PRDs found');
    });

    it('should show claimed status when .claim file exists', () => {
      fs.writeFileSync(path.join(prdDir, '01-feature.md'), '# PRD: Feature\n');
      // Create an active claim file
      const claimData = JSON.stringify({
        timestamp: Math.floor(Date.now() / 1000),
        hostname: 'test-host',
        pid: 12345,
      });
      fs.writeFileSync(path.join(prdDir, '01-feature.md.claim'), claimData);

      const output = runPrdList();

      expect(output).toContain('claimed');
      expect(output).toContain('01-feature.md');
    });

    it('should show pending for stale .claim file', () => {
      fs.writeFileSync(path.join(prdDir, '01-feature.md'), '# PRD: Feature\n');
      // Create a stale claim file (timestamp from year 2001)
      const claimData = JSON.stringify({
        timestamp: 1000000000,
        hostname: 'old-host',
        pid: 99999,
      });
      fs.writeFileSync(path.join(prdDir, '01-feature.md.claim'), claimData);

      const output = runPrdList();

      expect(output).toContain('pending');
      expect(output).toContain('01-feature.md');
    });
  });
});
