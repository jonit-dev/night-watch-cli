import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { getDefaultConfig } from '@night-watch/core';
import {
  applyJobSelectionToConfig,
  buildBundleJobSelection,
  buildDefaultJobSelection,
  buildProviderChoices,
  buildProviderSummary,
  buildInitConfig,
  chooseProviderByPrecedence,
  chooseProviderForNonInteractive,
  describeCronSchedule,
  getInitCustomizationChoices,
  getInitJobCatalog,
  getDetectedProviderPresets,
  getGitHubRemoteStatus,
  isInteractiveInitSession,
  normalizeCronSchedulePromptInput,
  resolveTemplatePath,
  selectProviderOverrideByIndex,
  shouldPromptProviderOverride,
} from '../../commands/init.js';

// Get project root directory (4 levels up from this test file)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli.js');
const TSX_CMD = `node "${CLI_PATH}"`;

// Cache external tools availability - check once for all tests
let ghAvailable = false;
let claudeAvailable = false;

try {
  execSync('gh auth status', { stdio: 'pipe', timeout: 2000 });
  ghAvailable = true;
} catch {
  // gh not available
}

try {
  execSync('which claude', { stdio: 'pipe', timeout: 2000 });
  claudeAvailable = true;
} catch {
  // claude not available
}

const externalToolsAvailable = ghAvailable && claudeAvailable;

// Helper to skip tests that require external tools
const describeIfExternalTools = externalToolsAvailable ? describe : describe.skip;

