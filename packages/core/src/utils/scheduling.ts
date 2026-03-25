import * as fs from 'fs';
import * as path from 'path';

import { loadConfig } from '../config.js';
import {
  CONFIG_FILE_NAME,
  DEFAULT_CRON_SCHEDULE_OFFSET,
  DEFAULT_SCHEDULING_PRIORITY,
} from '../constants.js';
import type { INightWatchConfig, JobType } from '../types.js';
import { loadRegistry } from './registry.js';

export interface ISchedulingPlan {
  manualDelayMinutes: number;
  balancedDelayMinutes: number;
  totalDelayMinutes: number;
  peerCount: number;
  slotIndex: number;
  schedulingPriority: number;
}

interface ISchedulingPeer {
  path: string;
  config: INightWatchConfig;
  schedulingPriority: number;
  sortKey: string;
}

export function normalizeSchedulingPriority(priority?: number): number {
  if (!Number.isFinite(priority)) {
    return DEFAULT_SCHEDULING_PRIORITY;
  }
  return Math.max(1, Math.min(5, Math.floor(priority!)));
}

export function isJobTypeEnabled(config: INightWatchConfig, jobType: JobType): boolean {
  switch (jobType) {
    case 'executor':
      return config.executorEnabled !== false;
    case 'reviewer':
      return config.reviewerEnabled;
    case 'qa':
      return config.qa.enabled;
    case 'audit':
      return config.audit.enabled;
    case 'slicer':
      return config.roadmapScanner.enabled;
    case 'analytics':
      return config.analytics.enabled;
    default:
      return true;
  }
}

function getJobSchedule(config: INightWatchConfig, jobType: JobType): string {
  switch (jobType) {
    case 'reviewer':
      return config.reviewerSchedule ?? '';
    case 'executor':
    default:
      return config.cronSchedule ?? '';
  }
}

function loadPeerConfig(projectPath: string): INightWatchConfig | null {
  if (!fs.existsSync(projectPath) || !fs.existsSync(path.join(projectPath, CONFIG_FILE_NAME))) {
    return null;
  }

  try {
    return loadConfig(projectPath);
  } catch {
    return null;
  }
}

function collectSchedulingPeers(
  currentProjectDir: string,
  currentConfig: INightWatchConfig,
  jobType: JobType,
): ISchedulingPeer[] {
  const peers = new Map<string, ISchedulingPeer>();
  const currentPath = path.resolve(currentProjectDir);
  const currentSchedule = getJobSchedule(currentConfig, jobType);

  const addPeer = (projectPath: string, config: INightWatchConfig): void => {
    const resolvedPath = path.resolve(projectPath);
    if (!isJobTypeEnabled(config, jobType)) {
      return;
    }
    // Only balance with peers that share the same cron schedule
    if (getJobSchedule(config, jobType) !== currentSchedule) {
      return;
    }

    peers.set(resolvedPath, {
      path: resolvedPath,
      config,
      schedulingPriority: normalizeSchedulingPriority(config.schedulingPriority),
      sortKey: `${path.basename(resolvedPath).toLowerCase()}::${resolvedPath.toLowerCase()}`,
    });
  };

  addPeer(currentPath, currentConfig);

  for (const entry of loadRegistry()) {
    const resolvedPath = path.resolve(entry.path);
    if (resolvedPath === currentPath || peers.has(resolvedPath)) {
      continue;
    }

    const peerConfig = loadPeerConfig(resolvedPath);
    if (peerConfig) {
      addPeer(resolvedPath, peerConfig);
    }
  }

  return Array.from(peers.values()).sort((left, right) => {
    if (left.schedulingPriority !== right.schedulingPriority) {
      return right.schedulingPriority - left.schedulingPriority;
    }
    return left.sortKey.localeCompare(right.sortKey);
  });
}

export function getSchedulingPlan(
  projectDir: string,
  config: INightWatchConfig,
  jobType: JobType,
): ISchedulingPlan {
  const peers = collectSchedulingPeers(projectDir, config, jobType);
  const currentPath = path.resolve(projectDir);
  const slotIndex = Math.max(
    0,
    peers.findIndex((peer) => peer.path === currentPath),
  );
  const peerCount = Math.max(1, peers.length);
  const balancedDelayMinutes = peerCount <= 1 ? 0 : Math.floor((slotIndex * 60) / peerCount);
  const manualDelayMinutes = Math.max(
    0,
    Math.floor(config.cronScheduleOffset ?? DEFAULT_CRON_SCHEDULE_OFFSET),
  );

  return {
    manualDelayMinutes,
    balancedDelayMinutes,
    totalDelayMinutes: manualDelayMinutes + balancedDelayMinutes,
    peerCount,
    slotIndex,
    schedulingPriority: normalizeSchedulingPriority(config.schedulingPriority),
  };
}

export function addDelayToIsoString(isoString: string | null, delayMinutes: number): string | null {
  if (!isoString) {
    return null;
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setTime(date.getTime() + delayMinutes * 60_000);
  return date.toISOString();
}
