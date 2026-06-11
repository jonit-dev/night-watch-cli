#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as readline from 'readline';
import {
  BUILT_IN_PRESETS,
  BUILT_IN_PRESET_IDS,
  CONFIG_FILE_NAME,
  DEFAULT_PRD_DIR,
  INightWatchConfig,
  IProviderPreset,
  LOG_DIR,
  Provider,
  checkGhCli,
  checkGitRepo,
  checkNodeVersion,
  checkProviderCli,
  createBoardProvider,
  createTable,
  detectProviders,
  getDefaultConfig,
  getProjectName,
  header,
  info,
  label,
  loadConfig,
  step,
  success,
  error as uiError,
  warn,
} from '@night-watch/core';
import { fireTelemetryEvent } from './shared/telemetry.js';

// Get templates directory path.
// Walk up from __dirname to find the package root (the directory that contains
// a package.json AND a templates/ folder).  This works whether the code runs
// from the TypeScript source tree (src/commands/), the compiled dist tree
// (dist/commands/), or as a single esbuild bundle (dist/).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function findTemplatesDir(startDir: string): string {
  let d = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(d, 'templates');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    d = dirname(d);
  }
  return join(startDir, 'templates'); // fallback
}
const TEMPLATES_DIR = findTemplatesDir(__dirname);

interface IInitOptions {
  force: boolean;
  prdDir?: string;
  provider?: string;
  reviewer?: boolean;
  yes?: boolean;
  customProviderCommand?: string;
  customProviderName?: string;
  customProviderId?: string;
}

interface ISkillsInstallResult {
  location: string;
  installed: number;
  skipped: number;
  type: 'claude' | 'codex' | 'none';
}

const NW_SKILLS = [
  'nw-create-prd',
  'nw-add-issue',
  'nw-run',
  'nw-slice',
  'nw-board-sync',
  'nw-review',
] as const;

interface IGeneratedInitConfig extends Omit<INightWatchConfig, '_cliProviderOverride'> {
  $schema: string;
  projectName: string;
  providerLabel: string;
}

interface IGitHubRemoteStatus {
  hasGitHubRemote: boolean;
  remoteUrl: string | null;
}

interface IProviderSelectionResult {
  provider: Provider;
  providerPreset?: IProviderPreset;
  detectedProviders: Provider[];
  detectedCommands: string[];
  summary: string;
}

export interface IProviderChoice {
  label: string;
  provider?: Provider;
  custom: boolean;
}

interface IInitProjectReview {
  cwd: string;
  projectName: string;
  defaultBranch: string;
  prdDir: string;
  configExists: boolean;
  force: boolean;
  providerSummary: string;
  remoteStatus: IGitHubRemoteStatus;
  playwrightStatus: string;
}

const INIT_PROVIDER_PRECEDENCE = [
  'codex',
  'claude',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'glm-47',
  'glm-5',
] as const;

const SUPPORTED_PROVIDER_INSTALL_GUIDANCE = [
  '  - Codex CLI: https://github.com/openai/codex',
  '  - Claude CLI: https://docs.anthropic.com/en/docs/claude-cli',
] as const;

function hasPlaywrightDependency(cwd: string): boolean {
  const packageJsonPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    return Boolean(
      packageJson.dependencies?.['@playwright/test'] ||
      packageJson.dependencies?.playwright ||
      packageJson.devDependencies?.['@playwright/test'] ||
      packageJson.devDependencies?.playwright,
    );
  } catch {
    return false;
  }
}

function detectPlaywright(cwd: string): boolean {
  if (hasPlaywrightDependency(cwd)) {
    return true;
  }

  if (fs.existsSync(path.join(cwd, 'node_modules', '.bin', 'playwright'))) {
    return true;
  }

  try {
    execSync('playwright --version', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 1500,
    });
    return true;
  } catch {
    return false;
  }
}

function resolvePlaywrightInstallCommand(cwd: string): string {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm add -D @playwright/test';
  }
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    return 'yarn add -D @playwright/test';
  }
  return 'npm install -D @playwright/test';
}

