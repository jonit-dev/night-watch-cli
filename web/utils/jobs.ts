import type { IAnalyticsConfig, IAuditConfig, IMergerConfig, INightWatchConfig, IQaConfig, IRoadmapScannerConfig } from '@shared/types';

export interface IJobDefinition {
  /** Config/API key — matches IJobProviders keys and ScheduleTimeline IDs */
  id: string;
  /** Human-readable label */
  label: string;
  /** PM2 process name and log file name (may differ from id, e.g. slicer → planner) */
  processName: string;
  /** Tailwind colour classes used in charts / timeline */
  color: { bg: string; border: string };
}

/** Extended web-side job definition with UI metadata */
export interface IWebJobDefinition extends IJobDefinition {
  /** API endpoint to trigger this job, e.g. '/api/actions/qa' */
  triggerEndpoint: string;
  /** Key in IScheduleTemplate.schedules object */
  scheduleTemplateKey: string;
  /** Read enabled status from config (handles legacy flat vs nested shapes) */
  getEnabled: (config: Partial<INightWatchConfig>) => boolean;
  /** Read schedule cron string from config */
  getSchedule: (config: Partial<INightWatchConfig>) => string;
  /** Section in Settings page */
  settingsSection?: 'general' | 'advanced';
  /** Build the config patch to enable/disable this job */
  buildEnabledPatch: (enabled: boolean, config: Partial<INightWatchConfig>) => Partial<INightWatchConfig>;
}

export const JOB_DEFINITIONS: IJobDefinition[] = [
  { id: 'executor',  label: 'Executor',  processName: 'executor',  color: { bg: 'bg-blue-500',   border: 'border-blue-500/60'   } },
  { id: 'reviewer',  label: 'Reviewer',  processName: 'reviewer',  color: { bg: 'bg-green-500',  border: 'border-green-500/60'  } },
  { id: 'qa',        label: 'QA',        processName: 'qa',        color: { bg: 'bg-purple-500', border: 'border-purple-500/60' } },
  { id: 'audit',     label: 'Audit',     processName: 'audit',     color: { bg: 'bg-orange-500', border: 'border-orange-500/60' } },
  { id: 'slicer',    label: 'Planner',   processName: 'planner',   color: { bg: 'bg-yellow-500', border: 'border-yellow-500/60' } },
  { id: 'analytics', label: 'Analytics', processName: 'analytics', color: { bg: 'bg-pink-500',   border: 'border-pink-500/60'   } },
  { id: 'merger',    label: 'Merger',    processName: 'merger',    color: { bg: 'bg-cyan-500',   border: 'border-cyan-500/60'   } },
];

export const WEB_JOB_REGISTRY: IWebJobDefinition[] = [
  {
    id: 'executor',
    label: 'Executor',
    processName: 'executor',
    color: { bg: 'bg-blue-500', border: 'border-blue-500/60' },
    triggerEndpoint: '/api/actions/run',
    scheduleTemplateKey: 'executor',
    getEnabled: (config) => config.executorEnabled ?? true,
    getSchedule: (config) => config.cronSchedule ?? '5 */2 * * *',
    settingsSection: 'general',
    buildEnabledPatch: (enabled) => ({ executorEnabled: enabled }),
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    processName: 'reviewer',
    color: { bg: 'bg-green-500', border: 'border-green-500/60' },
    triggerEndpoint: '/api/actions/review',
    scheduleTemplateKey: 'reviewer',
    getEnabled: (config) => config.reviewerEnabled ?? true,
    getSchedule: (config) => config.reviewerSchedule ?? '25 */3 * * *',
    settingsSection: 'general',
    buildEnabledPatch: (enabled) => ({ reviewerEnabled: enabled }),
  },
  {
    id: 'qa',
    label: 'QA',
    processName: 'qa',
    color: { bg: 'bg-purple-500', border: 'border-purple-500/60' },
    triggerEndpoint: '/api/actions/qa',
    scheduleTemplateKey: 'qa',
    getEnabled: (config) => config.qa?.enabled ?? true,
    getSchedule: (config) => config.qa?.schedule ?? '45 2,10,18 * * *',
    settingsSection: 'general',
    buildEnabledPatch: (enabled, config) => ({ qa: { ...(config.qa ?? {}), enabled } as IQaConfig }),
  },
  {
    id: 'audit',
    label: 'Audit',
    processName: 'audit',
    color: { bg: 'bg-orange-500', border: 'border-orange-500/60' },
    triggerEndpoint: '/api/actions/audit',
    scheduleTemplateKey: 'audit',
    getEnabled: (config) => config.audit?.enabled ?? true,
    getSchedule: (config) => config.audit?.schedule ?? '50 3 * * 1',
    settingsSection: 'advanced',
    buildEnabledPatch: (enabled, config) => ({ audit: { ...(config.audit ?? {}), enabled } as IAuditConfig }),
  },
  {
    id: 'slicer',
    label: 'Planner',
    processName: 'planner',
    color: { bg: 'bg-yellow-500', border: 'border-yellow-500/60' },
    triggerEndpoint: '/api/actions/planner',
    scheduleTemplateKey: 'slicer',
    getEnabled: (config) => config.roadmapScanner?.enabled ?? true,
    getSchedule: (config) => config.roadmapScanner?.slicerSchedule ?? '35 */6 * * *',
    settingsSection: 'advanced',
    buildEnabledPatch: (enabled, config) => ({ roadmapScanner: { ...(config.roadmapScanner ?? {}), enabled } as IRoadmapScannerConfig }),
  },
  {
    id: 'analytics',
    label: 'Analytics',
    processName: 'analytics',
    color: { bg: 'bg-pink-500', border: 'border-pink-500/60' },
    triggerEndpoint: '/api/actions/analytics',
    scheduleTemplateKey: 'analytics',
    getEnabled: (config) => config.analytics?.enabled ?? false,
    getSchedule: (config) => config.analytics?.schedule ?? '0 6 * * 1',
    settingsSection: 'advanced',
    buildEnabledPatch: (enabled, config) => ({ analytics: { ...(config.analytics ?? {}), enabled } as IAnalyticsConfig }),
  },
  {
    id: 'merger',
    label: 'Merger',
    processName: 'merger',
    color: { bg: 'bg-cyan-500', border: 'border-cyan-500/60' },
    triggerEndpoint: '/api/actions/merge',
    scheduleTemplateKey: 'merger',
    getEnabled: (config) => config.merger?.enabled ?? false,
    getSchedule: (config) => config.merger?.schedule ?? '55 */4 * * *',
    settingsSection: 'advanced',
    buildEnabledPatch: (enabled, config) => ({ merger: { ...(config.merger ?? {}), enabled } as IMergerConfig }),
  },
];

/** Get a web job definition by ID */
export function getWebJobDef(id: string): IWebJobDefinition | undefined {
  return WEB_JOB_REGISTRY.find((j) => j.id === id);
}
