import * as fs from 'fs';
import * as path from 'path';

import { createBoardProvider } from '../board/factory.js';
import type { IBoardIssue, IBoardProvider } from '../board/types.js';
import { DEFAULT_MANAGER } from '../constants.js';
import type { DayOfWeek, IManagerConfig, INightWatchConfig, IQueueStatus } from '../types.js';
import { getQueueStatus } from '../utils/job-queue.js';
import { fetchStatusSnapshot } from '../utils/status-data.js';
import type { IStatusSnapshot } from '../utils/status-data.js';
import { analyzeManagerInputs } from './manager-analysis.js';
import { createManagerBoardDrafts, prepareManagerDrafts } from './manager-board.js';
import {
  loadManagerMemory,
  summarizeCreatedDrafts,
  summarizeSkippedFindings,
  writeManagerMemory,
} from './manager-memory.js';
import { prepareManagerNotificationDecisions } from './manager-notifications.js';
import type {
  IManagerResolvedConfig,
  IManagerRunContext,
  IManagerRunOptions,
  IManagerRunResult,
} from './manager-types.js';

export async function runManager(
  projectDir: string,
  config: INightWatchConfig,
  options: IManagerRunOptions = {},
): Promise<IManagerRunResult> {
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const managerConfig = resolveManagerConfig(config, projectDir);
  const memory = loadManagerMemory(managerConfig.memoryFile);
  const boardProvider = await resolveBoardProvider(config, projectDir, options.boardProvider);
  const boardIssues = await readBoardIssues(boardProvider);
  const queueStatus = resolveQueueStatus(options.queueStatus);
  const statusSnapshot = await resolveStatusSnapshot(projectDir, config, options.statusSnapshot);

  const context: IManagerRunContext = {
    projectDir,
    config,
    managerConfig,
    dryRun,
    now,
    boardIssues,
    statusSnapshot,
    queueStatus,
  };
  const analysis = analyzeManagerInputs(context);
  const { drafts, skipped } = prepareManagerDrafts({
    findings: analysis.findings,
    memory,
    boardIssues,
    managerConfig,
  });
  const createdDrafts = await createManagerBoardDrafts({
    provider: boardProvider,
    drafts,
    dryRun,
    outputMode: managerConfig.outputMode,
  });
  const notificationDecisions = prepareManagerNotificationDecisions({
    findings: analysis.findings,
    memory,
    managerConfig,
    now,
  });

  const result: IManagerRunResult = {
    dryRun,
    projectDir,
    config: managerConfig,
    analyzed: {
      roadmapItems: analysis.roadmapItems,
      boardIssues: boardIssues.length,
      prds: analysis.prds.length,
    },
    findings: analysis.findings,
    proposedDrafts: drafts,
    createdDrafts,
    skippedFindings: skipped,
    docsWritten: [],
    memoryWritten: false,
    notificationDecisions,
    summary: '',
  };

  if (!dryRun) {
    result.docsWritten = writeManagerDocs(managerConfig.docsDirectory, result, now);
    writeManagerMemory(managerConfig.memoryFile, result, memory);
    result.memoryWritten = true;
  }

  result.summary = [
    `${analysis.findings.length} finding${analysis.findings.length === 1 ? '' : 's'} found.`,
    summarizeCreatedDrafts(createdDrafts),
    summarizeSkippedFindings(skipped),
  ].join(' ');

  return result;
}

export function resolveManagerConfig(
  config: INightWatchConfig,
  projectDir: string,
): IManagerResolvedConfig {
  const raw = ((config as unknown as { manager?: Partial<IManagerConfig> }).manager ??
    {}) as Partial<IManagerConfig>;
  const merged: IManagerConfig = {
    ...DEFAULT_MANAGER,
    ...raw,
    authority:
      raw.authority === 'draft' || raw.authority === 'ready' || raw.authority === 'workflow'
        ? raw.authority
        : DEFAULT_MANAGER.authority,
    outputMode:
      raw.outputMode === 'board-draft' ||
      raw.outputMode === 'filesystem-prd' ||
      raw.outputMode === 'report-only'
        ? raw.outputMode
        : DEFAULT_MANAGER.outputMode,
    targetColumn: raw.targetColumn ?? DEFAULT_MANAGER.targetColumn,
    weeklySummaryDay:
      typeof raw.weeklySummaryDay === 'number' && raw.weeklySummaryDay >= 0 && raw.weeklySummaryDay <= 6
        ? raw.weeklySummaryDay
        : DEFAULT_MANAGER.weeklySummaryDay,
  };

  const weeklySummaryDay = Math.floor(merged.weeklySummaryDay) as DayOfWeek;

  return {
    ...merged,
    weeklySummaryDay,
    memoryFile: path.resolve(projectDir, merged.memoryPath),
    docsDirectory: path.resolve(projectDir, merged.docsDir),
  };
}

async function resolveBoardProvider(
  config: INightWatchConfig,
  projectDir: string,
  injected: IBoardProvider | null | undefined,
): Promise<IBoardProvider | null> {
  if (injected !== undefined) {
    return injected;
  }

  if (!config.boardProvider?.enabled) {
    return null;
  }

  return createBoardProvider(config.boardProvider, projectDir);
}

async function readBoardIssues(provider: IBoardProvider | null): Promise<IBoardIssue[]> {
  if (!provider) return [];
  try {
    return await provider.getAllIssues();
  } catch {
    return [];
  }
}

function resolveQueueStatus(injected: IQueueStatus | null | undefined): IQueueStatus | null {
  if (injected !== undefined) {
    return injected;
  }

  try {
    return getQueueStatus();
  } catch {
    return null;
  }
}

async function resolveStatusSnapshot(
  projectDir: string,
  config: INightWatchConfig,
  injected: IManagerRunOptions['statusSnapshot'],
): Promise<IStatusSnapshot | null> {
  if (injected !== undefined) {
    return injected;
  }

  try {
    return await fetchStatusSnapshot(projectDir, config);
  } catch {
    return null;
  }
}

function writeManagerDocs(docsDir: string, result: IManagerRunResult, now: Date): string[] {
  const overviewPath = path.resolve(docsDir, 'overview.md');
  const relative = path.relative(docsDir, overviewPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write Manager docs outside docsDir: ${overviewPath}`);
  }

  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(
    overviewPath,
    [
      '# Manager Overview',
      '',
      `Generated: ${now.toISOString()}`,
      '',
      `Findings: ${result.findings.length}`,
      `Proposed drafts: ${result.proposedDrafts.length}`,
      `Created drafts: ${result.createdDrafts.length}`,
      '',
    ].join('\n'),
    'utf-8',
  );
  return [overviewPath];
}