function promptYesNo(question: string, defaultNo: boolean = true): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const suffix = defaultNo ? ' [y/N]: ' : ' [Y/n]: ';
    rl.question(`${question}${suffix}`, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (normalized === '') {
        resolve(!defaultNo);
        return;
      }
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

function promptText(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve('');
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${question}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function isInteractiveInitSession(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function chooseProviderForNonInteractive(providers: Provider[]): Provider {
  return chooseProviderByPrecedence(providers);
}

export function chooseProviderByPrecedence(providers: Provider[]): Provider {
  const providerSet = new Set(providers);
  for (const provider of INIT_PROVIDER_PRECEDENCE) {
    if (providerSet.has(provider)) {
      return provider;
    }
  }
  return providers[0];
}

function getPresetCommand(provider: Provider): string {
  return BUILT_IN_PRESETS[provider]?.command ?? provider;
}

export function getDetectedProviderPresets(detectedCommands: Provider[]): Provider[] {
  const detectedCommandSet = new Set(detectedCommands);
  return INIT_PROVIDER_PRECEDENCE.filter((presetId) =>
    detectedCommandSet.has(getPresetCommand(presetId)),
  );
}

function formatProviderName(provider: Provider): string {
  return BUILT_IN_PRESETS[provider]?.name ?? provider;
}

export function buildProviderSummary(provider: Provider, detectedProviders: Provider[]): string {
  const otherDetected = detectedProviders.filter((detected) => detected !== provider);
  const providerName = formatProviderName(provider);

  if (otherDetected.length === 0) {
    return `Auto-selected ${providerName}.`;
  }

  const otherNames = otherDetected.map(formatProviderName).join(', ');
  return `Auto-selected ${providerName}. Also available: ${otherNames}. Use --provider to override.`;
}

export function shouldPromptProviderOverride(
  interactive: boolean,
  detectedProviders: Provider[],
): boolean {
  return interactive && detectedProviders.length > 1;
}

export function buildProviderChoices(
  detectedProviders: Provider[],
  includeCustomProvider: boolean = true,
): IProviderChoice[] {
  const choices: IProviderChoice[] = detectedProviders.map((provider) => ({
    label: formatProviderName(provider),
    provider,
    custom: false,
  }));

  if (includeCustomProvider) {
    choices.push({
      label: 'Custom provider command',
      custom: true,
    });
  }

  return choices;
}

export function selectProviderOverrideByIndex(
  choices: IProviderChoice[],
  input: string,
): IProviderChoice | null {
  const selectedIndex = Number.parseInt(input.trim(), 10);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > choices.length) {
    return null;
  }

  return choices[selectedIndex - 1] ?? null;
}

function createCustomProviderSelection(params: {
  command?: string;
  name?: string;
  id?: string;
}): IProviderSelectionResult | null {
  if (!params.command) {
    return null;
  }

  const provider = params.id?.trim() || 'custom';
  const providerPreset: IProviderPreset = {
    name: params.name?.trim() || 'Custom Provider',
    command: params.command.trim(),
  };

  return {
    provider,
    providerPreset,
    detectedProviders: [],
    detectedCommands: [],
    summary: `Using custom provider "${providerPreset.name}" (${providerPreset.command}).`,
  };
}

function createCustomProviderPreset(options: IInitOptions): IProviderSelectionResult | null {
  return createCustomProviderSelection({
    command: options.customProviderCommand,
    name: options.customProviderName,
    id: options.customProviderId,
  });
}

function printProviderInstallGuidance(): void {
  console.log('\nPlease install one of the following supported provider CLIs:');
  for (const line of SUPPORTED_PROVIDER_INSTALL_GUIDANCE) {
    console.log(line);
  }
  console.log(
    '\nFor a custom provider, rerun with --custom-provider-command <cmd> and optionally --custom-provider-name <name>.',
  );
}

async function promptCustomProviderSelection(): Promise<IProviderSelectionResult | null> {
  const configureCustom = await promptYesNo(
    'No supported provider CLI was found. Configure a custom provider command now?',
    true,
  );
  if (!configureCustom) {
    return null;
  }

  console.log(
    'The command must be an executable CLI command available to Night Watch, or scheduled jobs will fail.',
  );
  const command = await promptText('Custom provider command');
  if (!command) {
    return null;
  }
  const name = await promptText('Custom provider display name (optional)');
  const id = await promptText('Custom provider id (default: custom)');
  return createCustomProviderSelection({ command, name, id });
}

async function promptProviderOverrideSelection(params: {
  selectedProvider: Provider;
  detectedProviders: Provider[];
  detectedCommands: string[];
}): Promise<IProviderSelectionResult> {
  const { selectedProvider, detectedProviders, detectedCommands } = params;
  const selectedName = formatProviderName(selectedProvider);
  console.log(buildProviderSummary(selectedProvider, detectedProviders));

  const useAutoSelected = await promptYesNo(`Use ${selectedName}?`, false);
  if (useAutoSelected) {
    return {
      provider: selectedProvider,
      detectedProviders,
      detectedCommands,
      summary: `Using auto-selected provider: ${selectedName}.`,
    };
  }

  const choices = buildProviderChoices(detectedProviders);
  console.log('\nDetected provider presets:');
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. ${choice.label}`);
  });

  const choiceInput = await promptText('Choose provider preset number');
  const choice = selectProviderOverrideByIndex(choices, choiceInput);
  if (!choice) {
    warn(`Invalid provider choice. Continuing with auto-selected provider: ${selectedName}.`);
    return {
      provider: selectedProvider,
      detectedProviders,
      detectedCommands,
      summary: `Using auto-selected provider: ${selectedName}.`,
    };
  }

  if (choice.custom) {
    const command = await promptText('Custom provider command');
    if (!command) {
      warn(
        `No custom provider command entered. Continuing with auto-selected provider: ${selectedName}.`,
      );
      return {
        provider: selectedProvider,
        detectedProviders,
        detectedCommands,
        summary: `Using auto-selected provider: ${selectedName}.`,
      };
    }

    const name = await promptText('Custom provider display name (optional)');
    const id = await promptText('Custom provider id (default: custom)');
    const customSelection = createCustomProviderSelection({ command, name, id });
    if (customSelection) {
      return customSelection;
    }
  }

  return {
    provider: choice.provider ?? selectedProvider,
    detectedProviders,
    detectedCommands,
    summary: `Using provider selected during guided init: ${choice.label}.`,
  };
}

async function resolveProviderSelection(
  options: IInitOptions,
  interactive: boolean,
): Promise<IProviderSelectionResult> {
  const customProvider = createCustomProviderPreset(options);
  if (customProvider) {
    return customProvider;
  }

  if (options.provider) {
    if (!BUILT_IN_PRESET_IDS.includes(options.provider)) {
      uiError(`Invalid provider "${options.provider}".`);
      console.log(`Valid providers: ${BUILT_IN_PRESET_IDS.join(', ')}`);
      console.log('For a custom provider, use --custom-provider-command <cmd>.');
      process.exit(1);
    }

    const selectedProvider = options.provider as Provider;
    const command = getPresetCommand(selectedProvider);
    const providerCheck = checkProviderCli(command);
    if (!providerCheck.passed) {
      uiError(providerCheck.message);
      console.log(`Install the ${formatProviderName(selectedProvider)} CLI command: ${command}`);
      printProviderInstallGuidance();
      process.exit(1);
    }

    return {
      provider: selectedProvider,
      detectedProviders: [selectedProvider],
      detectedCommands: [command],
      summary: `Using provider from flag: ${formatProviderName(selectedProvider)}.`,
    };
  }

  const detectedCommands = detectProviders();
  const detectedProviders = getDetectedProviderPresets(detectedCommands);

  if (detectedProviders.length === 0) {
    if (interactive) {
      const customSelection = await promptCustomProviderSelection();
      if (customSelection) {
        return customSelection;
      }
    }

    uiError('No supported AI provider CLI found.');
    printProviderInstallGuidance();
    process.exit(1);
  }

  const selectedProvider = chooseProviderByPrecedence(detectedProviders);
  if (shouldPromptProviderOverride(interactive, detectedProviders)) {
    return promptProviderOverrideSelection({
      selectedProvider,
      detectedProviders,
      detectedCommands,
    });
  }

  return {
    provider: selectedProvider,
    detectedProviders,
    detectedCommands,
    summary: buildProviderSummary(selectedProvider, detectedProviders),
  };
}

function showProjectReview(review: IInitProjectReview): void {
  let configStatus = 'New';
  if (review.configExists) {
    configStatus = review.force ? 'Exists, will overwrite' : 'Exists, will keep';
  }

  header('Project Review');
  label('Path', review.cwd);
  label('Project', review.projectName);
  label('Default branch', review.defaultBranch);
  label('PRD directory', review.prdDir);
  label('Config', configStatus);
  label(
    'GitHub remote',
    review.remoteStatus.hasGitHubRemote
      ? (review.remoteStatus.remoteUrl ?? 'Detected')
      : 'Not detected',
  );
  label('Provider', review.providerSummary);
  label('Playwright', review.playwrightStatus);
  console.log();
}

async function confirmProjectReview(review: IInitProjectReview): Promise<boolean> {
  showProjectReview(review);
  return promptYesNo('Continue with this Night Watch setup?', false);
}

export function getGitHubRemoteStatus(cwd: string): IGitHubRemoteStatus {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    return {
      hasGitHubRemote: remoteUrl.includes('github.com'),
      remoteUrl: remoteUrl || null,
    };
  } catch {
    return {
      hasGitHubRemote: false,
      remoteUrl: null,
    };
  }
}

function installPlaywrightForQa(cwd: string): boolean {
  try {
    const installCmd = resolvePlaywrightInstallCommand(cwd);
    execSync(installCmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    execSync('npx playwright install chromium', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return true;
  } catch {
    return false;
  }
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
        stdio: ['pipe', 'pipe', 'pipe'],
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
      stdio: ['pipe', 'pipe', 'pipe'],
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
 * Create directory if it doesn't exist
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function buildInitConfig(params: {
  projectName: string;
  defaultBranch: string;
  provider: Provider;
  providerPreset?: IProviderPreset;
  reviewerEnabled: boolean;
  prdDir: string;
}): IGeneratedInitConfig {
  const defaults = getDefaultConfig();

  return {
    $schema: 'https://json-schema.org/schema',
    projectName: params.projectName,
    defaultBranch: params.defaultBranch,
    prdDir: params.prdDir,
    maxRuntime: defaults.maxRuntime,
    reviewerMaxRuntime: defaults.reviewerMaxRuntime,
    branchPrefix: defaults.branchPrefix,
    branchPatterns: [...defaults.branchPatterns],
    minReviewScore: defaults.minReviewScore,
    maxLogSize: defaults.maxLogSize,
    cronSchedule: defaults.cronSchedule,
    reviewerSchedule: defaults.reviewerSchedule,
    scheduleBundleId: defaults.scheduleBundleId ?? 'always-on',
    cronScheduleOffset: defaults.cronScheduleOffset,
    schedulingPriority: defaults.schedulingPriority,
    maxRetries: defaults.maxRetries,
    reviewerMaxRetries: defaults.reviewerMaxRetries,
    reviewerMaxPrsPerRun: defaults.reviewerMaxPrsPerRun,
    reviewerRetryDelay: defaults.reviewerRetryDelay,
    provider: params.provider,
    providerLabel: '',
    ...(params.providerPreset
      ? { providerPresets: { [params.provider]: params.providerPreset } }
      : {}),
    modelAttribution: defaults.modelAttribution,
    newPrLabel: defaults.newPrLabel,
    executorEnabled: defaults.executorEnabled ?? true,
    reviewerEnabled: params.reviewerEnabled,
    providerEnv: { ...defaults.providerEnv },
    notifications: {
      ...defaults.notifications,
      webhooks: [...(defaults.notifications?.webhooks ?? [])],
    },
    prdPriority: [...defaults.prdPriority],
    roadmapScanner: { ...defaults.roadmapScanner },
    templatesDir: defaults.templatesDir,
    boardProvider: { ...defaults.boardProvider },
    autoMerge: defaults.autoMerge,
    autoMergeMethod: defaults.autoMergeMethod,
    fallbackOnRateLimit: defaults.fallbackOnRateLimit,
    primaryFallbackModel: null,
    secondaryFallbackModel: null,
    claudeModel: null,
    qa: {
      ...defaults.qa,
      branchPatterns: [...defaults.qa.branchPatterns],
    },
    audit: { ...defaults.audit },
    optimizer: { ...defaults.optimizer },
    ux: {
      ...defaults.ux,
      flows: [...defaults.ux.flows],
    },
    analytics: { ...defaults.analytics },
    manager: { ...defaults.manager },
    feedback: { ...defaults.feedback },
    merger: { ...defaults.merger },
    prResolver: { ...defaults.prResolver },
    jobProviders: { ...defaults.jobProviders },
    queue: {
      ...defaults.queue,
      priority: { ...defaults.queue.priority },
    },
    webhookTriggers: {
      ...defaults.webhookTriggers,
      allowedJobIds: [...defaults.webhookTriggers.allowedJobIds],
      github: {
        ...defaults.webhookTriggers.github,
        events: [...defaults.webhookTriggers.github.events],
        rules: defaults.webhookTriggers.github.rules.map((rule) => ({
          ...rule,
          branchPatterns: rule.branchPatterns ? [...rule.branchPatterns] : undefined,
        })),
      },
    },
  };
}

/**
 * Result of template path resolution
 */
interface ITemplateResolution {
  path: string;
  source: 'custom' | 'bundled';
}

/**
 * Resolve a template path with per-file fallback.
 * If customTemplatesDir is non-null and the file exists there, return custom path.
 * Otherwise return the bundled template path.
 */
export function resolveTemplatePath(
  templateName: string,
  customTemplatesDir: string | null,
  bundledTemplatesDir: string,
): ITemplateResolution {
  if (customTemplatesDir !== null) {
    const customPath = join(customTemplatesDir, templateName);
    if (fs.existsSync(customPath)) {
      return { path: customPath, source: 'custom' };
    }
  }
  return { path: join(bundledTemplatesDir, templateName), source: 'bundled' };
}

/**
 * Copy and process template file
 */
function processTemplate(
  templateName: string,
  targetPath: string,
  replacements: Record<string, string>,
  force: boolean,
  sourcePath?: string,
  source?: 'custom' | 'bundled',
): { created: boolean; source: 'custom' | 'bundled' } {
  // Skip if exists and not forcing
  if (fs.existsSync(targetPath) && !force) {
    console.log(`  Skipped (exists): ${targetPath}`);
    return { created: false, source: source ?? 'bundled' };
  }

  const templatePath = sourcePath ?? join(TEMPLATES_DIR, templateName);
  const resolvedSource = source ?? 'bundled';
  let content = fs.readFileSync(templatePath, 'utf-8');

  // Replace placeholders
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(key, value);
  }

  fs.writeFileSync(targetPath, content);
  console.log(`  Created: ${targetPath} (${resolvedSource})`);
  return { created: true, source: resolvedSource };
}

/**
 * Ensure Night Watch entries are in .gitignore
 */
function addToGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');

  const entries = [
    {
      pattern: '/logs/',
      label: '/logs/',
      check: (c: string) => c.includes('/logs/') || /^logs\//m.test(c),
    },
    {
      pattern: CONFIG_FILE_NAME,
      label: CONFIG_FILE_NAME,
      check: (c: string) => c.includes(CONFIG_FILE_NAME),
    },
    { pattern: '*.claim', label: '*.claim', check: (c: string) => c.includes('*.claim') },
  ];

  if (!fs.existsSync(gitignorePath)) {
    const lines = ['# Night Watch', ...entries.map((e) => e.pattern), ''];
    fs.writeFileSync(gitignorePath, lines.join('\n'));
    console.log(`  Created: ${gitignorePath} (with Night Watch entries)`);
    return;
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const missing = entries.filter((e) => !e.check(content));

  if (missing.length === 0) {
    console.log(`  Skipped (exists): Night Watch entries in .gitignore`);
    return;
  }

  const additions = missing.map((e) => e.pattern).join('\n');
  const newContent = content.trimEnd() + '\n\n# Night Watch\n' + additions + '\n';
  fs.writeFileSync(gitignorePath, newContent);
  console.log(`  Updated: ${gitignorePath} (added ${missing.map((e) => e.label).join(', ')})`);
}

function installSkills(
  cwd: string,
  provider: Provider,
  force: boolean,
  templatesDir: string,
): ISkillsInstallResult {
  const skillsTemplatesDir = path.join(templatesDir, 'skills');
  if (!fs.existsSync(skillsTemplatesDir)) {
    return { location: '', installed: 0, skipped: 0, type: 'none' };
  }

  const isClaudeProvider = provider === 'claude' || provider.startsWith('claude');
  const isCodexProvider = provider === 'codex';
  const claudeDir = path.join(cwd, '.claude');

  if (isClaudeProvider || fs.existsSync(claudeDir)) {
    ensureDir(claudeDir);
    const skillsDir = path.join(claudeDir, 'skills');
    ensureDir(skillsDir);

    let installed = 0;
    let skipped = 0;

    for (const skillName of NW_SKILLS) {
      const templateFile = path.join(skillsTemplatesDir, `${skillName}.md`);
      if (!fs.existsSync(templateFile)) continue;

      const skillDir = path.join(skillsDir, skillName);
      ensureDir(skillDir);
      const target = path.join(skillDir, 'SKILL.md');

      if (fs.existsSync(target) && !force) {
        skipped++;
        continue;
      }

      fs.copyFileSync(templateFile, target);
      installed++;
    }

    return { location: '.claude/skills/', installed, skipped, type: 'claude' };
  }

  if (isCodexProvider) {
    const agentsFile = path.join(cwd, 'AGENTS.md');
    const blockFile = path.join(skillsTemplatesDir, '_codex-block.md');
    if (!fs.existsSync(blockFile)) {
      return { location: '', installed: 0, skipped: 0, type: 'none' };
    }

    const block = fs.readFileSync(blockFile, 'utf-8');
    const marker = '## Night Watch Skills';

    if (!fs.existsSync(agentsFile)) {
      fs.writeFileSync(agentsFile, block);
      return { location: 'AGENTS.md', installed: NW_SKILLS.length, skipped: 0, type: 'codex' };
    }

    const existing = fs.readFileSync(agentsFile, 'utf-8');
    if (existing.includes(marker)) {
      if (!force) {
        return { location: 'AGENTS.md', installed: 0, skipped: NW_SKILLS.length, type: 'codex' };
      }
      const withoutSection = existing.replace(/\n\n## Night Watch Skills[\s\S]*$/, '');
      fs.writeFileSync(agentsFile, withoutSection + '\n\n' + block);
    } else {
      fs.appendFileSync(agentsFile, '\n\n' + block);
    }

    return { location: 'AGENTS.md', installed: NW_SKILLS.length, skipped: 0, type: 'codex' };
  }

  return { location: '', installed: 0, skipped: 0, type: 'none' };
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
    .option(
      '-p, --provider <name>',
      `AI provider preset to use (${BUILT_IN_PRESET_IDS.join(', ')})`,
    )
    .option('-y, --yes', 'Accept guided init defaults without prompting')
    .option('--custom-provider-command <cmd>', 'Custom AI provider command to write into config')
    .option('--custom-provider-name <name>', 'Display name for a custom AI provider')
    .option('--custom-provider-id <id>', 'Config id for a custom AI provider')
    .option('--no-reviewer', 'Disable reviewer cron job')
    .action(async (options: IInitOptions) => {
      const cwd = process.cwd();
      const force = options.force || false;
      const prdDir = options.prdDir || DEFAULT_PRD_DIR;
      const totalSteps = 14;
      const interactive = isInteractiveInitSession();

      console.log();
      header('Night Watch CLI - Initializing');

      // Step 1: Verify Node.js version
      step(1, totalSteps, 'Checking Node.js version...');
      const nodeCheck = checkNodeVersion(22);
      if (!nodeCheck.passed) {
        uiError(nodeCheck.message);
        process.exit(1);
      }
      success(nodeCheck.message);

      // Step 2: Verify git repository
      step(2, totalSteps, 'Checking git repository...');
      const gitCheck = checkGitRepo(cwd);
      if (!gitCheck.passed) {
        uiError(gitCheck.message);
        console.log('Please run this command from the root of a git repository.');
        process.exit(1);
      }
      success(gitCheck.message);

      // Step 3: Detect AI providers
      step(3, totalSteps, 'Detecting AI providers...');
      const providerSelection = await resolveProviderSelection(
        options,
        interactive && !options.yes,
      );
      const selectedProvider = providerSelection.provider;
      info(providerSelection.summary);

      // Step 4: Check optional GitHub integration prerequisites
      step(4, totalSteps, 'Checking GitHub integration prerequisites...');
      const remoteStatus = getGitHubRemoteStatus(cwd);
      const ghCheck = checkGhCli();
      const ghAuthenticated = ghCheck.passed;

      if (!remoteStatus.hasGitHubRemote) {
        info('No GitHub remote detected. Board setup will be skipped for now.');
      } else if (!ghAuthenticated) {
        warn(`${ghCheck.message}. Board setup will be skipped during init.`);
      } else {
        success(ghCheck.message);
      }

      // Step 5: Detect test frameworks for QA bootstrap
      step(5, totalSteps, 'Detecting test frameworks...');
      const playwrightDetected = detectPlaywright(cwd);
      let playwrightStatus = playwrightDetected ? 'detected' : 'not installed';
      if (playwrightDetected) {
        info('Playwright: detected');
      } else {
        info('Playwright: not found');
        const installPlaywright = options.yes
          ? false
          : await promptYesNo('Install Playwright for QA now?', true);
        if (installPlaywright) {
          if (installPlaywrightForQa(cwd)) {
            playwrightStatus = 'installed during init';
            success('Installed Playwright test runner and Chromium browser.');
          } else {
            playwrightStatus = 'install failed';
            console.warn(
              '  Warning: Failed to install Playwright automatically. You can install it later.',
            );
          }
        } else {
          info('Skipping Playwright install. QA can auto-install during execution if enabled.');
        }
      }

      // Set reviewerEnabled from flag (default: true, --no-reviewer sets to false)
      const reviewerEnabled = options.reviewer !== false;

      // Gather project information
      const projectName = getProjectName(cwd);
      const defaultBranch = getDefaultBranch(cwd);
      const configPath = path.join(cwd, CONFIG_FILE_NAME);

      if (interactive && !options.yes) {
        const confirmed = await confirmProjectReview({
          cwd,
          projectName,
          defaultBranch,
          prdDir,
          configExists: fs.existsSync(configPath),
          force,
          providerSummary: providerSelection.summary,
          remoteStatus,
          playwrightStatus,
        });

        if (!confirmed) {
          info('Init cancelled. No project files were written.');
          return;
        }
      }

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

      // Step 6: Create PRD directory structure
      step(6, totalSteps, 'Creating PRD directory structure...');
      const prdDirPath = path.join(cwd, prdDir);
      const doneDirPath = path.join(prdDirPath, 'done');
      ensureDir(doneDirPath);
      success(`Created ${prdDirPath}/`);
      success(`Created ${doneDirPath}/`);

      // Step 7: Create logs directory
      step(7, totalSteps, 'Creating logs directory...');
      const logsPath = path.join(cwd, LOG_DIR);
      ensureDir(logsPath);
      success(`Created ${logsPath}/`);

      // Add /logs/ to .gitignore
      addToGitignore(cwd);

      // Step 8: Create instructions directory and copy templates
      step(8, totalSteps, 'Creating instructions directory...');
      const instructionsDir = path.join(cwd, 'instructions');
      ensureDir(instructionsDir);
      success(`Created ${instructionsDir}/`);

      // Load existing config (if present) to get templatesDir
      const existingConfig = loadConfig(cwd);
      const customTemplatesDirPath = path.join(cwd, existingConfig.templatesDir);
      const customTemplatesDir = fs.existsSync(customTemplatesDirPath)
        ? customTemplatesDirPath
        : null;

      // Track template sources for summary
      const templateSources: { name: string; source: 'custom' | 'bundled' }[] = [];

      // Copy executor.md template
      const nwResolution = resolveTemplatePath('executor.md', customTemplatesDir, TEMPLATES_DIR);
      const nwResult = processTemplate(
        'executor.md',
        path.join(instructionsDir, 'executor.md'),
        replacements,
        force,
        nwResolution.path,
        nwResolution.source,
      );
      templateSources.push({ name: 'executor.md', source: nwResult.source });

      // Copy prd-executor.md template
      const peResolution = resolveTemplatePath(
        'prd-executor.md',
        customTemplatesDir,
        TEMPLATES_DIR,
      );
      const peResult = processTemplate(
        'prd-executor.md',
        path.join(instructionsDir, 'prd-executor.md'),
        replacements,
        force,
        peResolution.path,
        peResolution.source,
      );
      templateSources.push({ name: 'prd-executor.md', source: peResult.source });

      // Copy pr-reviewer.md template
      const prResolution = resolveTemplatePath('pr-reviewer.md', customTemplatesDir, TEMPLATES_DIR);
      const prResult = processTemplate(
        'pr-reviewer.md',
        path.join(instructionsDir, 'pr-reviewer.md'),
        replacements,
        force,
        prResolution.path,
        prResolution.source,
      );
      templateSources.push({ name: 'pr-reviewer.md', source: prResult.source });

      // Copy qa.md template
      const qaResolution = resolveTemplatePath('qa.md', customTemplatesDir, TEMPLATES_DIR);
      const qaResult = processTemplate(
        'qa.md',
        path.join(instructionsDir, 'qa.md'),
        replacements,
        force,
        qaResolution.path,
        qaResolution.source,
      );
      templateSources.push({ name: 'qa.md', source: qaResult.source });

      // Copy audit.md template
      const auditResolution = resolveTemplatePath('audit.md', customTemplatesDir, TEMPLATES_DIR);
      const auditResult = processTemplate(
        'audit.md',
        path.join(instructionsDir, 'audit.md'),
        replacements,
        force,
        auditResolution.path,
        auditResolution.source,
      );
      templateSources.push({ name: 'audit.md', source: auditResult.source });

      // Copy prd-creator.md template
      const plannerResolution = resolveTemplatePath(
        'prd-creator.md',
        customTemplatesDir,
        TEMPLATES_DIR,
      );
      const plannerResult = processTemplate(
        'prd-creator.md',
        path.join(instructionsDir, 'prd-creator.md'),
        replacements,
        force,
        plannerResolution.path,
        plannerResolution.source,
      );
      templateSources.push({ name: 'prd-creator.md', source: plannerResult.source });

      // Step 9: Create config file
      step(9, totalSteps, 'Creating configuration file...');

      if (fs.existsSync(configPath) && !force) {
        console.log(`  Skipped (exists): ${configPath}`);
      } else {
        const config = buildInitConfig({
          projectName,
          defaultBranch,
          provider: selectedProvider,
          providerPreset: providerSelection.providerPreset,
          reviewerEnabled,
          prdDir,
        });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
        success(`Created ${configPath}`);
      }

      // Step 10: Create GitHub Project board (only when repo has a GitHub remote)
      step(10, totalSteps, 'Setting up GitHub Project board...');
      const existingRaw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<
        string,
        unknown
      >;
      const existingBoard = existingRaw.boardProvider as { projectNumber?: number } | undefined;
      let boardSetupStatus = 'Skipped';
      if (existingBoard?.projectNumber && !force) {
        boardSetupStatus = `Already configured (#${existingBoard.projectNumber})`;
        info(`Board already configured (#${existingBoard.projectNumber}), skipping.`);
      } else {
        if (!remoteStatus.hasGitHubRemote) {
          boardSetupStatus = 'Skipped (no GitHub remote)';
          info(
            'No GitHub remote detected — skipping board setup. Run `night-watch board setup` manually.',
          );
        } else if (!ghAuthenticated) {
          boardSetupStatus = 'Skipped (gh auth required)';
          info(
            'GitHub CLI is not authenticated — run `gh auth login`, then `night-watch board setup`.',
          );
        } else {
          try {
            const provider = createBoardProvider({ enabled: true, provider: 'github' }, cwd);
            const boardTitle = `${projectName} Night Watch`;
            const board = await provider.setupBoard(boardTitle);
            // Update the config file with the projectNumber
            const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<
              string,
              unknown
            >;
            rawConfig.boardProvider = {
              enabled: true,
              provider: 'github',
              projectNumber: board.number,
              projectTitle: board.title,
            };
            fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + '\n');
            boardSetupStatus = `Created (#${board.number})`;
            success(`GitHub Project board "${boardTitle}" ready (#${board.number})`);
          } catch (boardErr) {
            boardSetupStatus = 'Failed (manual setup required)';
            console.warn(
              `  Warning: Could not set up GitHub Project board: ${boardErr instanceof Error ? boardErr.message : String(boardErr)}`,
            );
            info('Run `night-watch board setup` to create the board manually.');
          }
        }
      }

      // Step 11: Sync Night Watch labels to GitHub
      step(11, totalSteps, 'Syncing Night Watch labels to GitHub...');
      let labelSyncStatus = 'Skipped';
      if (!remoteStatus.hasGitHubRemote || !ghAuthenticated) {
        labelSyncStatus = !remoteStatus.hasGitHubRemote
          ? 'Skipped (no GitHub remote)'
          : 'Skipped (gh auth required)';
        info('Skipping label sync (no GitHub remote or gh not authenticated).');
      } else {
        try {
          const { NIGHT_WATCH_LABELS } = await import('@night-watch/core');
          let created = 0;
          for (const label of NIGHT_WATCH_LABELS) {
            try {
              execSync(
                `gh label create "${label.name}" --description "${label.description}" --color "${label.color}" --force`,
                { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
              );
              created++;
            } catch {
              // Label creation is best-effort
            }
          }
          labelSyncStatus = `Synced ${created}/${NIGHT_WATCH_LABELS.length} labels`;
          success(`Synced ${created}/${NIGHT_WATCH_LABELS.length} labels to GitHub`);
        } catch (labelErr) {
          labelSyncStatus = 'Failed';
          warn(
            `Could not sync labels: ${labelErr instanceof Error ? labelErr.message : String(labelErr)}`,
          );
        }
      }

      // Step 12: Register in global registry
      step(12, totalSteps, 'Registering project in global registry...');
      try {
        const { registerProject } = await import('@night-watch/core');
        const entry = registerProject(cwd);
        success(`Registered as "${entry.name}" in global registry`);
      } catch (regErr) {
        console.warn(
          `  Warning: Could not register in global registry: ${regErr instanceof Error ? regErr.message : String(regErr)}`,
        );
      }

      // Step 13: Install AI skills
      step(13, totalSteps, 'Installing Night Watch skills...');
      const skillsResult = installSkills(cwd, selectedProvider, force, TEMPLATES_DIR);
      if (skillsResult.installed > 0) {
        success(`Installed ${skillsResult.installed} skills to ${skillsResult.location}`);
        for (const skillName of NW_SKILLS) {
          console.log(`  /${skillName}`);
        }
      } else if (skillsResult.skipped > 0) {
        info(`Skills already installed (use --force to overwrite)`);
      } else if (skillsResult.type === 'none') {
        info('No compatible AI skills directory detected — skipping.');
      }

      // Print summary
      step(14, totalSteps, 'Initialization complete!');

      // Summary with table
      header('Initialization Complete');
      const filesTable = createTable({ head: ['Created Files', ''] });
      filesTable.push(['PRD Directory', `${prdDir}/done/`]);
      filesTable.push(['Logs Directory', `${LOG_DIR}/`]);
      filesTable.push(['Instructions', `instructions/executor.md (${templateSources[0].source})`]);
      filesTable.push(['', `instructions/prd-executor.md (${templateSources[1].source})`]);
      filesTable.push(['', `instructions/pr-reviewer.md (${templateSources[2].source})`]);
      filesTable.push(['', `instructions/qa.md (${templateSources[3].source})`]);
      filesTable.push(['', `instructions/audit.md (${templateSources[4].source})`]);
      filesTable.push(['', `instructions/prd-creator.md (${templateSources[5].source})`]);
      filesTable.push(['Config File', CONFIG_FILE_NAME]);
      filesTable.push(['Board Setup', boardSetupStatus]);
      filesTable.push(['Label Sync', labelSyncStatus]);
      filesTable.push(['Global Registry', '~/.night-watch/projects.json']);
      let skillsSummary: string;
      if (skillsResult.installed > 0) {
        skillsSummary = `${skillsResult.installed} skills → ${skillsResult.location}`;
      } else if (skillsResult.skipped > 0) {
        skillsSummary = `Already installed (${skillsResult.location})`;
      } else {
        skillsSummary = 'Skipped';
      }
      filesTable.push(['Skills', skillsSummary]);
      console.log(filesTable.toString());

      // Configuration summary
      header('Configuration');
      label('Provider', selectedProvider);
      label('Reviewer', reviewerEnabled ? 'Enabled' : 'Disabled');
      label('Playwright', playwrightStatus);
      console.log();

      fireTelemetryEvent('cli_init_completed', {
        command: 'init',
        provider: selectedProvider,
        boardMode:
          (existingRaw.boardProvider as { enabled?: boolean } | undefined)?.enabled !== false,
        success: true,
      });

      // Next steps
      header('Next Steps');
      info(`1. Add your PRD files to ${prdDir}/`);
      info('2. Run `night-watch install` to set up cron jobs');
      info('3. Run `night-watch doctor` to verify the full setup');
      info('4. Or run `night-watch run` to execute PRDs manually');
      if (skillsResult.installed > 0) {
        info(`5. Use /nw-create-prd, /nw-run, /nw-add-issue and more in your AI assistant`);
      }
      console.log();
    });
}

export default initCommand;
