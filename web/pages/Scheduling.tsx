import React, { useEffect, useState } from 'react';
import { Pause, Play, Clock, Edit, Check, AlertCircle, Calendar } from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
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
      refetchSchedule();
    } catch (error) {
      addToast({
        title: 'Action Failed',
        message: error instanceof Error ? error.message : 'Failed to toggle schedule state',
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
      // Update config with new schedules
      await updateConfig({
        cronSchedule: editState.executorSchedule,
        reviewerSchedule: editState.reviewerSchedule,
      });

      // Install cron with new schedules
      await triggerInstallCron();

      addToast({
        title: 'Schedule Updated',
        message: 'Cron schedules have been saved and installed.',
        type: 'success',
      });

      setEditState(prev => ({ ...prev, isEditing: false }));
      refetchConfig();
      refetchSchedule();
    } catch (error) {
      addToast({
        title: 'Save Failed',
        message: error instanceof Error ? error.message : 'Failed to save schedules',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const renderNextRun = (nextRunStr: string | null | undefined, _cronExpr: string) => {
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

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-100">Scheduling</h1>
      </div>

      {/* A. Status Banner */}
      <Card className={`p-6 border-2 ${statusColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Clock className="h-8 w-8" />
            <div>
              <div className="text-sm text-slate-400">Cron Status</div>
              <div className="text-2xl font-bold">{statusText}</div>
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
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-200">Executor Schedule</h3>
            {!editState.isEditing && (
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
              (val) => setEditState(prev => ({ ...prev, executorSchedule: val }))
            )
          ) : (
            <>
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-slate-400 mb-1">Schedule</div>
                  <div className="text-lg text-slate-200 font-medium">{cronToHuman(config.cronSchedule)}</div>
                  <div className="text-xs text-slate-500 font-mono mt-1">{config.cronSchedule}</div>
                </div>
                <div>
                  <div className="text-sm text-slate-400 mb-1">Next Run</div>
                  {renderNextRun(scheduleInfo.executor.nextRun, config.cronSchedule)}
                </div>
                <div className={`flex items-center space-x-2 text-sm ${scheduleInfo.executor.installed ? 'text-green-400' : 'text-amber-400'}`}>
                  <Check className="h-4 w-4" />
                  <span>{scheduleInfo.executor.installed ? 'Installed' : 'Not installed'}</span>
                </div>
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
                      <div className="text-lg text-slate-200 font-medium">{cronToHuman(config.reviewerSchedule)}</div>
                      <div className="text-xs text-slate-500 font-mono mt-1">{config.reviewerSchedule}</div>
                    </div>
                    <div>
                      <div className="text-sm text-slate-400 mb-1">Next Run</div>
                      {renderNextRun(scheduleInfo.reviewer.nextRun, config.reviewerSchedule)}
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

      {/* C. Active Crontab Entries */}
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

      {/* D. Save & Install Button */}
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
