#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cronstrue from 'cronstrue';
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import {
  BUILT_IN_PRESETS,
  BUILT_IN_PRESET_IDS,
  CONFIG_FILE_NAME,
  DEFAULT_PRD_DIR,
  INightWatchConfig,
  IProviderPreset,
  IWebhookConfig,
  JobType,
  LOG_DIR,
  NotificationEvent,
  Provider,
  checkGhCli,
  checkGitRepo,
  checkNodeVersion,
  checkProviderCli,
  createBoardProvider,
  createTable,
  detectProviders,
  getDefaultConfig,
  getJobDef,
  getProjectName,
  header,
  info,
  label,
  loadConfig,
  step,
  success,
  error as uiError,
  validateWebhook,
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
  jobs?: string;
  noJobs?: string;
  schedule?: string[];
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

type InitJobId =
  | 'executor'
  | 'reviewer'
  | 'qa'
  | 'audit'
  | 'analytics'
  | 'slicer'
  | 'pr-resolver'
  | 'manager'
  | 'merger';

type InitJobBundle = 'recommended' | 'minimal' | 'custom';

interface IInitJobCatalogItem {
  id: InitJobId;
  label: string;
  description: string;
  warning?: string;
  defaultSchedule: string;
}

export interface IJobSelectionAnswer {
  bundle: InitJobBundle;
  enabledJobs: InitJobId[];
  schedules: Record<InitJobId, string>;
}

export interface IProviderSelectionAnswer {
  provider: Provider;
  providerPreset?: IProviderPreset;
  summary: string;
}

export interface INotificationSelectionAnswer {
  webhooks: IWebhookConfig[];
  skipped: boolean;
}

export interface IInitOnboardingAnswers {
  jobs: IJobSelectionAnswer;
  provider: IProviderSelectionAnswer;
  notifications: INotificationSelectionAnswer;
}

export interface IProviderChoice {
  label: string;
  provider?: Provider;
  custom: boolean;
}

type InitCustomizationArea = 'notifications' | 'jobs' | 'provider' | 'playwright' | 'done';

export function getInitCustomizationChoices(params: {
  playwrightDetected: boolean;
}): { value: InitCustomizationArea; label: string; description: string }[] {
  const choices: { value: InitCustomizationArea; label: string; description: string }[] = [
    {
      value: 'notifications',
      label: 'Notifications',
      description: 'Telegram, Slack, or Discord webhook.',
    },
    {
      value: 'jobs',
      label: 'Scheduled jobs',
      description: 'Change enabled jobs or schedules.',
    },
    {
      value: 'provider',
      label: 'AI provider',
      description: 'Choose another detected provider or custom command.',
    },
  ];

  if (!params.playwrightDetected) {
    choices.push({
      value: 'playwright',
      label: 'Install Playwright now',
      description: 'Optional; QA can auto-install later.',
    });
  }

  choices.push({
    value: 'done',
    label: 'Nothing else',
    description: 'Return to the final setup review.',
  });

  return choices;
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

const INIT_JOB_IDS: InitJobId[] = [
  'executor',
  'reviewer',
  'qa',
  'audit',
  'analytics',
  'slicer',
  'pr-resolver',
  'manager',
  'merger',
];

const RECOMMENDED_INIT_JOBS: InitJobId[] = ['executor', 'reviewer', 'qa'];

const MINIMAL_INIT_JOBS: InitJobId[] = ['executor'];

const JOB_ALIASES: Record<string, InitJobId> = {
  executor: 'executor',
  run: 'executor',
  reviewer: 'reviewer',
  review: 'reviewer',
  qa: 'qa',
  audit: 'audit',
  analytics: 'analytics',
  slicer: 'slicer',
  planner: 'slicer',
  roadmap: 'slicer',
  'roadmap-scanner': 'slicer',
  'pr-resolver': 'pr-resolver',
  resolver: 'pr-resolver',
  resolve: 'pr-resolver',
  manager: 'manager',
  merger: 'merger',
  merge: 'merger',
  'auto-merge': 'merger',
};

const JOB_WARNINGS: Partial<Record<InitJobId, string>> = {
  executor: 'Creates branches and PRs from PRDs.',
  reviewer: 'May push fix commits to Night Watch PR branches.',
  audit: 'Can create board issues when issue creation is enabled.',
  analytics: 'Needs analytics credentials before it can run successfully.',
  slicer: 'Can create draft board issues/PRDs from roadmap items.',
  'pr-resolver': 'Can update PR branches and resolve merge conflicts.',
  manager: 'Can create draft board issues or PRDs for project gaps.',
  merger: 'Can merge eligible PRs and delete/update branches through the merge path.',
};

const DEFAULT_NOTIFICATION_EVENTS: NotificationEvent[] = [
  'run_failed',
  'review_ready_for_human',
  'qa_completed',
  'merge_failed',
  'manager_blocked',
];

const DISCORD_INVITE_URL = 'https://discord.gg/maCPEJzPXa';

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

async function promptYesNo(question: string, defaultNo: boolean = true): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(false);
  }

  return confirm({
    message: question,
    default: !defaultNo,
  });
}