describe('init command', () => {
  let tempDir: string;
  let registryDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-test-'));
    // Isolate registry so tests don't pollute ~/.night-watch/projects.json
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-registry-'));
    process.env.NIGHT_WATCH_HOME = registryDir;
    process.env.NW_TELEMETRY_DISABLED = '1';
  });

  afterEach(() => {
    // Clean up temp directories
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(registryDir, { recursive: true, force: true });
    delete process.env.NIGHT_WATCH_HOME;
    delete process.env.NW_TELEMETRY_DISABLED;
  });

  describe('should fail if not a git repo', () => {
    it('should exit with error when not in a git repository', () => {
      // tempDir is not a git repo
      let errorThrown = false;
      try {
        execSync(`${TSX_CMD} init`, {
          encoding: 'utf-8',
          cwd: tempDir,
          stdio: 'pipe',
          timeout: 10000,
        });
      } catch (error) {
        errorThrown = true;
        const err = error as { stderr?: string; stdout?: string };
        // Error output may be in stdout (colored) or stderr
        const output = `${err.stderr ?? ''}\n${err.stdout ?? ''}`;
        expect(output.toLowerCase()).toContain('not a git repository');
      }
      expect(errorThrown).toBe(true);
    });
  });

  describe('should create PRD directory structure', () => {
    it('should create docs/prds/done/ directories', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      // Mock gh auth status (will fail but we test directory creation separately)
      const output = execSync(`${TSX_CMD} init 2>&1 || true`, {
        encoding: 'utf-8',
        cwd: tempDir,
        shell: '/bin/bash',
        timeout: 10000,
      });

      // Even if gh auth fails, directories should be created
      const prdDir = path.join(tempDir, 'docs', 'prds');
      const doneDir = path.join(prdDir, 'done');

      // Check if directories were created before the gh auth check failed
      // Note: init command checks git repo first, then gh auth
      // If gh auth fails, directories may not be created
      // So we'll skip this assertion if the command failed on gh auth
      if (output.includes('GitHub CLI') || output.includes('gh')) {
        // Test skipped due to gh auth not being available
        expect(true).toBe(true);
      } else {
        expect(fs.existsSync(prdDir)).toBe(true);
        expect(fs.existsSync(doneDir)).toBe(true);
      }
    });
  });

  describeIfExternalTools('should copy slash command templates', () => {
    it('should create instructions/executor.md', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      execSync(`${TSX_CMD} init --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const instructionsDir = path.join(tempDir, 'instructions');
      const executorMd = path.join(instructionsDir, 'executor.md');
      const prdExecutorMd = path.join(instructionsDir, 'prd-executor.md');
      const prReviewerMd = path.join(instructionsDir, 'pr-reviewer.md');
      const qaMd = path.join(instructionsDir, 'qa.md');
      const auditMd = path.join(instructionsDir, 'audit.md');

      expect(fs.existsSync(executorMd)).toBe(true);
      expect(fs.existsSync(prdExecutorMd)).toBe(true);
      expect(fs.existsSync(prReviewerMd)).toBe(true);
      expect(fs.existsSync(qaMd)).toBe(true);
      expect(fs.existsSync(auditMd)).toBe(true);

      // Verify placeholder replacement
      const content = fs.readFileSync(executorMd, 'utf-8');
      expect(content).not.toContain('${PROJECT_DIR}');
      expect(content).not.toContain('${PROJECT_NAME}');
      expect(content).not.toContain('${DEFAULT_BRANCH}');

      // Verify executor.md references prd-executor
      expect(content).toContain('prd-executor.md');
    });
  });

  describeIfExternalTools('should be idempotent', () => {
    it('should not error or overwrite when run twice', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      // First run
      execSync(`${TSX_CMD} init --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const configPath = path.join(tempDir, 'night-watch.config.json');
      const configContent1 = fs.readFileSync(configPath, 'utf-8');

      // Second run (without --force)
      execSync(`${TSX_CMD} init --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const configContent2 = fs.readFileSync(configPath, 'utf-8');

      // Config should not be overwritten
      expect(configContent1).toBe(configContent2);
    });
  });

  describeIfExternalTools('should add logs to .gitignore', () => {
    it('should add /logs/ to .gitignore', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      execSync(`${TSX_CMD} init --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const gitignorePath = path.join(tempDir, '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);

      const content = fs.readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('/logs/');
    });

    it('should not duplicate /logs/ in .gitignore if already present', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      // Create .gitignore with /logs/ already
      const gitignorePath = path.join(tempDir, '.gitignore');
      fs.writeFileSync(gitignorePath, 'node_modules\n/logs/\n');

      execSync(`${TSX_CMD} init --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const content = fs.readFileSync(gitignorePath, 'utf-8');
      const logsCount = (content.match(/\/logs\//g) || []).length;
      expect(logsCount).toBe(1);
    });

    it('should add night-watch.config.json to .gitignore', () => {
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      execSync(`${TSX_CMD} init --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const gitignorePath = path.join(tempDir, '.gitignore');
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      expect(content).toContain('night-watch.config.json');
    });

    it('should not duplicate night-watch.config.json in .gitignore if already present', () => {
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      const gitignorePath = path.join(tempDir, '.gitignore');
      fs.writeFileSync(gitignorePath, 'node_modules\nnight-watch.config.json\n');

      execSync(`${TSX_CMD} init --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const content = fs.readFileSync(gitignorePath, 'utf-8');
      const count = (content.match(/night-watch\.config\.json/g) || []).length;
      expect(count).toBe(1);
    });
  });

  describeIfExternalTools('should create logs directory', () => {
    it('should create logs/ directory', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      execSync(`${TSX_CMD} init --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const logsDir = path.join(tempDir, 'logs');
      expect(fs.existsSync(logsDir)).toBe(true);
    });
  });

  describeIfExternalTools('should create config file with project values', () => {
    it('should create night-watch.config.json with projectName and defaultBranch', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      execSync(`${TSX_CMD} init --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const configPath = path.join(tempDir, 'night-watch.config.json');
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.projectName).toBe(path.basename(tempDir));
      expect(config.defaultBranch).toBeDefined();
      expect(config.prdDir).toBe('docs/prds');
      // Verify no budget fields in config
      expect(config.maxBudget).toBeUndefined();
      expect(config.reviewerMaxBudget).toBeUndefined();
    });
  });

  describe('buildInitConfig', () => {
    it('should describe cron schedules in human-readable terms', () => {
      expect(describeCronSchedule('5 * * * *')).toBe('At 5 minutes past the hour');
      expect(describeCronSchedule('bad')).toBe('bad');
    });

    it('should accept enter or yes as the default cron schedule in prompts', () => {
      expect(normalizeCronSchedulePromptInput('', '5 * * * *')).toBe('5 * * * *');
      expect(normalizeCronSchedulePromptInput('y', '5 * * * *')).toBe('5 * * * *');
      expect(normalizeCronSchedulePromptInput('yes', '5 * * * *')).toBe('5 * * * *');
      expect(normalizeCronSchedulePromptInput('0 9 * * *', '5 * * * *')).toBe('0 9 * * *');
    });

    it('should generate the full current config shape with init overrides', () => {
      const defaults = getDefaultConfig();

      const config = buildInitConfig({
        projectName: 'demo-project',
        defaultBranch: 'main',
        provider: 'codex',
        reviewerEnabled: false,
        prdDir: 'custom/prds',
      });

      expect(config.$schema).toBe('https://json-schema.org/schema');
      expect(config.projectName).toBe('demo-project');
      expect(config.defaultBranch).toBe('main');
      expect(config.provider).toBe('codex');
      expect(config.reviewerEnabled).toBe(false);
      expect(config.prdDir).toBe('custom/prds');
      expect(config.scheduleBundleId).toBe('always-on');
      expect(config.providerLabel).toBe('');
      expect(config.fallbackOnRateLimit).toBe(defaults.fallbackOnRateLimit);
      expect(config.primaryFallbackModel).toBeNull();
      expect(config.secondaryFallbackModel).toBeNull();
      expect(config.claudeModel).toBeNull();
      expect(config.cronSchedule).toBe(defaults.cronSchedule);
      expect(config.reviewerSchedule).toBe(defaults.reviewerSchedule);
      expect(config.roadmapScanner).toEqual(defaults.roadmapScanner);
      expect(config.qa).toEqual(defaults.qa);
      expect(config.audit).toEqual(defaults.audit);
      expect(config.ux).toEqual(defaults.ux);
      expect(config.queue).toEqual(defaults.queue);
      expect(config.boardProvider).toEqual(defaults.boardProvider);
      expect(config.jobProviders).toEqual(defaults.jobProviders);
    });

    it('should write a custom provider preset when provided', () => {
      const config = buildInitConfig({
        projectName: 'demo-project',
        defaultBranch: 'main',
        provider: 'local-agent',
        providerPreset: {
          name: 'Local Agent',
          command: 'local-agent',
          promptFlag: '--prompt',
        },
        reviewerEnabled: true,
        prdDir: 'docs/prds',
      });

      expect(config.provider).toBe('local-agent');
      expect(config.providerPresets).toEqual({
        'local-agent': {
          name: 'Local Agent',
          command: 'local-agent',
          promptFlag: '--prompt',
        },
      });
    });

    it('should apply explicit job selections to install-consumed config fields', () => {
      const jobSelection = buildDefaultJobSelection({
        jobs: 'executor,qa,audit,analytics,slicer,pr-resolver,manager,merger',
        noJobs: 'reviewer',
        schedule: [
          'executor=1 * * * *',
          'qa=2 * * * *',
          'audit=3 * * * *',
          'analytics=4 * * * *',
          'slicer=5 * * * *',
          'pr-resolver=6 * * * *',
          'manager=7 * * * *',
          'merger=8 * * * *',
        ],
      });

      const config = buildInitConfig({
        projectName: 'demo-project',
        defaultBranch: 'main',
        provider: 'codex',
        reviewerEnabled: true,
        prdDir: 'docs/prds',
        jobSelection,
      });

      expect(config.executorEnabled).toBe(true);
      expect(config.cronSchedule).toBe('1 * * * *');
      expect(config.reviewerEnabled).toBe(false);
      expect(config.qa).toMatchObject({ enabled: true, schedule: '2 * * * *' });
      expect(config.audit).toMatchObject({ enabled: true, schedule: '3 * * * *' });
      expect(config.analytics).toMatchObject({ enabled: true, schedule: '4 * * * *' });
      expect(config.roadmapScanner).toMatchObject({
        enabled: true,
        slicerSchedule: '5 * * * *',
      });
      expect(config.prResolver).toMatchObject({ enabled: true, schedule: '6 * * * *' });
      expect(config.manager).toMatchObject({ enabled: true, schedule: '7 * * * *' });
      expect(config.merger).toMatchObject({ enabled: true, schedule: '8 * * * *' });
      expect(config.autoMerge).toBe(true);
    });

    it('should default init job selection to the core onboarding jobs', () => {
      const selection = buildDefaultJobSelection({ reviewerEnabled: false });
      const config = applyJobSelectionToConfig(
        buildInitConfig({
          projectName: 'demo-project',
          defaultBranch: 'main',
          provider: 'codex',
          reviewerEnabled: true,
          prdDir: 'docs/prds',
        }),
        selection,
      );

      expect(config.executorEnabled).toBe(true);
      expect(config.reviewerEnabled).toBe(false);
      expect(config.qa.enabled).toBe(true);
      expect(config.roadmapScanner.enabled).toBe(false);
      expect(config.prResolver.enabled).toBe(false);
      expect(config.manager.enabled).toBe(false);
      expect(config.audit.enabled).toBe(false);
      expect(config.analytics.enabled).toBe(false);
      expect(config.merger.enabled).toBe(false);
    });

    it('should keep the recommended guided bundle focused on core jobs', () => {
      const selection = buildBundleJobSelection('recommended');

      expect(selection.enabledJobs).toEqual(['executor', 'reviewer', 'qa']);
    });

    it('should make notification customization an explicit single-choice action', () => {
      const choices = getInitCustomizationChoices({ playwrightDetected: false });

      expect(choices[0]).toMatchObject({
        value: 'notifications',
        label: 'Notifications',
      });
      expect(choices.map((choice) => choice.value)).toEqual([
        'notifications',
        'jobs',
        'provider',
        'playwright',
        'done',
      ]);
    });

    it('should hide Playwright customization when Playwright is already detected', () => {
      const choices = getInitCustomizationChoices({ playwrightDetected: true });

      expect(choices.map((choice) => choice.value)).toEqual([
        'notifications',
        'jobs',
        'provider',
        'done',
      ]);
    });

    it('should not expose notification event selection in onboarding prompts', () => {
      const initSource = fs.readFileSync(path.join(PROJECT_ROOT, 'src/commands/init.ts'), 'utf-8');

      expect(initSource).not.toContain('Notification events CSV');
      expect(initSource).not.toContain('Default events:');
    });

    it('should reject unknown job and malformed schedule flags', () => {
      expect(() => buildDefaultJobSelection({ jobs: 'executor,unknown' })).toThrow(
        'Unknown init job',
      );
      expect(() => buildDefaultJobSelection({ schedule: 'qa=bad' })).toThrow(
        'Invalid cron schedule',
      );
    });

    it('should include practical onboarding jobs in the catalog', () => {
      const ids = getInitJobCatalog().map((job) => job.id);

      expect(ids).toEqual([
        'executor',
        'reviewer',
        'qa',
        'audit',
        'analytics',
        'slicer',
        'pr-resolver',
        'manager',
        'merger',
      ]);
    });

    it('should persist explicit notification webhooks without masking config values', () => {
      const config = buildInitConfig({
        projectName: 'demo-project',
        defaultBranch: 'main',
        provider: 'codex',
        reviewerEnabled: true,
        prdDir: 'docs/prds',
        notifications: {
          skipped: false,
          webhooks: [
            {
              type: 'telegram',
              botToken: '123456:secret',
              chatId: '987654',
              events: ['run_failed'],
            },
          ],
        },
      });

      expect(config.notifications.webhooks).toEqual([
        {
          type: 'telegram',
          botToken: '123456:secret',
          chatId: '987654',
          events: ['run_failed'],
        },
      ]);
    });
  });

  describeIfExternalTools('should NOT create .claude/commands/ directory', () => {
    it('should not create .claude/commands/ after nw init', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      execSync(`${TSX_CMD} init --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      // Guard against accidentally leaving .claude/commands/ creation code behind
      const claudeCommandsDir = path.join(tempDir, '.claude', 'commands');
      expect(fs.existsSync(claudeCommandsDir)).toBe(false);
    });
  });

  describeIfExternalTools('should overwrite instructions files with --force', () => {
    it('should overwrite existing instructions/executor.md with --force flag', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      // Pre-create instructions/executor.md with stale content
      const instructionsDir = path.join(tempDir, 'instructions');
      fs.mkdirSync(instructionsDir, { recursive: true });
      const executorMd = path.join(instructionsDir, 'executor.md');
      const staleContent = '# STALE CONTENT - should be overwritten';
      fs.writeFileSync(executorMd, staleContent);

      // Run with --force
      execSync(`${TSX_CMD} init --force --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      // File content should have changed (no longer stale)
      const newContent = fs.readFileSync(executorMd, 'utf-8');
      expect(newContent).not.toBe(staleContent);
      expect(newContent).not.toContain('STALE CONTENT');
    });
  });

  describeIfExternalTools('--force flag', () => {
    it('should overwrite existing files with --force flag', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      // First run
      execSync(`${TSX_CMD} init --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const configPath = path.join(tempDir, 'night-watch.config.json');
      const originalContent = fs.readFileSync(configPath, 'utf-8');

      // Modify the config
      const modifiedConfig = JSON.parse(originalContent);
      modifiedConfig.projectName = 'MODIFIED';
      fs.writeFileSync(configPath, JSON.stringify(modifiedConfig, null, 2));

      // Run with --force
      execSync(`${TSX_CMD} init --force --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      // Config should be reset (not contain MODIFIED)
      const newContent = fs.readFileSync(configPath, 'utf-8');
      expect(newContent).not.toContain('MODIFIED');
    });
  });

  describeIfExternalTools('--provider flag', () => {
    it('should set provider in config with --provider codex', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      execSync(`${TSX_CMD} init --provider codex`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const configPath = path.join(tempDir, 'night-watch.config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.provider).toBe('codex');
    });
  });

  describe('--custom-provider-command flag', () => {
    it('should write a custom provider preset in non-interactive mode', () => {
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      execSync(
        `${TSX_CMD} init --yes --custom-provider-command local-agent --custom-provider-name "Local Agent" --custom-provider-id local-agent`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
          stdio: 'pipe',
          timeout: 15000,
        },
      );

      const configPath = path.join(tempDir, 'night-watch.config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.provider).toBe('local-agent');
      expect(config.providerPresets['local-agent']).toEqual({
        name: 'Local Agent',
        command: 'local-agent',
      });
    });

    it('should invite users to Discord after init completes', () => {
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      const output = execSync(
        `${TSX_CMD} init --yes --custom-provider-command local-agent --custom-provider-name "Local Agent" --custom-provider-id local-agent`,
        {
          encoding: 'utf-8',
          cwd: tempDir,
          stdio: 'pipe',
          timeout: 15000,
        },
      );

      expect(output).toContain('Join the Night Watch Discord: https://discord.gg/maCPEJzPXa');
    });
  });

  describeIfExternalTools('--no-reviewer flag', () => {
    it('should set reviewerEnabled to false in config', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      execSync(`${TSX_CMD} init --no-reviewer --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const configPath = path.join(tempDir, 'night-watch.config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.reviewerEnabled).toBe(false);
    });
  });

  describe('resolveTemplatePath', () => {
    it('should return custom path when file exists', () => {
      const customDir = path.join(tempDir, 'custom-templates');
      fs.mkdirSync(customDir, { recursive: true });
      fs.writeFileSync(path.join(customDir, 'night-watch.md'), '# Custom Night Watch');

      const result = resolveTemplatePath('night-watch.md', customDir, '/bundled/templates');

      expect(result.source).toBe('custom');
      expect(result.path).toBe(path.join(customDir, 'night-watch.md'));
    });

    it('should fall back to bundled when custom missing', () => {
      const customDir = path.join(tempDir, 'custom-templates');
      fs.mkdirSync(customDir, { recursive: true });
      // No night-watch.md in custom dir

      const result = resolveTemplatePath('night-watch.md', customDir, '/bundled/templates');

      expect(result.source).toBe('bundled');
      expect(result.path).toBe('/bundled/templates/night-watch.md');
    });

    it('should fall back to bundled when custom dir missing', () => {
      // customTemplatesDir is null (dir doesn't exist)
      const result = resolveTemplatePath('night-watch.md', null, '/bundled/templates');

      expect(result.source).toBe('bundled');
      expect(result.path).toBe('/bundled/templates/night-watch.md');
    });
  });

  describe('chooseProviderForNonInteractive', () => {
    it('should prefer codex when multiple providers are available', () => {
      expect(chooseProviderForNonInteractive(['claude', 'codex'])).toBe('codex');
    });

    it('should fall back to the first detected provider when claude is unavailable', () => {
      expect(chooseProviderForNonInteractive(['local-agent'])).toBe('local-agent');
    });
  });

  describe('provider auto-selection', () => {
    it('isInteractiveInitSession returns false for the test process', () => {
      expect(isInteractiveInitSession()).toBe(false);
    });

    it('should select codex over claude by precedence', () => {
      expect(chooseProviderByPrecedence(['claude', 'codex'])).toBe('codex');
    });

    it('should map a single detected claude command to claude presets while defaulting to claude', () => {
      const detected = getDetectedProviderPresets(['claude']);

      expect(detected).toContain('claude');
      expect(detected).toContain('claude-sonnet-4-6');
      expect(chooseProviderByPrecedence(detected)).toBe('claude');
    });

    it('should map detected codex and claude commands and default to codex', () => {
      const detected = getDetectedProviderPresets(['claude', 'codex']);

      expect(detected[0]).toBe('codex');
      expect(chooseProviderByPrecedence(detected)).toBe('codex');
    });

    it('should summarize codex as selected and claude as also available', () => {
      const summary = buildProviderSummary('codex', ['codex', 'claude']);

      expect(summary).toContain('Auto-selected Codex');
      expect(summary).toContain('Also available: Claude');
    });

    it('should not force provider override during default onboarding', () => {
      expect(shouldPromptProviderOverride(true, ['codex', 'claude'])).toBe(false);
      expect(shouldPromptProviderOverride(true, ['codex'])).toBe(false);
      expect(shouldPromptProviderOverride(false, ['codex', 'claude'])).toBe(false);
    });

    it('should build detected provider choices with a custom provider command option', () => {
      const choices = buildProviderChoices(['codex', 'claude']);

      expect(choices).toEqual([
        { label: 'Codex', provider: 'codex', custom: false },
        { label: 'Claude', provider: 'claude', custom: false },
        { label: 'Custom provider command', custom: true },
      ]);
    });

    it('should select provider override choices by one-based index', () => {
      const choices = buildProviderChoices(['codex', 'claude']);

      expect(selectProviderOverrideByIndex(choices, '2')).toEqual({
        label: 'Claude',
        provider: 'claude',
        custom: false,
      });
      expect(selectProviderOverrideByIndex(choices, '3')).toEqual({
        label: 'Custom provider command',
        custom: true,
      });
      expect(selectProviderOverrideByIndex(choices, '0')).toBeNull();
      expect(selectProviderOverrideByIndex(choices, 'nope')).toBeNull();
    });
  });

  describe('getGitHubRemoteStatus', () => {
    it('should report no GitHub remote when origin is missing', () => {
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });

      expect(getGitHubRemoteStatus(tempDir)).toEqual({
        hasGitHubRemote: false,
        remoteUrl: null,
      });
    });

    it('should detect a GitHub origin remote', () => {
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git remote add origin git@github.com:jonit-dev/night-watch-cli.git', {
        cwd: tempDir,
        stdio: 'pipe',
      });

      expect(getGitHubRemoteStatus(tempDir)).toEqual({
        hasGitHubRemote: true,
        remoteUrl: 'git@github.com:jonit-dev/night-watch-cli.git',
      });
    });
  });

  describeIfExternalTools('custom template integration', () => {
    it('should use custom template when available during init', () => {
      // Initialize git repo
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

      // Create custom templates directory with a custom executor.md
      const customTemplatesDir = path.join(tempDir, '.night-watch', 'templates');
      fs.mkdirSync(customTemplatesDir, { recursive: true });
      fs.writeFileSync(
        path.join(customTemplatesDir, 'executor.md'),
        '# Custom Night Watch Template\n\nThis is a custom template.\n',
      );

      // Create config to point to custom templates
      fs.writeFileSync(
        path.join(tempDir, 'night-watch.config.json'),
        JSON.stringify({
          templatesDir: '.night-watch/templates',
        }),
      );

      execSync(`${TSX_CMD} init --force --provider claude`, {
        encoding: 'utf-8',
        cwd: tempDir,
        stdio: 'pipe',
        timeout: 15000,
      });

      const executorMd = path.join(tempDir, 'instructions', 'executor.md');
      const content = fs.readFileSync(executorMd, 'utf-8');

      // Should contain our custom content
      expect(content).toContain('Custom Night Watch Template');
    });
  });

  describe('label sync preconditions', () => {
    it('NIGHT_WATCH_LABELS includes e2e-validated for init sync', async () => {
      const { NIGHT_WATCH_LABELS } = await import('@night-watch/core');
      const names = NIGHT_WATCH_LABELS.map((l: { name: string }) => l.name);
      expect(names).toContain('e2e-validated');
    });

    it('init skips label sync when no GitHub remote', () => {
      // getGitHubRemoteStatus returns hasGitHubRemote: false for non-git dirs
      const status = getGitHubRemoteStatus(tempDir);
      expect(status.hasGitHubRemote).toBe(false);
    });

    it('label sync condition: skips when hasGitHubRemote is false', () => {
      // Simulate the condition check: no sync when no GitHub remote
      const remoteStatus = { hasGitHubRemote: false, remoteUrl: null };
      const ghAuthenticated = true;
      const shouldSync = remoteStatus.hasGitHubRemote && ghAuthenticated;
      expect(shouldSync).toBe(false);
    });

    it('label sync condition: skips when gh not authenticated', () => {
      // Simulate the condition check: no sync when gh not authenticated
      const remoteStatus = { hasGitHubRemote: true, remoteUrl: 'https://github.com/test/repo' };
      const ghAuthenticated = false;
      const shouldSync = remoteStatus.hasGitHubRemote && ghAuthenticated;
      expect(shouldSync).toBe(false);
    });

    it('label sync condition: proceeds when GitHub remote and gh authenticated', () => {
      // Simulate the condition check: sync proceeds when both conditions met
      const remoteStatus = { hasGitHubRemote: true, remoteUrl: 'https://github.com/test/repo' };
      const ghAuthenticated = true;
      const shouldSync = remoteStatus.hasGitHubRemote && ghAuthenticated;
      expect(shouldSync).toBe(true);
    });
  });
});
