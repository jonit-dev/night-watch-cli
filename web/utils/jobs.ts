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

export const JOB_DEFINITIONS: IJobDefinition[] = [
  { id: 'executor',  label: 'Executor',  processName: 'executor',  color: { bg: 'bg-blue-500',   border: 'border-blue-500/60'   } },
  { id: 'reviewer',  label: 'Reviewer',  processName: 'reviewer',  color: { bg: 'bg-green-500',  border: 'border-green-500/60'  } },
  { id: 'qa',        label: 'QA',        processName: 'qa',        color: { bg: 'bg-purple-500', border: 'border-purple-500/60' } },
  { id: 'audit',     label: 'Audit',     processName: 'audit',     color: { bg: 'bg-orange-500', border: 'border-orange-500/60' } },
  { id: 'slicer',    label: 'Planner',   processName: 'planner',   color: { bg: 'bg-yellow-500', border: 'border-yellow-500/60' } },
  { id: 'analytics', label: 'Analytics', processName: 'analytics', color: { bg: 'bg-pink-500',   border: 'border-pink-500/60'   } },
];