async function promptText(question: string, defaultValue?: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(defaultValue ?? '');
  }

  const answer = await input({
    message: question,
    default: defaultValue,
  });
  return answer.trim();
}

async function promptChoice<T extends string>(
  question: string,
  choices: { value: T; label: string }[],
  defaultValue: T,
): Promise<T> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return defaultValue;
  }

  return select({
    message: question,
    choices: choices.map((choice) => ({
      name: choice.label,
      value: choice.value,
    })),
    default: defaultValue,
  });
}

async function promptCustomizationArea(params: {
  playwrightDetected: boolean;
}): Promise<InitCustomizationArea> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return 'done';
  }

  return select({
    message: 'What do you want to customize?',
    choices: getInitCustomizationChoices(params).map((choice) => ({
      name: choice.label,
      value: choice.value,
      description: choice.description,
    })),
    default: 'notifications',
  });
}

async function promptEnabledJobIds(defaultEnabled: InitJobId[]): Promise<InitJobId[]> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return [...defaultEnabled];
  }

  return checkbox({
    message: 'Enabled scheduled jobs',
    choices: getInitJobCatalog().map((job) => ({
      name: job.label,
      value: job.id,
      checked: defaultEnabled.includes(job.id),
      description: `${job.description}${job.warning ? ` ${job.warning}` : ''}`,
    })),
    required: true,
  });
}

