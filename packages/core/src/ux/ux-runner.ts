/**
 * UX runner: asks an AI provider to inspect configured flows with Playwright and
 * creates a single prioritized draft report on the board.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BoardColumnName, IBoardProvider } from '../board/types.js';
import { createBoardProvider } from '../board/factory.js';
import { INightWatchConfig, IProviderPreset } from '../types.js';
import { resolveJobProvider, resolvePreset } from '../config.js';
import { executeScriptWithOutput } from '../utils/shell.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ux');

export type UxPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface IUxFinding {
  title: string;
  priority: UxPriority;
  impact: string;
  affectedFlows: string[];
  affectedPages: string[];
  evidence: string[];
  reproductionSteps: string[];
  recommendedFix: string;
}

export interface IUxRunResult {
  findings: IUxFinding[];
  issuesCreated: number;
  reportUrl?: string;
  summary: string;
}

export interface IUxRunOptions {
  dryRun?: boolean;
  providerOutput?: string;
  boardProvider?: IBoardProvider | null;
  providerInvoker?: (
    prompt: string,
    config: INightWatchConfig,
    projectDir: string,
  ) => Promise<string>;
}

interface IRawUxFinding {
  title?: unknown;
  priority?: unknown;
  severity?: unknown;
  impact?: unknown;
  affectedFlows?: unknown;
  affectedFlow?: unknown;
  flows?: unknown;
  affectedPages?: unknown;
  affectedPage?: unknown;
  pages?: unknown;
  evidence?: unknown;
  reproductionSteps?: unknown;
  steps?: unknown;
  recommendedFix?: unknown;
  recommendation?: unknown;
  fix?: unknown;
}

const PRIORITY_ORDER: UxPriority[] = ['P0', 'P1', 'P2', 'P3'];

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean);
  }
  const single = asString(value);
  return single ? [single] : [];
}

export function normalizeUxPriority(value: unknown): UxPriority {
  const raw = asString(value).toUpperCase();
  if (raw === 'P0' || raw === 'CRITICAL' || raw === 'BLOCKER') return 'P0';
  if (raw === 'P1' || raw === 'HIGH' || raw === 'MAJOR') return 'P1';
  if (raw === 'P2' || raw === 'MEDIUM' || raw === 'MODERATE') return 'P2';
  return 'P3';
}

export function sortUxFindings(findings: IUxFinding[]): IUxFinding[] {
  return [...findings].sort(
    (left, right) =>
      PRIORITY_ORDER.indexOf(left.priority) - PRIORITY_ORDER.indexOf(right.priority) ||
      left.title.localeCompare(right.title),
  );
}

function rawFindingToFinding(raw: IRawUxFinding): IUxFinding | null {
  const title = asString(raw.title);
  if (!title) return null;

  return {
    title,
    priority: normalizeUxPriority(raw.priority ?? raw.severity),
    impact: asString(raw.impact, 'Not specified'),
    affectedFlows: asStringArray(raw.affectedFlows ?? raw.affectedFlow ?? raw.flows),
    affectedPages: asStringArray(raw.affectedPages ?? raw.affectedPage ?? raw.pages),
    evidence: asStringArray(raw.evidence),
    reproductionSteps: asStringArray(raw.reproductionSteps ?? raw.steps),
    recommendedFix: asString(
      raw.recommendedFix ?? raw.recommendation ?? raw.fix,
      'Investigate and improve the affected user experience.',
    ),
  };
}

function extractJsonCandidate(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    }

    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart !== -1 && objectEnd > objectStart) {
      return JSON.parse(text.slice(objectStart, objectEnd + 1));
    }

    throw new Error('No JSON object or array found in UX provider output');
  }
}

export function parseUxFindings(text: string): IUxFinding[] {
  let parsed: unknown;
  try {
    parsed = extractJsonCandidate(text);
  } catch {
    logger.warn('Failed to parse UX provider output as JSON');
    return [];
  }

  let rawItems: unknown[] = [];
  if (Array.isArray(parsed)) {
    rawItems = parsed;
  } else if (Array.isArray((parsed as Record<string, unknown>)?.findings)) {
    rawItems = (parsed as Record<string, unknown>).findings as unknown[];
  }

  const findings = rawItems
    .filter((item): item is IRawUxFinding => item !== null && typeof item === 'object')
    .map(rawFindingToFinding)
    .filter((item): item is IUxFinding => item !== null);

  return sortUxFindings(findings);
}

function formatList(items: string[], fallback = 'Not specified'): string {
  if (items.length === 0) return fallback;
  return items.map((item) => `- ${item}`).join('\n');
}

export function buildUxReportBody(input: {
  findings: IUxFinding[];
  baseUrl: string;
  startUrl: string;
  flows: string[];
}): string {
  const lines: string[] = [
    '# UX Report',
    '',
    `Generated by Night Watch UX agent on ${new Date().toISOString()}.`,
    '',
    '## Scope',
    '',
    `- Base URL: ${input.baseUrl || 'Not configured'}`,
    `- Start URL: ${input.startUrl || 'Not configured'}`,
    '- Configured flows:',
    input.flows.length > 0 ? formatList(input.flows) : '- Not configured',
    '',
    '## Findings',
  ];

  input.findings.forEach((finding, index) => {
    lines.push(
      '',
      `### ${index + 1}. [${finding.priority}] ${finding.title}`,
      '',
      '**Impact**',
      '',
      finding.impact,
      '',
      '**Affected Flows**',
      '',
      formatList(finding.affectedFlows),
      '',
      '**Affected Pages**',
      '',
      formatList(finding.affectedPages),
      '',
      '**Evidence**',
      '',
      formatList(finding.evidence),
      '',
      '**Reproduction Steps**',
      '',
      formatList(finding.reproductionSteps),
      '',
      '**Recommended Fix**',
      '',
      finding.recommendedFix,
    );
  });

  return lines.join('\n');
}

export function buildUxAuditPrompt(config: INightWatchConfig, projectDir: string): string {
  const ux = config.ux;
  const configuredUrl = ux.startUrl || ux.baseUrl;
  const custom = ux.reportPrompt.trim();

  return [
    custom || 'You are a senior UX reviewer creating an actionable UX report.',
    '',
    'Use Playwright/browser automation for the inspection. If Playwright is missing and auto-install is enabled, use a lightweight local check/install such as `npx playwright --version` and `npx playwright install chromium` as needed.',
    'Inspect the configured app, traverse the listed flows, capture screenshots or other evidence when useful, and focus on issues that materially affect user comprehension, completion, accessibility, responsiveness, or trust.',
    '',
    'Return only JSON. Use this exact shape:',
    '[{"title":"...","priority":"P0|P1|P2|P3","impact":"...","affectedFlows":["..."],"affectedPages":["..."],"evidence":["screenshot path or observation"],"reproductionSteps":["..."],"recommendedFix":"..."}]',
    'If no actionable UX issues are found, return [] only.',
    '',
    'Priority definitions:',
    '- P0: blocks core user flow or causes serious data/action risk',
    '- P1: major friction, broken responsive state, or accessibility failure in a key flow',
    '- P2: moderate confusion or inefficient interaction',
    '- P3: polish or minor usability concern',
    '',
    `Project directory: ${projectDir}`,
    `Base URL: ${ux.baseUrl || 'not configured'}`,
    `Start URL: ${configuredUrl || 'not configured'}`,
    `Auto-install Playwright: ${ux.autoInstallPlaywright ? 'yes' : 'no'}`,
    `Maximum findings: ${Math.max(1, ux.maxIssues)}`,
    '',
    'Configured flows:',
    ux.flows.length > 0
      ? ux.flows.map((flow) => `- ${flow}`).join('\n')
      : '- Discover the primary user flows from the app/repo.',
  ].join('\n');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function buildPresetCommand(
  preset: IProviderPreset,
  promptFile: string,
  projectDir: string,
): string {
  const args = [preset.command];
  if (preset.subcommand) args.push(preset.subcommand);
  if (preset.workdirFlag) args.push(preset.workdirFlag, projectDir);
  if (preset.modelFlag && preset.model) args.push(preset.modelFlag, preset.model);
  if (preset.autoApproveFlag) args.push(preset.autoApproveFlag);

  const quotedPrefix = args.map(shellQuote).join(' ');
  const promptArg = `"$(cat ${shellQuote(promptFile)})"`;
  if (preset.promptFlag) {
    return `${quotedPrefix} ${shellQuote(preset.promptFlag)} ${promptArg}`;
  }
  return `${quotedPrefix} ${promptArg}`;
}

async function invokeProvider(
  prompt: string,
  config: INightWatchConfig,
  projectDir: string,
): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-ux-'));
  const promptFile = path.join(tmpDir, 'ux-prompt.md');
  const scriptFile = path.join(tmpDir, 'run-ux.sh');

  try {
    fs.writeFileSync(promptFile, prompt, 'utf-8');
    const provider = resolveJobProvider(config, 'ux');
    const preset = resolvePreset(config, provider);
    const command = buildPresetCommand(preset, promptFile, projectDir);
    fs.writeFileSync(scriptFile, `#!/usr/bin/env bash\nset -euo pipefail\n${command} 2>&1\n`, {
      mode: 0o755,
    });

    const env = { ...(preset.envVars ?? {}), ...(config.providerEnv ?? {}) };
    const { exitCode, stdout, stderr } = await executeScriptWithOutput(scriptFile, [], env, {
      cwd: projectDir,
    });

    if (exitCode !== 0) {
      throw new Error(`UX provider exited with code ${exitCode}: ${stderr || stdout}`);
    }
    return `${stdout}\n${stderr}`;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

async function resolveBoardProvider(
  config: INightWatchConfig,
  projectDir: string,
  injected: IBoardProvider | null | undefined,
): Promise<IBoardProvider | null> {
  if (injected !== undefined) return injected;
  if (!config.boardProvider?.enabled) return null;
  return createBoardProvider(config.boardProvider, projectDir);
}

export async function runUx(
  config: INightWatchConfig,
  projectDir: string,
  options: IUxRunOptions = {},
): Promise<IUxRunResult> {
  const prompt = buildUxAuditPrompt(config, projectDir);
  const providerOutput =
    options.providerOutput ??
    (await (options.providerInvoker ?? invokeProvider)(prompt, config, projectDir));
  const findings = parseUxFindings(providerOutput).slice(0, Math.max(1, config.ux.maxIssues));

  if (findings.length === 0) {
    return { findings, issuesCreated: 0, summary: 'No actionable UX issues found' };
  }

  const body = buildUxReportBody({
    findings,
    baseUrl: config.ux.baseUrl,
    startUrl: config.ux.startUrl,
    flows: config.ux.flows,
  });

  if (options.dryRun) {
    return {
      findings,
      issuesCreated: 0,
      summary: `Dry run found ${findings.length} UX finding(s); no board report created`,
    };
  }

  const boardProvider = await resolveBoardProvider(config, projectDir, options.boardProvider);
  if (!boardProvider) {
    return {
      findings,
      issuesCreated: 0,
      summary: `Found ${findings.length} UX finding(s); board provider is disabled`,
    };
  }

  const targetColumn: BoardColumnName = config.ux.targetColumn;
  const issue = await boardProvider.createIssue({
    title: `UX Report: ${findings.length} prioritized finding(s)`,
    body,
    column: targetColumn,
    labels: ['ux', 'night-watch'],
  });

  return {
    findings,
    issuesCreated: 1,
    reportUrl: issue.url,
    summary: `Created UX report with ${findings.length} finding(s) in ${targetColumn}`,
  };
}
