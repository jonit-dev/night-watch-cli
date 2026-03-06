import React, { useEffect, useState } from 'react';
import {
  Pause,
  Play,
  Clock,
  Edit,
  Check,
  AlertCircle,
  Calendar,
  TestTube2,
  Search,
  ClipboardList,
} from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Switch from '../components/ui/Switch';
import { useStore } from '../store/useStore';
import {
  fetchScheduleInfo,
  fetchConfig,
  updateConfig,
  triggerInstallCron,
  triggerUninstallCron,
  useApi,
} from '../api';
import {
  CRON_PRESETS,
  cronToHuman,
  getPresetValue,
  isCronEquivalent,
  resolveActiveTemplate,
  formatRelativeTime,
  formatAbsoluteTime,
  isWithin30Minutes,
} from '../utils/cron';

interface ScheduleEditState {
  executorSchedule: string;
  reviewerSchedule: string;
  isEditing: boolean;
}

const Scheduling: React.FC = () => {
  const { addToast, selectedProjectId, globalModeLoading } = useStore();
  const [toggling, setToggling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingJob, setUpdatingJob] = useState<string | null>(null);
  const [editState, setEditState] = useState<ScheduleEditState>({
    executorSchedule: '',
    reviewerSchedule: '',
    isEditing: false,
  });

  const {
    data: scheduleInfo,
    loading: scheduleLoading,
    error: scheduleError,
    refetch: refetchSchedule,
  } = useApi(fetchScheduleInfo, [selectedProjectId], { enabled: !globalModeLoading });

  const {
    data: config,
    loading: configLoading,
    refetch: refetchConfig,
  } = useApi(fetchConfig, [selectedProjectId], { enabled: !globalModeLoading });

  // Refetch schedule info every 30 seconds for countdown updates
  useEffect(() => {
    const interval = setInterval(() => {
      refetchSchedule();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetchSchedule]);

  // Initialize edit state when data loads
  useEffect(() => {
    if (config && !editState.isEditing) {
      setEditState({
        executorSchedule: config.cronSchedule,
        reviewerSchedule: config.reviewerSchedule,
        isEditing: false,
      });
    }
  }, [config, editState.isEditing]);

  const syncScheduleState = () => {
    refetchConfig();
    refetchSchedule();
  };

  const formatErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  const handlePauseResume = async () => {
    if (!scheduleInfo) return;

    setToggling(true);
    try {
      if (scheduleInfo.paused) {
        // Resume: install cron
        await triggerInstallCron();
        addToast({
          title: 'Schedule Resumed',
          message: 'Cron schedules have been reactivated.',
          type: 'success',
        });
      } else {
        // Pause: uninstall cron
        await triggerUninstallCron();
        addToast({
          title: 'Schedule Paused',
          message: 'Cron schedules have been deactivated.',
          type: 'info',
        });
      }
      syncScheduleState();
    } catch (error) {
      addToast({
        title: 'Action Failed',
        message: formatErrorMessage(error, 'Failed to toggle schedule state'),
        type: 'error',
      });
    } finally {
      setToggling(false);
    }
  };

  const handleEdit = () => {
    if (config) {
      setEditState({
        executorSchedule: config.cronSchedule,
        reviewerSchedule: config.reviewerSchedule,
        isEditing: true,
      });
    }
  };

  const handleCancelEdit = () => {
    if (config) {
      setEditState({
        executorSchedule: config.cronSchedule,
        reviewerSchedule: config.reviewerSchedule,
        isEditing: false,
      });
    }
  };

  const handleSaveAndInstall = async () => {
    if (!config) return;

    setSaving(true);
    try {
      await updateConfig({
        cronSchedule: editState.executorSchedule,
        reviewerSchedule: editState.reviewerSchedule,
      });

      let cronInstallFailedMessage = '';
      try {
        await triggerInstallCron();
      } catch (cronError) {
        cronInstallFailedMessage = formatErrorMessage(
          cronError,
          'Failed to reinstall cron schedules',
        );
      }

      setEditState((prev) => ({ ...prev, isEditing: false }));
      syncScheduleState();

      addToast(
        cronInstallFailedMessage
          ? {
              title: 'Schedules Saved (Cron Reinstall Failed)',
              message: cronInstallFailedMessage,
              type: 'warning',
            }
          : {
              title: 'Schedule Updated',
              message: 'Cron schedules have been saved and installed.',
              type: 'success',
            },
      );
    } catch (error) {
      addToast({
        title: 'Save Failed',
        message: formatErrorMessage(error, 'Failed to save schedules'),
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleJobToggle = async (
    job: 'executor' | 'reviewer' | 'qa' | 'audit' | 'planner',
    enabled: boolean,
  ) => {
    if (!config) return;

    setUpdatingJob(job);
    try {
      if (job === 'executor') {
        await updateConfig({ executorEnabled: enabled });
      } else if (job === 'reviewer') {
        await updateConfig({ reviewerEnabled: enabled });
      } else if (job === 'qa') {
        await updateConfig({ qa: { ...config.qa, enabled } });
      } else if (job === 'audit') {
        await updateConfig({ audit: { ...config.audit, enabled } });
      } else {
        await updateConfig({
          roadmapScanner: { ...config.roadmapScanner, enabled },
        });
      }

      let cronInstallFailedMessage = '';
      try {
        await triggerInstallCron();
      } catch (cronError) {
        cronInstallFailedMessage = formatErrorMessage(
          cronError,
          'Failed to reinstall cron schedules',
        );
      }

      syncScheduleState();

      addToast(
        cronInstallFailedMessage
          ? {
              title: 'Job Saved (Cron Reinstall Failed)',
              message: cronInstallFailedMessage,
              type: 'warning',
            }
          : {
              title: 'Job Updated',
              message: `${job[0].toUpperCase() + job.slice(1)} ${enabled ? 'enabled' : 'disabled'}.`,
              type: 'success',
            },
      );
    } catch (error) {
      addToast({
        title: 'Update Failed',
        message: formatErrorMessage(error, 'Failed to update job configuration'),
        type: 'error',
      });
    } finally {
      setUpdatingJob(null);
    }
  };

  const renderNextRun = (nextRunStr: string | null | undefined) => {
    if (!nextRunStr) {
      return <span className="text-slate-500">Not scheduled</span>;
    }

    const nextRun = new Date(nextRunStr);
    const isSoon = isWithin30Minutes(nextRun);

    return (
      <div className="flex items-center space-x-2">
        {isSoon && (
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
        )}
        <div className="text-sm">
          <span className="text-slate-200 font-medium">{formatRelativeTime(nextRun)}</span>
          <span className="text-slate-500 ml-2">({formatAbsoluteTime(nextRun)})</span>
        </div>
      </div>
    );
  };

  const renderScheduleEditor = (
    label: string,
    value: string,
    onChange: (val: string) => void,
    disabled?: boolean
  ) => {
    const presetValue = getPresetValue(value);
    const isCustom = presetValue === '__custom__';

    return (
      <div className={`space-y-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center space-x-3">
          <Select
            label={`${label} Preset`}
            options={CRON_PRESETS}
            value={presetValue}
            onChange={(val) => {
              if (val !== '__custom__') {
                onChange(val);
              }
            }}
            className="flex-1"
          />
        </div>
        {isCustom && (
          <Input
            label="Custom Cron Expression"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="* * * * *"
            helperText="Format: minute hour day month weekday (e.g., 0 */2 * * * for every 2 hours)"
          />
        )}
        <div className="text-sm text-slate-400">
          Human-readable: <span className="text-slate-200">{cronToHuman(value)}</span>
        </div>
      </div>
    );
  };

  const renderDelayNote = (
    jobInfo:
      | {
          delayMinutes: number;
          manualDelayMinutes: number;
          balancedDelayMinutes: number;
        }
      | undefined,
  ) => {
    if (!jobInfo || jobInfo.delayMinutes <= 0) {
      return <div className="text-xs text-slate-500 mt-2">Starts directly at the scheduled time.</div>;
    }

    const parts: string[] = [];
    if (jobInfo.balancedDelayMinutes > 0) {
      parts.push(`auto +${jobInfo.balancedDelayMinutes}m`);
    }
    if (jobInfo.manualDelayMinutes > 0) {
      parts.push(`manual +${jobInfo.manualDelayMinutes}m`);
    }

    return (
      <div className="text-xs text-slate-500 mt-2">
        Delayed after cron fire:
        <span className="text-slate-300"> {parts.join(' • ')}</span>
      </div>
    );
  };

  if (scheduleLoading || configLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading scheduling information...</div>
      </div>
    );
  }

  if (scheduleError || !scheduleInfo || !config) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <div className="text-slate-300">Failed to load schedule information</div>
        <div className="text-sm text-slate-500">{scheduleError?.message || 'Unknown error'}</div>
        <Button onClick={() => { refetchSchedule(); refetchConfig(); }}>Retry</Button>
      </div>
    );
  }

  const isPaused = scheduleInfo.paused;
  const statusColor = isPaused ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20';
  const statusText = isPaused ? 'Paused' : 'Active';
  const activeTemplate = resolveActiveTemplate(
    config.scheduleBundleId,
    config.cronSchedule,
    config.reviewerSchedule,
    config.qa.schedule,
    config.audit.schedule,
    config.roadmapScanner.slicerSchedule || '35 */12 * * *',
  );

  const formatScheduleLabel = (
    job: 'executor' | 'reviewer' | 'qa' | 'audit' | 'slicer',
    configuredCronExpr: string,
    displayedCronExpr: string,
  ): string => {
    if (!activeTemplate) {
      return cronToHuman(displayedCronExpr);
    }

    if (!isCronEquivalent(activeTemplate.schedules[job], configuredCronExpr)) {
      return cronToHuman(displayedCronExpr);
    }

    return `${activeTemplate.label} • ${activeTemplate.hints[job]}`;
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-100">Scheduling</h1>
        {activeTemplate && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-500">Schedule Bundle</div>
            <div className="text-sm font-medium text-indigo-300">{activeTemplate.label}</div>
            <div className="text-xs text-slate-500">
              Priority {scheduleInfo.schedulingPriority}/5 across registered projects
            </div>
          </div>
        )}
      </div>

      {/* A. Status Banner */}
      <Card className={`p-6 border-2 ${statusColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Clock className="h-8 w-8" />
            <div>
              <div className="text-sm text-slate-400">Cron Status</div>
              <div className="text-2xl font-bold">{statusText}</div>
              <div className="text-sm text-slate-500 mt-1">
                Automatic balancing spreads registered projects before queueing overlaps.
              </div>
            </div>
          </div>
          <Button
            variant={isPaused ? 'primary' : 'outline'}
            size="lg"
            onClick={handlePauseResume}
            loading={toggling}
          >
            {isPaused ? (
              <>
                <Play className="h-5 w-5 mr-2" />
                Resume
              </>
            ) : (
              <>
                <Pause className="h-5 w-5 mr-2" />
                Pause
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* B. Schedule Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Executor Schedule */}
        <Card className={`p-6 ${config.executorEnabled === false ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-200">Executor Schedule</h3>
            {config.executorEnabled === false ? (
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">Disabled</span>
            ) : !editState.isEditing && (
              <Button variant="ghost" size="sm" onClick={handleEdit}>
                <Edit className="h-4 w-4 mr-1" />
                Edit
              </Button>
            )}
          </div>

          {editState.isEditing ? (
            renderScheduleEditor(
              'Executor',
              editState.executorSchedule,
              (val) => setEditState(prev => ({ ...prev, executorSchedule: val })),
              config.executorEnabled === false
            )
          ) : (
            <>
              <div className="space-y-4">
                {config.executorEnabled !== false ? (
                  <>
                    <div>
                      <div className="text-sm text-slate-400 mb-1">Schedule</div>
                      <div className="text-lg text-slate-200 font-medium">
                        {formatScheduleLabel(
                          'executor',
                          config.cronSchedule,
                          scheduleInfo.executor.schedule,
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-1">
                        {scheduleInfo.executor.schedule}
                      </div>
                      {renderDelayNote(scheduleInfo.executor)}
                    </div>
                    <div>
                      <div className="text-sm text-slate-400 mb-1">Next Run</div>
                      {renderNextRun(scheduleInfo.executor.nextRun)}
                    </div>
                    <div className={`flex items-center space-x-2 text-sm ${scheduleInfo.executor.installed ? 'text-green-400' : 'text-amber-400'}`}>
                      <Check className="h-4 w-4" />
                      <span>{scheduleInfo.executor.installed ? 'Installed' : 'Not installed'}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-500 text-sm">
                    Executor is disabled in settings.
                  </div>
                )}
              </div>
            </>
          )}
        </Card>

        {/* Reviewer Schedule */}
        <Card className={`p-6 ${!config.reviewerEnabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-200">Reviewer Schedule</h3>
            {!config.reviewerEnabled && (
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">Disabled</span>
            )}
          </div>

          {editState.isEditing ? (
            renderScheduleEditor(
              'Reviewer',
              editState.reviewerSchedule,
              (val) => setEditState(prev => ({ ...prev, reviewerSchedule: val })),
              !config.reviewerEnabled
            )
          ) : (
            <>
              <div className="space-y-4">
                {config.reviewerEnabled ? (
                  <>
                    <div>
                      <div className="text-sm text-slate-400 mb-1">Schedule</div>
                      <div className="text-lg text-slate-200 font-medium">
                        {formatScheduleLabel(
                          'reviewer',
                          config.reviewerSchedule,
                          scheduleInfo.reviewer.schedule,
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-1">
                        {scheduleInfo.reviewer.schedule}
                      </div>
                      {renderDelayNote(scheduleInfo.reviewer)}
                    </div>
                    <div>
                      <div className="text-sm text-slate-400 mb-1">Next Run</div>
                      {renderNextRun(scheduleInfo.reviewer.nextRun)}
                    </div>
                    <div className={`flex items-center space-x-2 text-sm ${scheduleInfo.reviewer.installed ? 'text-green-400' : 'text-amber-400'}`}>
                      <Check className="h-4 w-4" />
                      <span>{scheduleInfo.reviewer.installed ? 'Installed' : 'Not installed'}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-500 text-sm">
                    Automated reviews are disabled. Enable them in Settings to configure the reviewer schedule.
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* C. Per-Job Enablement */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Job Enablement</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
            <div>
              <div className="text-sm font-medium text-slate-200">Executor</div>
              <div className="text-xs text-slate-500">Creates implementation PRs from PRDs</div>
            </div>
            <Switch
              checked={config.executorEnabled !== false}
              disabled={updatingJob !== null}
              aria-label="Toggle executor automation"
              onChange={(checked) => handleJobToggle('executor', checked)}
            />
          </div>
          <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
            <div>
              <div className="text-sm font-medium text-slate-200">Reviewer</div>
              <div className="text-xs text-slate-500">Reviews PRs and manages merge readiness</div>
            </div>
            <Switch
              checked={config.reviewerEnabled}
              disabled={updatingJob !== null}
              aria-label="Toggle reviewer automation"
              onChange={(checked) => handleJobToggle('reviewer', checked)}
            />
          </div>
          <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
            <div>
              <div className="text-sm font-medium text-slate-200">QA</div>
              <div className="text-xs text-slate-500">Generates and runs quality checks on PRs</div>
            </div>
            <Switch
              checked={config.qa.enabled}
              disabled={updatingJob !== null}
              aria-label="Toggle QA automation"
              onChange={(checked) => handleJobToggle('qa', checked)}
            />
          </div>
          <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40">
            <div>
              <div className="text-sm font-medium text-slate-200">Auditor</div>
              <div className="text-xs text-slate-500">Runs automated audit reports</div>
            </div>
            <Switch
              checked={config.audit.enabled}
              disabled={updatingJob !== null}
              aria-label="Toggle audit automation"
              onChange={(checked) => handleJobToggle('audit', checked)}
            />
          </div>
          <div className="flex items-center justify-between p-3 rounded-md border border-slate-800 bg-slate-950/40 md:col-span-2">
            <div>
              <div className="text-sm font-medium text-slate-200">Planner</div>
              <div className="text-xs text-slate-500">Creates PRDs from audit findings and pending roadmap items</div>
            </div>
            <Switch
              checked={config.roadmapScanner.enabled}
              disabled={updatingJob !== null}
              aria-label="Toggle planner automation"
              onChange={(checked) => handleJobToggle('planner', checked)}
            />
          </div>
        </div>
      </Card>

      {/* D. Background Jobs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className={`p-6 ${!config.qa.enabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
              <TestTube2 className="h-4 w-4" />
              QA
            </h3>
            {!config.qa.enabled && (
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">Disabled</span>
            )}
          </div>
          {config.qa.enabled ? (
            <div className="space-y-4">
              <div>
                <div className="text-sm text-slate-400 mb-1">Schedule</div>
                <div className="text-lg text-slate-200 font-medium">
                  {formatScheduleLabel('qa', config.qa.schedule, scheduleInfo.qa?.schedule ?? config.qa.schedule)}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-1">
                  {scheduleInfo.qa?.schedule ?? config.qa.schedule}
                </div>
                {renderDelayNote(scheduleInfo.qa)}
              </div>
              <div>
                <div className="text-sm text-slate-400 mb-1">Next Run</div>
                {renderNextRun(scheduleInfo.qa?.nextRun)}
              </div>
            </div>
          ) : (
            <div className="text-slate-500 text-sm">QA is disabled in settings.</div>
          )}
        </Card>

        <Card className={`p-6 ${!config.audit.enabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
              <Search className="h-4 w-4" />
              Auditor
            </h3>
            {!config.audit.enabled && (
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">Disabled</span>
            )}
          </div>
          {config.audit.enabled ? (
            <div className="space-y-4">
              <div>
                <div className="text-sm text-slate-400 mb-1">Schedule</div>
                <div className="text-lg text-slate-200 font-medium">
                  {formatScheduleLabel(
                    'audit',
                    config.audit.schedule,
                    scheduleInfo.audit?.schedule ?? config.audit.schedule,
                  )}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-1">
                  {scheduleInfo.audit?.schedule ?? config.audit.schedule}
                </div>
                {renderDelayNote(scheduleInfo.audit)}
              </div>
              <div>
                <div className="text-sm text-slate-400 mb-1">Next Run</div>
                {renderNextRun(scheduleInfo.audit?.nextRun)}
              </div>
            </div>
          ) : (
            <div className="text-slate-500 text-sm">Audit is disabled in settings.</div>
          )}
        </Card>

        <Card className={`p-6 ${!config.roadmapScanner.enabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Planner
            </h3>
            {!config.roadmapScanner.enabled && (
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">Disabled</span>
            )}
          </div>
          {config.roadmapScanner.enabled ? (
            <div className="space-y-4">
              <div>
                <div className="text-sm text-slate-400 mb-1">Schedule</div>
                <div className="text-lg text-slate-200 font-medium">
                  {formatScheduleLabel(
                    'slicer',
                    config.roadmapScanner.slicerSchedule,
                    scheduleInfo.planner?.schedule ?? config.roadmapScanner.slicerSchedule,
                  )}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-1">
                  {scheduleInfo.planner?.schedule ?? config.roadmapScanner.slicerSchedule}
                </div>
                {renderDelayNote(scheduleInfo.planner)}
              </div>
              <div>
                <div className="text-sm text-slate-400 mb-1">Next Run</div>
                {renderNextRun(scheduleInfo.planner?.nextRun)}
              </div>
            </div>
          ) : (
            <div className="text-slate-500 text-sm">Planner uses roadmap scanner scheduling.</div>
          )}
        </Card>
      </div>

      {/* E. Active Crontab Entries */}
      <Card className="p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Calendar className="h-5 w-5 text-slate-400" />
          <h3 className="text-lg font-semibold text-slate-200">Active Crontab Entries</h3>
        </div>
        {scheduleInfo.entries.length === 0 ? (
          <div className="text-slate-500 text-sm">No crontab entries found.</div>
        ) : (
          <div className="space-y-2">
            {scheduleInfo.entries.map((entry, idx) => (
              <div key={idx} className="bg-slate-950/50 rounded-lg p-3 font-mono text-sm text-slate-300 border border-slate-800">
                {entry}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* F. Save & Install Button */}
      {editState.isEditing && (
        <div className="flex items-center justify-end space-x-4 pt-4 border-t border-slate-800">
          <Button variant="ghost" onClick={handleCancelEdit}>
            Cancel
          </Button>
          <Button onClick={handleSaveAndInstall} loading={saving}>
            <Check className="h-4 w-4 mr-2" />
            Save & Install
          </Button>
        </div>
      )}
    </div>
  );
};

export default Scheduling;
