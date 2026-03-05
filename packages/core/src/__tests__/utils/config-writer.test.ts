/**
 * Tests for config writer utility
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { saveConfig } from '../../utils/config-writer.js';

describe('config-writer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-config-writer-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('saveConfig', () => {
    it('should create config file if it does not exist', () => {
      const result = saveConfig(tempDir, { provider: 'codex' });

      expect(result.success).toBe(true);
      const configPath = path.join(tempDir, 'night-watch.config.json');
      expect(fs.existsSync(configPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(content.provider).toBe('codex');
    });

    it('should merge changes into existing config', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      const existing = {
        $schema: 'https://json-schema.org/schema',
        projectName: 'test-project',
        provider: 'claude',
        cronSchedule: '0 0-21 * * *',
        maxRuntime: 7200,
      };
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));

      const result = saveConfig(tempDir, { cronSchedule: '0 */4 * * *' });

      expect(result.success).toBe(true);
      const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(updated.cronSchedule).toBe('0 */4 * * *');
      // Existing fields preserved
      expect(updated.provider).toBe('claude');
      expect(updated.maxRuntime).toBe(7200);
    });

    it('should preserve unknown keys like $schema and projectName', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      const existing = {
        $schema: 'https://json-schema.org/schema',
        projectName: 'my-project',
        customField: 'should-survive',
        provider: 'claude',
      };
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));

      const result = saveConfig(tempDir, { provider: 'codex' });

      expect(result.success).toBe(true);
      const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(updated.$schema).toBe('https://json-schema.org/schema');
      expect(updated.projectName).toBe('my-project');
      expect(updated.customField).toBe('should-survive');
      expect(updated.provider).toBe('codex');
    });

    it('should handle multiple changes at once', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ provider: 'claude' }, null, 2));

      const result = saveConfig(tempDir, {
        provider: 'codex',
        cronSchedule: '*/5 * * * *',
        maxRuntime: 3600,
        reviewerEnabled: false,
      });

      expect(result.success).toBe(true);
      const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(updated.provider).toBe('codex');
      expect(updated.cronSchedule).toBe('*/5 * * * *');
      expect(updated.maxRuntime).toBe(3600);
      expect(updated.reviewerEnabled).toBe(false);
    });

    it('should return error for invalid JSON in existing file', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(configPath, 'not valid json {{{');

      const result = saveConfig(tempDir, { provider: 'codex' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should write with proper formatting (2-space indent + trailing newline)', () => {
      const result = saveConfig(tempDir, { provider: 'claude' });

      expect(result.success).toBe(true);
      const configPath = path.join(tempDir, 'night-watch.config.json');
      const content = fs.readFileSync(configPath, 'utf-8');
      // Should have 2-space indentation
      expect(content).toContain('  "provider": "claude"');
      // Should end with newline
      expect(content.endsWith('\n')).toBe(true);
    });

    it('should not include undefined values', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ provider: 'claude' }, null, 2));

      const result = saveConfig(tempDir, { provider: 'codex', cronSchedule: undefined });

      expect(result.success).toBe(true);
      const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(updated.provider).toBe('codex');
      // cronSchedule should not be added since it was undefined
      expect('cronSchedule' in updated).toBe(false);
    });

    it('should persist null values to explicitly clear optional fields', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ scheduleBundleId: 'always-on' }, null, 2));

      const result = saveConfig(tempDir, { scheduleBundleId: null });

      expect(result.success).toBe(true);
      const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(updated.scheduleBundleId).toBeNull();
    });

    it('should preserve sibling QA fields during partial nested updates', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            qa: {
              enabled: true,
              schedule: '45 2,14 * * *',
              maxRuntime: 3600,
              branchPatterns: ['night-watch/'],
              artifacts: 'both',
              skipLabel: 'skip-qa',
              autoInstallPlaywright: true,
            },
          },
          null,
          2,
        ),
      );

      const result = saveConfig(tempDir, { qa: { enabled: false } as any });

      expect(result.success).toBe(true);
      const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(updated.qa).toEqual({
        enabled: false,
        schedule: '45 2,14 * * *',
        maxRuntime: 3600,
        branchPatterns: ['night-watch/'],
        artifacts: 'both',
        skipLabel: 'skip-qa',
        autoInstallPlaywright: true,
      });
    });

    it('should preserve sibling planner fields during partial nested updates', () => {
      const configPath = path.join(tempDir, 'night-watch.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            roadmapScanner: {
              enabled: true,
              roadmapPath: 'ROADMAP.md',
              autoScanInterval: 300,
              slicerSchedule: '35 */12 * * *',
              slicerMaxRuntime: 600,
              priorityMode: 'roadmap-first',
              issueColumn: 'Draft',
            },
          },
          null,
          2,
        ),
      );

      const result = saveConfig(tempDir, { roadmapScanner: { enabled: false } as any });

      expect(result.success).toBe(true);
      const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(updated.roadmapScanner).toEqual({
        enabled: false,
        roadmapPath: 'ROADMAP.md',
        autoScanInterval: 300,
        slicerSchedule: '35 */12 * * *',
        slicerMaxRuntime: 600,
        priorityMode: 'roadmap-first',
        issueColumn: 'Draft',
      });
    });
  });
});