export function isInteractiveInitSession(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function scheduleForJob(defaults: INightWatchConfig, jobId: InitJobId): string {
  switch (jobId) {
    case 'executor':
      return defaults.cronSchedule;
    case 'reviewer':
      return defaults.reviewerSchedule;
    case 'slicer':
      return defaults.roadmapScanner.slicerSchedule;
    case 'pr-resolver':
      return defaults.prResolver.schedule;
    default:
      return defaults[jobId].schedule;
  }
}

function jobEnabledByDefault(defaults: INightWatchConfig, jobId: InitJobId): boolean {
  switch (jobId) {
    case 'executor':
      return defaults.executorEnabled !== false;
    case 'reviewer':
      return defaults.reviewerEnabled;
    case 'slicer':
      return defaults.roadmapScanner.enabled;
    case 'pr-resolver':
      return defaults.prResolver.enabled;
    default:
      return defaults[jobId].enabled;
  }
}

export function getInitJobCatalog(): IInitJobCatalogItem[] {
  const defaults = getDefaultConfig();
  return INIT_JOB_IDS.map((id) => {
    const registryId: JobType = id === 'slicer' ? 'slicer' : id;
    const def = getJobDef(registryId);
    return {
      id,
      label: def?.name ?? id,
      description: def?.description ?? id,
      warning: JOB_WARNINGS[id],
      defaultSchedule: scheduleForJob(defaults, id),
    };
  });
}

function parseJobId(value: string): InitJobId | null {
  return JOB_ALIASES[value.trim().toLowerCase()] ?? null;
}

function parseJobCsv(csv: string | undefined): InitJobId[] {
  if (!csv) {
    return [];
  }

  const jobs: InitJobId[] = [];
  for (const rawJob of csv.split(',')) {
    const job = parseJobId(rawJob);
    if (!job) {
      throw new Error(
        `Unknown init job "${rawJob.trim()}". Valid jobs: ${INIT_JOB_IDS.join(', ')}`,
      );
    }
    if (!jobs.includes(job)) {
      jobs.push(job);
    }
  }
  return jobs;
}

function normalizeScheduleOptions(scheduleOptions: string[] | string | undefined): string[] {
  if (scheduleOptions === undefined) {
    return [];
  }
  return Array.isArray(scheduleOptions) ? scheduleOptions : [scheduleOptions];
}

function isValidCronSchedule(schedule: string): boolean {
  return schedule.trim().split(/\s+/).length === 5;
}

export function describeCronSchedule(schedule: string): string {
  const trimmed = schedule.trim();
  if (!isValidCronSchedule(trimmed)) {
    return trimmed;
  }

  try {
    return cronstrue.toString(trimmed, { use24HourTimeFormat: true });
  } catch {
    return trimmed;
  }
}

function formatScheduleWithDescription(schedule: string): string {
  const description = describeCronSchedule(schedule);
  if (description === schedule) {
    return schedule;
  }
  return `${schedule} (${description})`;
}

export function normalizeCronSchedulePromptInput(input: string, defaultSchedule: string): string {
  const normalized = input.trim().toLowerCase();
  if (normalized === '' || normalized === 'y' || normalized === 'yes') {
    return defaultSchedule;
  }
  return input.trim();
}

function printCronScheduleHelp(): void {
  console.log('For schedules, press Enter to accept the default.');
  console.log('To customize, type five cron fields: minute hour day-of-month month day-of-week.');
  console.log('Examples: 0 9 * * * = daily at 09:00, */30 * * * * = every 30 minutes.');
  console.log();
}

async function promptCronSchedule(job: IInitJobCatalogItem): Promise<string> {
  const defaultDescription = describeCronSchedule(job.defaultSchedule);
  const question = `${job.label} schedule [default: ${job.defaultSchedule} - ${defaultDescription}] (Enter/y = accept)`;
  let schedule = normalizeCronSchedulePromptInput(await promptText(question), job.defaultSchedule);

  while (!isValidCronSchedule(schedule)) {
    warn(
      `Cron schedules need five fields: minute hour day-of-month month day-of-week. Example: 5 */2 * * *`,
    );
    schedule = normalizeCronSchedulePromptInput(await promptText(question), job.defaultSchedule);
  }

  return schedule;
}

function parseScheduleOverrides(
  scheduleOptions: string[] | string | undefined,
): Partial<Record<InitJobId, string>> {
  const overrides: Partial<Record<InitJobId, string>> = {};
  for (const option of normalizeScheduleOptions(scheduleOptions)) {
    const separatorIndex = option.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid schedule override "${option}". Use --schedule job="cron expr".`);
    }
    const job = parseJobId(option.slice(0, separatorIndex));
    if (!job) {
      throw new Error(`Unknown schedule job "${option.slice(0, separatorIndex)}".`);
    }
    const schedule = option.slice(separatorIndex + 1).trim();
    if (!isValidCronSchedule(schedule)) {
      throw new Error(`Invalid cron schedule for ${job}: "${schedule}". Expected five fields.`);
    }
    overrides[job] = schedule;
  }
  return overrides;
}

export function buildDefaultJobSelection(options?: {
  reviewerEnabled?: boolean;
  jobs?: string;
  noJobs?: string;
  schedule?: string[] | string;
}): IJobSelectionAnswer {
  const defaults = getDefaultConfig();
  const enabled = new Set<InitJobId>(RECOMMENDED_INIT_JOBS);

  if (options?.reviewerEnabled === false) {
    enabled.delete('reviewer');
  }

  for (const jobId of parseJobCsv(options?.jobs)) {
    enabled.add(jobId);
  }
  for (const jobId of parseJobCsv(options?.noJobs)) {
    enabled.delete(jobId);
  }

  const schedules = Object.fromEntries(
    INIT_JOB_IDS.map((jobId) => [jobId, scheduleForJob(defaults, jobId)]),
  ) as Record<InitJobId, string>;
  Object.assign(schedules, parseScheduleOverrides(options?.schedule));

  return {
    bundle: 'custom',
    enabledJobs: INIT_JOB_IDS.filter((jobId) => enabled.has(jobId)),
    schedules,
  };
}

export function buildBundleJobSelection(bundle: InitJobBundle): IJobSelectionAnswer {
  const defaults = getDefaultConfig();
  let enabledJobs: InitJobId[];
  if (bundle === 'minimal') {
    enabledJobs = MINIMAL_INIT_JOBS;
  } else if (bundle === 'recommended') {
    enabledJobs = RECOMMENDED_INIT_JOBS;
  } else {
    enabledJobs = INIT_JOB_IDS.filter((jobId) => jobEnabledByDefault(defaults, jobId));
  }

  const schedules = Object.fromEntries(
    INIT_JOB_IDS.map((jobId) => [jobId, scheduleForJob(defaults, jobId)]),
  ) as Record<InitJobId, string>;

  return {
    bundle,
    enabledJobs: [...enabledJobs],
    schedules,
  };
}

function enabledJobSet(selection: IJobSelectionAnswer): Set<InitJobId> {
  return new Set(selection.enabledJobs);
}

function formatEnabledJobs(selection: IJobSelectionAnswer): string {
  const enabled = enabledJobSet(selection);
  const catalog = getInitJobCatalog();
  const rows = catalog
    .filter((job) => enabled.has(job.id))
    .map((job) => `${job.label}: ${formatScheduleWithDescription(selection.schedules[job.id])}`);
  return rows.length > 0 ? rows.join(', ') : 'None';
}

export function applyJobSelectionToConfig(
  config: IGeneratedInitConfig,
  selection: IJobSelectionAnswer,
): IGeneratedInitConfig {
  const enabled = enabledJobSet(selection);

  config.executorEnabled = enabled.has('executor');
  config.cronSchedule = selection.schedules.executor;
  config.reviewerEnabled = enabled.has('reviewer');
  config.reviewerSchedule = selection.schedules.reviewer;
  config.qa = { ...config.qa, enabled: enabled.has('qa'), schedule: selection.schedules.qa };
  config.audit = {
    ...config.audit,
    enabled: enabled.has('audit'),
    schedule: selection.schedules.audit,
  };
  config.analytics = {
    ...config.analytics,
    enabled: enabled.has('analytics'),
    schedule: selection.schedules.analytics,
  };
  config.roadmapScanner = {
    ...config.roadmapScanner,
    enabled: enabled.has('slicer'),
    slicerSchedule: selection.schedules.slicer,
  };
  config.prResolver = {
    ...config.prResolver,
    enabled: enabled.has('pr-resolver'),
    schedule: selection.schedules['pr-resolver'],
  };
  config.manager = {
    ...config.manager,
    enabled: enabled.has('manager'),
    schedule: selection.schedules.manager,
  };
  config.merger = {
    ...config.merger,
    enabled: enabled.has('merger'),
    schedule: selection.schedules.merger,
  };
  config.autoMerge = enabled.has('merger');

  return config;
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
  _interactive: boolean,
  _detectedProviders: Provider[],
): boolean {
  return false;
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
  const choices = buildProviderChoices(detectedProviders);
  const choice = await select<IProviderChoice>({
    message: 'AI provider',
    choices: choices.map((providerChoice) => ({
      name: providerChoice.label,
      value: providerChoice,
    })),
    default: choices.find((providerChoice) => providerChoice.provider === selectedProvider),
  });

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

async function promptJobSelection(): Promise<IJobSelectionAnswer> {
  header('Job Selection');
  const selection = buildBundleJobSelection('recommended');
  const enabledJobIds = await promptEnabledJobIds(selection.enabledJobs);
  const enabled = new Set(enabledJobIds);

  selection.enabledJobs = INIT_JOB_IDS.filter((jobId) => enabled.has(jobId));

  const editSchedules = await promptYesNo('Customize job schedules?', true);
  if (editSchedules) {
    printCronScheduleHelp();
    for (const job of getInitJobCatalog()) {
      if (!enabled.has(job.id)) {
        continue;
      }
      selection.schedules[job.id] = await promptCronSchedule(job);
    }
  }

  return selection;
}

function maskSecret(value: string | undefined): string {
  if (!value) {
    return '';
  }
  if (value.length <= 8) {
    return '********';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatNotificationStatus(notifications: INotificationSelectionAnswer): string {
  if (notifications.webhooks.length === 0) {
    return notifications.skipped ? 'Skipped' : 'None';
  }
  return notifications.webhooks
    .map((webhook) => {
      if (webhook.type === 'telegram') {
        return `Telegram chat ${webhook.chatId ? maskSecret(webhook.chatId) : '(missing)'}`;
      }
      return webhook.type.charAt(0).toUpperCase() + webhook.type.slice(1);
    })
    .join(', ');
}

async function promptNotificationSetup(): Promise<INotificationSelectionAnswer> {
  header('Notifications');
  const type = await promptChoice<'telegram' | 'slack' | 'discord'>(
    'Notification destination',
    [
      { value: 'telegram', label: 'Telegram bot' },
      { value: 'slack', label: 'Slack incoming webhook' },
      { value: 'discord', label: 'Discord webhook' },
    ],
    'telegram',
  );

  let webhook: IWebhookConfig;

  if (type === 'telegram') {
    webhook = {
      type,
      botToken: await promptText('Telegram bot token'),
      chatId: await promptText('Telegram chat ID'),
      events: [...DEFAULT_NOTIFICATION_EVENTS],
    };
  } else {
    webhook = {
      type,
      url: await promptText(`${type === 'slack' ? 'Slack' : 'Discord'} webhook URL`),
      events: [...DEFAULT_NOTIFICATION_EVENTS],
    };
  }

  let issues = validateWebhook(webhook);
  while (issues.length > 0) {
    warn(`Notification webhook looks invalid: ${issues.join('; ')}`);
    const fix = await promptYesNo('Fix this webhook now?', false);
    if (!fix) {
      const saveInvalid = await promptYesNo('Save it anyway?', true);
      return { webhooks: saveInvalid ? [webhook] : [], skipped: !saveInvalid };
    }

    if (type === 'telegram') {
      webhook = {
        ...webhook,
        botToken: await promptText('Telegram bot token'),
        chatId: await promptText('Telegram chat ID'),
      };
    } else {
      webhook = {
        ...webhook,
        url: await promptText(`${type === 'slack' ? 'Slack' : 'Discord'} webhook URL`),
      };
    }
    issues = validateWebhook(webhook);
  }

  info('Notification webhook saved. Test delivery later with `night-watch notify test`.');
  return { webhooks: [webhook], skipped: false };
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

function showFinalSetupReview(params: {
  projectName: string;
  provider: Provider;
  providerSummary: string;
  jobSelection: IJobSelectionAnswer;
  notifications: INotificationSelectionAnswer;
  remoteStatus: IGitHubRemoteStatus;
  ghAuthenticated: boolean;
  playwrightStatus: string;
  configPath: string;
  force: boolean;
  prdDir: string;
}): void {
  const configExists = fs.existsSync(params.configPath);
  let configWriteStatus = 'Create config';
  if (configExists && params.force) {
    configWriteStatus = 'Overwrite existing config';
  } else if (configExists) {
    configWriteStatus = 'Skip existing config';
  }

  let boardStatus = 'Skipped (no GitHub remote)';
  if (params.remoteStatus.hasGitHubRemote && params.ghAuthenticated) {
    boardStatus = 'Board setup and labels will run';
  } else if (params.remoteStatus.hasGitHubRemote) {
    boardStatus = 'Skipped until gh auth is available';
  }

  header('Final Setup Review');
  label('Project', params.projectName);
  label('Provider', `${params.provider} (${params.providerSummary})`);
  label('Enabled jobs', formatEnabledJobs(params.jobSelection));
  label('Notifications', formatNotificationStatus(params.notifications));
  label('Board/GitHub', boardStatus);
  label('Playwright', params.playwrightStatus);
  label('Config file', configWriteStatus);
  label('Directories', `${params.prdDir}/done, ${LOG_DIR}/, instructions/`);
  console.log();
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
  jobSelection?: IJobSelectionAnswer;
  notifications?: INotificationSelectionAnswer;
}): IGeneratedInitConfig {
  const defaults = getDefaultConfig();

  const config: IGeneratedInitConfig = {
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

  if (params.jobSelection) {
    applyJobSelectionToConfig(config, params.jobSelection);
  }

  if (params.notifications) {
    config.notifications = {
      ...config.notifications,
      webhooks: params.notifications.webhooks.map((webhook) => ({ ...webhook })),
    };
  }

  return config;
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
    .option('--jobs <csv>', `Enable init jobs (${INIT_JOB_IDS.join(', ')})`)
    .option('--no-jobs <csv>', `Disable init jobs (${INIT_JOB_IDS.join(', ')})`)
    .option(
      '--schedule <job=cron>',
      'Override an init job schedule; repeat for multiple jobs',
      (value: string, previous: string[] = []) => [...previous, value],
    )
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
      let providerSelection = await resolveProviderSelection(options, interactive && !options.yes);
      let selectedProvider = providerSelection.provider;
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
        info('Skipping Playwright install by default. QA can auto-install during execution.');
      }

      // Set reviewerEnabled from flag (default: true, --no-reviewer sets to false)
      const reviewerEnabled = options.reviewer !== false;
      let jobSelection: IJobSelectionAnswer;
      try {
        jobSelection = buildDefaultJobSelection({
          reviewerEnabled,
          jobs: options.jobs,
          noJobs: options.noJobs,
          schedule: options.schedule,
        });
      } catch (err) {
        uiError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      let notificationSelection: INotificationSelectionAnswer = {
        webhooks: [],
        skipped: true,
      };

      // Gather project information
      const projectName = getProjectName(cwd);
      const defaultBranch = getDefaultBranch(cwd);
      const configPath = path.join(cwd, CONFIG_FILE_NAME);

      if (interactive && !options.yes) {
        showFinalSetupReview({
          projectName,
          provider: selectedProvider,
          providerSummary: providerSelection.summary,
          jobSelection,
          notifications: notificationSelection,
          remoteStatus,
          ghAuthenticated,
          playwrightStatus,
          configPath,
          force,
          prdDir,
        });

        const useDefaults = await promptYesNo('Use these defaults and initialize?', false);
        if (!useDefaults) {
          const customize = await promptYesNo('Customize setup instead?', false);
          if (!customize) {
            info('Init cancelled. No project files were written.');
            return;
          }

          const customizationArea = await promptCustomizationArea({ playwrightDetected });
          if (customizationArea === 'provider') {
            providerSelection = await promptProviderOverrideSelection({
              selectedProvider,
              detectedProviders: providerSelection.detectedProviders,
              detectedCommands: providerSelection.detectedCommands,
            });
            selectedProvider = providerSelection.provider;
          }

          if (customizationArea === 'jobs') {
            jobSelection = await promptJobSelection();
          }

          if (customizationArea === 'notifications') {
            notificationSelection = await promptNotificationSetup();
          }

          if (customizationArea === 'playwright' && !playwrightDetected) {
            if (installPlaywrightForQa(cwd)) {
              playwrightStatus = 'installed during init';
              success('Installed Playwright test runner and Chromium browser.');
            } else {
              playwrightStatus = 'install failed';
              console.warn(
                '  Warning: Failed to install Playwright automatically. You can install it later.',
              );
            }
          }

          showFinalSetupReview({
            projectName,
            provider: selectedProvider,
            providerSummary: providerSelection.summary,
            jobSelection,
            notifications: notificationSelection,
            remoteStatus,
            ghAuthenticated,
            playwrightStatus,
            configPath,
            force,
            prdDir,
          });

          const finalConfirmed = await promptYesNo('Write this Night Watch setup?', false);
          if (!finalConfirmed) {
            info('Init cancelled. No project files were written.');
            return;
          }
        }
      }

      // Display project configuration
      header('Project Configuration');
      label('Project', projectName);
      label('Default branch', defaultBranch);
      label('Provider', selectedProvider);
      label('Jobs', formatEnabledJobs(jobSelection));
      label('Notifications', formatNotificationStatus(notificationSelection));
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
          jobSelection,
          notifications: notificationSelection,
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
      let boardSetupStatus: string;
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
      let labelSyncStatus: string;
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
      label('Enabled jobs', formatEnabledJobs(jobSelection));
      label('Notifications', formatNotificationStatus(notificationSelection));
      label('Board', boardSetupStatus);
      label('Skills', skillsSummary);
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
      info(`Join the Night Watch Discord: ${DISCORD_INVITE_URL}`);
      console.log();
    });
}

export default initCommand;
