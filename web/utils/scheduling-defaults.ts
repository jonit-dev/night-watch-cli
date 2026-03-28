import type {
  IAnalyticsConfig,
  IAuditConfig,
  IMergerConfig,
  IQaConfig,
  IRoadmapScannerConfig,
} from '../api.js';

export const DEFAULT_EXECUTOR_SCHEDULE = '5 * * * *';
export const DEFAULT_REVIEWER_SCHEDULE = '25 */3 * * *';

export const DEFAULT_ROADMAP_SCANNER_CONFIG: IRoadmapScannerConfig = {
  enabled: true,
  roadmapPath: 'ROADMAP.md',
  autoScanInterval: 300,
  slicerSchedule: '35 */6 * * *',
  slicerMaxRuntime: 600,
  priorityMode: 'roadmap-first',
  issueColumn: 'Ready',
};

export const DEFAULT_QA_CONFIG: IQaConfig = {
  enabled: true,
  schedule: '45 2,10,18 * * *',
  maxRuntime: 3600,
  branchPatterns: [],
  artifacts: 'both',
  skipLabel: 'skip-qa',
  autoInstallPlaywright: true,
};

export const DEFAULT_AUDIT_CONFIG: IAuditConfig = {
  enabled: true,
  schedule: '50 3 * * 1',
  maxRuntime: 1800,
  targetColumn: 'Draft',
};

export const DEFAULT_ANALYTICS_CONFIG: IAnalyticsConfig = {
  enabled: false,
  schedule: '0 6 * * 1',
  maxRuntime: 900,
  lookbackDays: 7,
  targetColumn: 'Draft',
  analysisPrompt: '',
};

export const DEFAULT_MERGER_CONFIG: IMergerConfig = {
  enabled: false,
  schedule: '55 */4 * * *',
  maxRuntime: 1800,
  mergeMethod: 'squash',
  minReviewScore: 80,
  branchPatterns: [],
  rebaseBeforeMerge: true,
  maxPrsPerRun: 0,
};

export function getDefaultRoadmapScannerConfig(): IRoadmapScannerConfig {
  return { ...DEFAULT_ROADMAP_SCANNER_CONFIG };
}

export function getDefaultQaConfig(): IQaConfig {
  return {
    ...DEFAULT_QA_CONFIG,
    branchPatterns: [...DEFAULT_QA_CONFIG.branchPatterns],
  };
}

export function getDefaultAuditConfig(): IAuditConfig {
  return { ...DEFAULT_AUDIT_CONFIG };
}

export function getDefaultAnalyticsConfig(): IAnalyticsConfig {
  return { ...DEFAULT_ANALYTICS_CONFIG };
}

export function getDefaultMergerConfig(): IMergerConfig {
  return {
    ...DEFAULT_MERGER_CONFIG,
    branchPatterns: [...DEFAULT_MERGER_CONFIG.branchPatterns],
  };
}
