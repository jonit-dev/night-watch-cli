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

// Get templates directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

interface InitOptions {
  force: boolean;
  prdDir?: string;
  provider?: string;
  reviewer?: boolean;
}

/**
 * Get the default branch name for the repository
 */
function getDefaultBranch(cwd: string): string {
  try {
    // Try to get the default branch from origin
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

    // Fallback: check if main or master exists
    const branches = execSync('git branch --list main master', {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (branches.includes('main')) {
      return 'main';
    }
    if (branches.includes('master')) {
      return 'master';
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
 * Check if current directory is a git repository
 */
function isGitRepo(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, '.git'));
}

/**
 * Check if gh CLI is authenticated
 */
function isGhAuthenticated(): boolean {
  try {
    execSync('gh auth status', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if claude CLI is available
 */
function isClaudeAvailable(): boolean {
  try {
    execSync('which claude', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if codex CLI is available
 */
function isCodexAvailable(): boolean {
  try {
    execSync('which codex', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect which AI provider CLIs are installed
 */
function detectProviders(): Provider[] {
  const providers: Provider[] = [];
  if (isClaudeAvailable()) {
    providers.push('claude');
  }
  if (isCodexAvailable()) {
    providers.push('codex');
  }
  return providers;
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
 * Add /logs/ to .gitignore if not already there
 */
function addToGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '# Night Watch logs\n/logs/\n');
    console.log(`  Created: ${gitignorePath} (with /logs/ entry)`);
    return;
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');

  // Check if /logs/ or logs/ already exists
  if (content.includes('/logs/') || /^logs\//m.test(content)) {
    console.log(`  Skipped (exists): /logs/ in .gitignore`);
    return;
  }

  // Append /logs/ to .gitignore
  const newContent = content.trimEnd() + '\n\n# Night Watch logs\n/logs/\n';
  fs.writeFileSync(gitignorePath, newContent);
  console.log(`  Updated: ${gitignorePath} (added /logs/ entry)`);
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
    .action(async (options: InitOptions) => {
      const cwd = process.cwd();
      const force = options.force || false;
      const prdDir = options.prdDir || DEFAULT_PRD_DIR;

      console.log('\nNight Watch CLI - Initializing...\n');

      // Step 1: Verify git repository
      console.log('[1/9] Checking git repository...');
      if (!isGitRepo(cwd)) {
        console.error('Error: Current directory is not a git repository.');
        console.error('Please run this command from the root of a git repository.');
        process.exit(1);
      }
      console.log('  OK: Git repository found.');

      // Step 2: Verify gh CLI
      console.log('[2/9] Checking GitHub CLI (gh)...');
      if (!isGhAuthenticated()) {
        console.error('Error: GitHub CLI (gh) is not authenticated.');
        console.error('Please run: gh auth login');
        process.exit(1);
      }
      console.log('  OK: GitHub CLI is authenticated.');

      // Step 3: Detect AI providers
      console.log('[3/9] Detecting AI providers...');
      let selectedProvider: Provider;

      if (options.provider) {
        // Validate provider flag
        if (!VALID_PROVIDERS.includes(options.provider as Provider)) {
          console.error(`Error: Invalid provider "${options.provider}".`);
          console.error(`Valid providers: ${VALID_PROVIDERS.join(', ')}`);
          process.exit(1);
        }
        selectedProvider = options.provider as Provider;
        console.log(`  Using provider from flag: ${selectedProvider}`);
      } else {
        // Auto-detect providers
        const detectedProviders = detectProviders();

        if (detectedProviders.length === 0) {
          console.error('Error: No AI provider CLI found.');
          console.error('\nPlease install one of the following:');
          console.error('  - Claude CLI: https://docs.anthropic.com/en/docs/claude-cli');
          console.error('  - Codex CLI: https://github.com/openai/codex');
          process.exit(1);
        } else if (detectedProviders.length === 1) {
          selectedProvider = detectedProviders[0];
          console.log(`  Auto-detected provider: ${selectedProvider}`);
        } else {
          // Multiple providers - prompt user
          try {
            selectedProvider = await promptProviderSelection(detectedProviders);
            console.log(`  Selected provider: ${selectedProvider}`);
          } catch (error) {
            console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
          }
        }
      }

      // Set reviewerEnabled from flag (default: true, --no-reviewer sets to false)
      const reviewerEnabled = options.reviewer !== false;

      // Gather project information
      const projectName = getProjectName(cwd);
      const defaultBranch = getDefaultBranch(cwd);

      console.log(`\nProject: ${projectName}`);
      console.log(`Default branch: ${defaultBranch}`);
      console.log(`Provider: ${selectedProvider}`);
      console.log(`Reviewer: ${reviewerEnabled ? 'Enabled' : 'Disabled'}\n`);

      // Define replacements for templates
      const replacements: Record<string, string> = {
        '${PROJECT_DIR}': cwd,
        '${PROJECT_NAME}': projectName,
        '${DEFAULT_BRANCH}': defaultBranch,
      };

      // Step 4: Create PRD directory structure
      console.log('[4/9] Creating PRD directory structure...');
      const prdDirPath = path.join(cwd, prdDir);
      const doneDirPath = path.join(prdDirPath, 'done');
      ensureDir(doneDirPath);
      console.log(`  Created: ${prdDirPath}/`);
      console.log(`  Created: ${doneDirPath}/`);

      // Step 5: Create NIGHT-WATCH-SUMMARY.md
      console.log('[5/9] Creating NIGHT-WATCH-SUMMARY.md...');
      const summaryPath = path.join(prdDirPath, 'NIGHT-WATCH-SUMMARY.md');
      createSummaryFile(summaryPath, force);

      // Step 6: Create logs directory
      console.log('[6/9] Creating logs directory...');
      const logsPath = path.join(cwd, LOG_DIR);
      ensureDir(logsPath);
      console.log(`  Created: ${logsPath}/`);

      // Add /logs/ to .gitignore
      addToGitignore(cwd);

      // Step 7: Create .claude/commands directory and copy templates
      console.log('[7/9] Creating Claude slash commands...');
      const commandsDir = path.join(cwd, '.claude', 'commands');
      ensureDir(commandsDir);
      console.log(`  Created: ${commandsDir}/`);

      // Copy night-watch.md template
      processTemplate(
        'night-watch.md',
        path.join(commandsDir, 'night-watch.md'),
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
      console.log('[8/9] Creating configuration file...');
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
        console.log(`  Created: ${configPath}`);
      }

      // Step 9: Print summary
      console.log('[9/9] Initialization complete!\n');
      console.log('='.repeat(60));
      console.log('Night Watch has been initialized!\n');
      console.log('Created files and directories:');
      console.log(`  - ${prdDir}/done/`);
      console.log(`  - ${prdDir}/NIGHT-WATCH-SUMMARY.md`);
      console.log(`  - ${LOG_DIR}/`);
      console.log(`  - .claude/commands/night-watch.md`);
      console.log(`  - .claude/commands/night-watch-pr-reviewer.md`);
      console.log(`  - ${CONFIG_FILE_NAME}`);
      console.log('\nConfiguration:');
      console.log(`  Provider:  ${selectedProvider}`);
      console.log(`  Reviewer:  ${reviewerEnabled ? 'Enabled' : 'Disabled'}`);
      console.log('\nNext steps:');
      console.log('  1. Add your PRD files to docs/PRDs/night-watch/');
      console.log('  2. Run `night-watch install` to set up cron jobs');
      console.log('  3. Or run `night-watch run` to execute PRDs manually');
      console.log('='.repeat(60));
      console.log('');
    });
}

export default initCommand;
