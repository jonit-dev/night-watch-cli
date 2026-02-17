#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as readline from 'readline';
import {
  CONFIG_FILE_NAME,
  DEFAULT_PRD_DIR,
  LOG_DIR,
  VALID_PROVIDERS,
} from '../constants.js';
import { Provider } from '../types.js';
import {
  createTable,
  header,
  info,
  label,
  step,
  success,
  error as uiError,
} from '../utils/ui.js';
import {
  checkGhCli,
  checkGitRepo,
  detectProviders,
} from '../utils/checks.js';

// Get templates directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

interface IInitOptions {
  force: boolean;
  prdDir?: string;
  provider?: string;
  reviewer?: boolean;
}

/**
 * Get the default branch name for the repository
 */
export function getDefaultBranch(cwd: string): string {
  const getRefTimestamp = (ref: string): number | null => {
    try {
      const timestamp = execSync(`git log -1 --format=%ct ${ref}`, {
        encoding: 'utf-8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      const parsed = parseInt(timestamp, 10);
      return Number.isNaN(parsed) ? null : parsed;
    } catch {
      return null;
    }
  };

  const getBranchLatestTimestamp = (branch: 'main' | 'master'): number | null => {
    const refs = [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`];
    let latest: number | null = null;

    for (const ref of refs) {
      const timestamp = getRefTimestamp(ref);
      if (timestamp !== null && (latest === null || timestamp > latest)) {
        latest = timestamp;
      }
    }

    return latest;
  };

  try {
    // If both main and master exist, use whichever has the newest tip commit
    const mainTimestamp = getBranchLatestTimestamp('main');
    const masterTimestamp = getBranchLatestTimestamp('master');

    if (mainTimestamp !== null && masterTimestamp !== null) {
      return mainTimestamp >= masterTimestamp ? 'main' : 'master';
    }
    if (mainTimestamp !== null) {
      return 'main';
    }
    if (masterTimestamp !== null) {
      return 'master';
    }

    // Fallback to origin/HEAD when neither main nor master exists
    const remoteRef = execSync('git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo ""', {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (remoteRef) {
      // Extract branch name from refs/remotes/origin/HEAD -> refs/remotes/origin/main
      const match = remoteRef.match(/refs\/remotes\/origin\/(.+)/);
      if (match) {
        return match[1];
      }
    }

    // Default to main
    return 'main';
  } catch {
    return 'main';
  }
}

/**
 * Get the project name from the directory
 */
function getProjectName(cwd: string): string {
  return path.basename(cwd);
}

/**
 * Prompt user to select a provider from available options
 */
function promptProviderSelection(providers: Provider[]): Promise<Provider> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('\nMultiple AI providers detected:');
    providers.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p}`);
    });

    rl.question('\nSelect a provider (enter number): ', (answer) => {
      rl.close();
      const selection = parseInt(answer.trim(), 10);
      if (isNaN(selection) || selection < 1 || selection > providers.length) {
        reject(new Error('Invalid selection. Please run init again and select a valid number.'));
        return;
      }
      resolve(providers[selection - 1]);
    });
  });
}

/**
 * Create directory if it doesn't exist
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Copy and process template file
 */
function processTemplate(
  templateName: string,
  targetPath: string,
  replacements: Record<string, string>,
  force: boolean
): boolean {
  // Skip if exists and not forcing
  if (fs.existsSync(targetPath) && !force) {
    console.log(`  Skipped (exists): ${targetPath}`);
    return false;
  }

  const templatePath = join(TEMPLATES_DIR, templateName);
  let content = fs.readFileSync(templatePath, 'utf-8');

  // Replace placeholders
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(key, value);
  }

  fs.writeFileSync(targetPath, content);
  console.log(`  Created: ${targetPath}`);
  return true;
}

/**
 * Ensure Night Watch entries are in .gitignore
 */
function addToGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');

  const entries = [
    { pattern: '/logs/', label: '/logs/', check: (c: string) => c.includes('/logs/') || /^logs\//m.test(c) },
    { pattern: CONFIG_FILE_NAME, label: CONFIG_FILE_NAME, check: (c: string) => c.includes(CONFIG_FILE_NAME) },
    { pattern: '*.claim', label: '*.claim', check: (c: string) => c.includes('*.claim') },
  ];

  if (!fs.existsSync(gitignorePath)) {
    const lines = ['# Night Watch', ...entries.map(e => e.pattern), ''];
    fs.writeFileSync(gitignorePath, lines.join('\n'));
    console.log(`  Created: ${gitignorePath} (with Night Watch entries)`);
    return;
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const missing = entries.filter(e => !e.check(content));

  if (missing.length === 0) {
    console.log(`  Skipped (exists): Night Watch entries in .gitignore`);
    return;
  }

  const additions = missing.map(e => e.pattern).join('\n');
  const newContent = content.trimEnd() + '\n\n# Night Watch\n' + additions + '\n';
  fs.writeFileSync(gitignorePath, newContent);
  console.log(`  Updated: ${gitignorePath} (added ${missing.map(e => e.label).join(', ')})`);
}

/**
 * Create NIGHT-WATCH-SUMMARY.md template if it doesn't exist
 */
function createSummaryFile(summaryPath: string, force: boolean): void {
  if (fs.existsSync(summaryPath) && !force) {
    console.log(`  Skipped (exists): ${summaryPath}`);
    return;
  }

  const content = `# Night Watch Summary

This file tracks the progress of PRDs executed by Night Watch.

---

`;
  fs.writeFileSync(summaryPath, content);
  console.log(`  Created: ${summaryPath}`);
}

/**
 * Main init command implementation
 */
export function initCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize night-watch in the current project')
    .option('-f, --force', 'Overwrite existing configuration')
    .option('-d, --prd-dir <path>', 'Path to PRD directory')
    .option('-p, --provider <name>', 'AI provider to use (claude or codex)')
    .option('--no-reviewer', 'Disable reviewer cron job')
    .action(async (options: IInitOptions) => {
      const cwd = process.cwd();
      const force = options.force || false;
      const prdDir = options.prdDir || DEFAULT_PRD_DIR;

      console.log();
      header('Night Watch CLI - Initializing');

      // Step 1: Verify git repository
      step(1, 9, 'Checking git repository...');
      const gitCheck = checkGitRepo(cwd);
      if (!gitCheck.passed) {
        uiError(gitCheck.message);
        console.log('Please run this command from the root of a git repository.');
        process.exit(1);
      }
      success(gitCheck.message);

      // Step 2: Verify gh CLI
      step(2, 9, 'Checking GitHub CLI (gh)...');
      const ghCheck = checkGhCli();
      if (!ghCheck.passed) {
        uiError(ghCheck.message);
        process.exit(1);
      }
      success(ghCheck.message);

      // Step 3: Detect AI providers
      step(3, 10, 'Detecting AI providers...');
      let selectedProvider: Provider;

      if (options.provider) {
        // Validate provider flag
        if (!VALID_PROVIDERS.includes(options.provider as Provider)) {
          uiError(`Invalid provider "${options.provider}".`);
          console.log(`Valid providers: ${VALID_PROVIDERS.join(', ')}`);
          process.exit(1);
        }
        selectedProvider = options.provider as Provider;
        info(`Using provider from flag: ${selectedProvider}`);
      } else {
        // Auto-detect providers
        const detectedProviders = detectProviders();

        if (detectedProviders.length === 0) {
          uiError('No AI provider CLI found.');
          console.log('\nPlease install one of the following:');
          console.log('  - Claude CLI: https://docs.anthropic.com/en/docs/claude-cli');
          console.log('  - Codex CLI: https://github.com/openai/codex');
          process.exit(1);
        } else if (detectedProviders.length === 1) {
          selectedProvider = detectedProviders[0];
          info(`Auto-detected provider: ${selectedProvider}`);
        } else {
          // Multiple providers - prompt user
          try {
            selectedProvider = await promptProviderSelection(detectedProviders);
            info(`Selected provider: ${selectedProvider}`);
          } catch (err) {
            uiError(`${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
          }
        }
      }

      // Set reviewerEnabled from flag (default: true, --no-reviewer sets to false)
      const reviewerEnabled = options.reviewer !== false;

      // Gather project information
      const projectName = getProjectName(cwd);
      const defaultBranch = getDefaultBranch(cwd);

      // Display project configuration
      header('Project Configuration');
      label('Project', projectName);
      label('Default branch', defaultBranch);
      label('Provider', selectedProvider);
      label('Reviewer', reviewerEnabled ? 'Enabled' : 'Disabled');
      console.log();

      // Define replacements for templates
      const replacements: Record<string, string> = {
        '${PROJECT_DIR}': cwd,
        '${PROJECT_NAME}': projectName,
        '${DEFAULT_BRANCH}': defaultBranch,
      };

      // Step 4: Create PRD directory structure
      step(4, 10, 'Creating PRD directory structure...');
      const prdDirPath = path.join(cwd, prdDir);
      const doneDirPath = path.join(prdDirPath, 'done');
      ensureDir(doneDirPath);
      success(`Created ${prdDirPath}/`);
      success(`Created ${doneDirPath}/`);

      // Step 5: Create NIGHT-WATCH-SUMMARY.md
      step(5, 10, 'Creating NIGHT-WATCH-SUMMARY.md...');
      const summaryPath = path.join(prdDirPath, 'NIGHT-WATCH-SUMMARY.md');
      createSummaryFile(summaryPath, force);

      // Step 6: Create logs directory
      step(6, 10, 'Creating logs directory...');
      const logsPath = path.join(cwd, LOG_DIR);
      ensureDir(logsPath);
      success(`Created ${logsPath}/`);

      // Add /logs/ to .gitignore
      addToGitignore(cwd);

      // Step 7: Create .claude/commands directory and copy templates
      step(7, 10, 'Creating Claude slash commands...');
      const commandsDir = path.join(cwd, '.claude', 'commands');
      ensureDir(commandsDir);
      success(`Created ${commandsDir}/`);

      // Copy night-watch.md template
      processTemplate(
        'night-watch.md',
        path.join(commandsDir, 'night-watch.md'),
        replacements,
        force
      );

      // Copy prd-executor.md template
      processTemplate(
        'prd-executor.md',
        path.join(commandsDir, 'prd-executor.md'),
        replacements,
        force
      );

      // Copy night-watch-pr-reviewer.md template
      processTemplate(
        'night-watch-pr-reviewer.md',
        path.join(commandsDir, 'night-watch-pr-reviewer.md'),
        replacements,
        force
      );

      // Step 8: Create config file
      step(8, 10, 'Creating configuration file...');
      const configPath = path.join(cwd, CONFIG_FILE_NAME);

      if (fs.existsSync(configPath) && !force) {
        console.log(`  Skipped (exists): ${configPath}`);
      } else {
        // Read and process config template
        let configContent = fs.readFileSync(
          join(TEMPLATES_DIR, 'night-watch.config.json'),
          'utf-8'
        );

        // Replace placeholders with project values
        configContent = configContent.replace(
          '"projectName": ""',
          `"projectName": "${projectName}"`
        );
        configContent = configContent.replace(
          '"defaultBranch": ""',
          `"defaultBranch": "${defaultBranch}"`
        );

        // Set provider in config
        configContent = configContent.replace(
          /"provider":\s*"[^"]*"/,
          `"provider": "${selectedProvider}"`
        );

        // Set reviewerEnabled in config
        configContent = configContent.replace(
          /"reviewerEnabled":\s*(true|false)/,
          `"reviewerEnabled": ${reviewerEnabled}`
        );

        fs.writeFileSync(configPath, configContent);
        success(`Created ${configPath}`);
      }

      // Step 9: Register in global registry
      step(9, 10, 'Registering project in global registry...');
      try {
        const { registerProject } = await import('../utils/registry.js');
        const entry = registerProject(cwd);
        success(`Registered as "${entry.name}" in global registry`);
      } catch (regErr) {
        console.warn(`  Warning: Could not register in global registry: ${regErr instanceof Error ? regErr.message : String(regErr)}`);
      }

      // Step 10: Print summary
      step(10, 10, 'Initialization complete!');

      // Summary with table
      header('Initialization Complete');
      const filesTable = createTable({ head: ['Created Files', ''] });
      filesTable.push(['PRD Directory', `${prdDir}/done/`]);
      filesTable.push(['Summary File', `${prdDir}/NIGHT-WATCH-SUMMARY.md`]);
      filesTable.push(['Logs Directory', `${LOG_DIR}/`]);
      filesTable.push(['Slash Commands', '.claude/commands/night-watch.md']);
      filesTable.push(['', '.claude/commands/prd-executor.md']);
      filesTable.push(['', '.claude/commands/night-watch-pr-reviewer.md']);
      filesTable.push(['Config File', CONFIG_FILE_NAME]);
      filesTable.push(['Global Registry', '~/.night-watch/projects.json']);
      console.log(filesTable.toString());

      // Configuration summary
      header('Configuration');
      label('Provider', selectedProvider);
      label('Reviewer', reviewerEnabled ? 'Enabled' : 'Disabled');
      console.log();

      // Next steps
      header('Next Steps');
      info('1. Add your PRD files to docs/PRDs/night-watch/');
      info('2. Run `night-watch install` to set up cron jobs');
      info('3. Or run `night-watch run` to execute PRDs manually');
      console.log();
    });
}

export default initCommand;
