import { afterEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resetTelemetryReporterForTests,
  setTelemetryReporterForTests,
} from '@/cli/commands/shared/telemetry.js';
import { bootstrapTelemetry } from '@/cli/telemetry-bootstrap.js';

const CLI_PKG_DIR = path.resolve(__dirname, '..', '..');
const CLI_PATH = path.join(CLI_PKG_DIR, 'dist', 'cli.js');

const packageJson = JSON.parse(fs.readFileSync(path.join(CLI_PKG_DIR, 'package.json'), 'utf-8'));
process.env.NW_TELEMETRY_DISABLED = '1';

describe('CLI', () => {
  describe('help output', () => {
    it('should show help text with all commands', () => {
      const output = execSync(`node "${CLI_PATH}" --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      // Check for program name and description
      expect(output).toContain('night-watch');
      expect(output).toContain('Autonomous PRD execution');

      // Check for all subcommands
      expect(output).toContain('init');
      expect(output).toContain('run');
      expect(output).toContain('review');
      expect(output).toContain('install');
      expect(output).toContain('uninstall');
      expect(output).toContain('status');
      expect(output).toContain('logs');
      expect(output).toContain('doctor');
      expect(output).toContain('dashboard');
      expect(output).toContain('history');
      expect(output).toContain('update');
      expect(output).toContain('prds');
      expect(output).toContain('prs');
      expect(output).toContain('cancel');
      expect(output).toContain('retry');
      expect(output).toContain('telemetry');
    });

    it('should show init command help', () => {
      const output = execSync(`node "${CLI_PATH}" init --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Initialize night-watch');
      expect(output).toContain('--force');
      expect(output).toContain('--prd-dir');
    });

    it('should show run command help', () => {
      const output = execSync(`node "${CLI_PATH}" run --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Run PRD executor');
      expect(output).toContain('--timeout');
      expect(output).toContain('--dry-run');
      expect(output).toContain('--provider');
    });

    it('should show review command help', () => {
      const output = execSync(`node "${CLI_PATH}" review --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Run PR reviewer');
      expect(output).toContain('--timeout');
      expect(output).toContain('--dry-run');
      expect(output).toContain('--provider');
    });

    it('should show install command help', () => {
      const output = execSync(`node "${CLI_PATH}" install --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Add crontab entries');
      expect(output).toContain('--schedule');
      expect(output).toContain('--reviewer-schedule');
    });

    it('should show uninstall command help', () => {
      const output = execSync(`node "${CLI_PATH}" uninstall --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Remove crontab entries');
      expect(output).toContain('--keep-logs');
    });

    it('should show update command help', () => {
      const output = execSync(`node "${CLI_PATH}" update --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Update global CLI and refresh cron');
      expect(output).toContain('--projects');
      expect(output).toContain('--global-spec');
      expect(output).toContain('--no-global');
    });

    it('should show status command help', () => {
      const output = execSync(`node "${CLI_PATH}" status --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Show current night-watch status');
      expect(output).toContain('--verbose');
      expect(output).toContain('--json');
    });

    it('should show logs command help', () => {
      const output = execSync(`node "${CLI_PATH}" logs --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('View night-watch log output');
      expect(output).toContain('--lines');
      expect(output).toContain('--follow');
      expect(output).toContain('--type');
    });

    it('should show doctor command help', () => {
      const output = execSync(`node "${CLI_PATH}" doctor --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Check Night Watch configuration');
    });

    it('should show prd command in help', () => {
      const output = execSync(`node "${CLI_PATH}" --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('prd');
    });

    it('should show prd create help', () => {
      const output = execSync(`node "${CLI_PATH}" prd create --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Generate a new PRD');
      expect(output).toContain('--number');
      expect(output).toContain('--model');
    });

    it('should show prd list help', () => {
      const output = execSync(`node "${CLI_PATH}" prd list --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('List all PRDs');
      expect(output).toContain('--json');
    });

    it('should show prds command help', () => {
      const output = execSync(`node "${CLI_PATH}" prds --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('List all PRDs');
      expect(output).toContain('--json');
    });

    it('should show prs command help', () => {
      const output = execSync(`node "${CLI_PATH}" prs --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('PRs');
      expect(output).toContain('--json');
    });

    it('should show cancel command help', () => {
      const output = execSync(`node "${CLI_PATH}" cancel --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Cancel');
      expect(output).toContain('--type');
      expect(output).toContain('--force');
    });

    it('should show retry command help', () => {
      const output = execSync(`node "${CLI_PATH}" retry --help`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('completed PRD');
      expect(output).toContain('<prdName>');
    });
  });

  describe('telemetry notice', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      resetTelemetryReporterForTests();
    });

    it('should print first run notice once and continue', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cli-notice-'));
      const originalEnv = { ...process.env };
      process.env.NIGHT_WATCH_HOME = tempDir;
      delete process.env.NW_TELEMETRY_DISABLED;
      delete process.env.DO_NOT_TRACK;
      setTelemetryReporterForTests(vi.fn().mockResolvedValue(undefined));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        bootstrapTelemetry('1.2.3', ['node', 'night-watch', 'status']);
        bootstrapTelemetry('1.2.3', ['node', 'night-watch', 'status']);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0]?.[0]).toContain(
          'Night Watch collects anonymous product telemetry',
        );
      } finally {
        process.env = originalEnv;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('version output', () => {
    it('should show version', () => {
      const output = execSync(`node "${CLI_PATH}" --version`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output.trim()).toBe(packageJson.version);
    });
  });

  describe('command execution', () => {
    it('should show dry-run output for run command', () => {
      const output = execSync(`node "${CLI_PATH}" run --dry-run`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Dry Run: PRD Executor');
      expect(output).toContain('Configuration');
      expect(output).toContain('Provider');
      expect(output).toContain('Provider CLI');
      expect(output).toContain('PRD Directory');
      expect(output).toContain('Board Status');
      expect(output).toContain('Provider Invocation');
      expect(output).toContain('night-watch-cron.sh');
    }, 15000);

    it('should show dry-run output for review command', () => {
      const output = execSync(`node "${CLI_PATH}" review --dry-run`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Dry Run: PR Reviewer');
      expect(output).toContain('Configuration');
      expect(output).toContain('Provider');
      expect(output).toContain('Provider CLI');
      expect(output).toContain('Min Review Score');
      expect(output).toContain('Open PRs Needing Work');
      expect(output).toContain('Provider Invocation');
      expect(output).toContain('night-watch-pr-reviewer-cron.sh');
    });

    it('should show retry config in review dry-run output', () => {
      const output = execSync(`node "${CLI_PATH}" review --dry-run`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      // Verify retry env vars are passed to the script
      expect(output).toContain('NW_REVIEWER_MAX_RETRIES');
      expect(output).toContain('NW_REVIEWER_RETRY_DELAY');
    });

    it('should execute install command', () => {
      const output = execSync(`node "${CLI_PATH}" install`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      // Accept either a fresh install or an already-installed message
      const isInstalled =
        output.includes('Night Watch installed') || output.includes('already installed');
      expect(isInstalled).toBe(true);
    });

    it('should execute uninstall command', () => {
      const output = execSync(`node "${CLI_PATH}" uninstall`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      expect(output).toContain('Removing Night Watch');
    });

    it('should execute status command', () => {
      const output = execSync(`node "${CLI_PATH}" status`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      // Status command now works
      expect(output).toContain('Night Watch Status');
    });

    it('should execute logs command', () => {
      const output = execSync(`node "${CLI_PATH}" logs`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
      });

      // Logs command now works
      expect(output).toContain('Log');
    });
  });
});
