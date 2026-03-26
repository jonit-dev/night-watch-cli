import { Edit2, Plus, Trash2 } from 'lucide-react';
import React from 'react';
import { DayOfWeek, IProviderScheduleOverride, JobType } from '../../api';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Switch from '../ui/Switch';

const DAY_LABELS: Record<DayOfWeek, string> = {
  0: 'Su',
  1: 'Mo',
  2: 'Tu',
  3: 'We',
  4: 'Th',
  5: 'Fr',
  6: 'Sa',
};

const JOB_TYPE_LABELS: Record<JobType, string> = {
  executor: 'Executor',
  reviewer: 'Reviewer',
  qa: 'QA',
  audit: 'Audit',
  slicer: 'Planner',
  analytics: 'Analytics',
  planner: 'Planner',
};

const emptyOverride: IProviderScheduleOverride = {
  label: '',
  presetId: '',
  days: [1, 2, 3, 4, 5],
  startTime: '23:00',
  endTime: '04:00',
  jobTypes: null,
  enabled: true,
};

interface IScheduleOverrideEditorProps {
  overrides: IProviderScheduleOverride[];
  onChange: (overrides: IProviderScheduleOverride[]) => void;
  presetOptions: Array<{ label: string; value: string }>;
}

interface IOverrideFormProps {
  override: IProviderScheduleOverride;
  onChange: (override: IProviderScheduleOverride) => void;
  onSave: () => void;
  onCancel: () => void;
  isNew?: boolean;
  presetOptions: Array<{ label: string; value: string }>;
}

const OverrideForm: React.FC<IOverrideFormProps> = ({
  override,
  onChange,
  onSave,
  onCancel,
  isNew,
  presetOptions,
}) => {
  const toggleDay = (day: DayOfWeek) => {
    const newDays = override.days.includes(day)
      ? override.days.filter((d) => d !== day)
      : [...override.days, day].sort((a, b) => a - b);
    onChange({ ...override, days: newDays });
  };

  const selectWeekdays = () => {
    onChange({ ...override, days: [1, 2, 3, 4, 5] });
  };

  const selectWeekend = () => {
    onChange({ ...override, days: [0, 6] });
  };

  const selectAll = () => {
    onChange({ ...override, days: [0, 1, 2, 3, 4, 5, 6] });
  };

  const setAllJobs = () => {
    onChange({ ...override, jobTypes: null });
  };

  const toggleJobType = (jobType: JobType) => {
    const current = override.jobTypes ?? [];
    const newJobTypes = current.includes(jobType)
      ? current.filter((jt) => jt !== jobType)
      : [...current, jobType];

    onChange({
      ...override,
      jobTypes: newJobTypes.length === 0 ? null : newJobTypes,
    });
  };

  const isAllJobs = override.jobTypes === null || override.jobTypes === undefined;

  const isValid =
    override.label.trim().length > 0 &&
    override.presetId.trim().length > 0 &&
    override.days.length > 0 &&
    override.startTime.trim().length > 0 &&
    override.endTime.trim().length > 0;

  return (
    <div className="p-4 rounded-md border border-slate-700 bg-slate-900/50 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Label"
          value={override.label}
          onChange={(e) => onChange({ ...override, label: e.target.value })}
          placeholder="e.g., Night Hours"
          required
        />
        <Select
          label="Provider"
          value={override.presetId}
          onChange={(val) => onChange({ ...override, presetId: val })}
          options={presetOptions}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-400 mb-2">Days</label>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(DAY_LABELS) as unknown as DayOfWeek[]).map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`w-10 h-10 rounded-md text-sm font-medium transition-colors ${
                override.days.includes(day)
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {DAY_LABELS[day]}
            </button>
          ))}
          <div className="flex gap-1 ml-2">
            <button
              type="button"
              onClick={selectWeekdays}
              className="px-3 py-2 text-xs rounded-md bg-slate-800 text-slate-400 hover:bg-slate-700 transition-colors"
            >
              Weekdays
            </button>
            <button
              type="button"
              onClick={selectWeekend}
              className="px-3 py-2 text-xs rounded-md bg-slate-800 text-slate-400 hover:bg-slate-700 transition-colors"
            >
              Weekend
            </button>
            <button
              type="button"
              onClick={selectAll}
              className="px-3 py-2 text-xs rounded-md bg-slate-800 text-slate-400 hover:bg-slate-700 transition-colors"
            >
              All
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">Start Time</label>
          <input
            type="time"
            value={override.startTime}
            onChange={(e) => onChange({ ...override, startTime: e.target.value })}
            className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">End Time</label>
          <input
            type="time"
            value={override.endTime}
            onChange={(e) => onChange({ ...override, endTime: e.target.value })}
            className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-slate-400">Job Types</label>
          <button
            type="button"
            onClick={setAllJobs}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {isAllJobs ? 'All Jobs Selected' : 'Select All Jobs'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(JOB_TYPE_LABELS) as unknown as JobType[])
            .filter((jt) => jt !== 'planner')
            .map((jobType) => {
              const isSelected = isAllJobs || (override.jobTypes?.includes(jobType) ?? false);
              return (
                <button
                  key={jobType}
                  type="button"
                  onClick={() => toggleJobType(jobType)}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    isSelected
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                  disabled={isAllJobs}
                >
                  {JOB_TYPE_LABELS[jobType]}
                </button>
              );
            })}
        </div>
        {isAllJobs && (
          <p className="text-xs text-slate-500 mt-1">This override applies to all job types.</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={override.enabled}
          onChange={(checked) => onChange({ ...override, enabled: checked })}
          label="Enabled"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={!isValid}>
          {isNew ? 'Add Override' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
};

const ScheduleOverrideEditor: React.FC<IScheduleOverrideEditorProps> = ({
  overrides,
  onChange,
  presetOptions,
}) => {
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [newOverride, setNewOverride] = React.useState<IProviderScheduleOverride>(emptyOverride);

  const handleAddOverride = () => {
    onChange([...overrides, newOverride]);
    setNewOverride({ ...emptyOverride });
    setShowAddForm(false);
  };

  const handleUpdateOverride = (index: number, override: IProviderScheduleOverride) => {
    const updated = [...overrides];
    updated[index] = override;
    onChange(updated);
  };

  const handleDeleteOverride = (index: number) => {
    if (window.confirm('Are you sure you want to delete this schedule override?')) {
      onChange(overrides.filter((_, i) => i !== index));
    }
  };

  const handleToggleEnabled = (index: number) => {
    const updated = [...overrides];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    onChange(updated);
  };

  const formatDays = (days: DayOfWeek[]): string => {
    if (days.length === 7) return 'Every day';
    if (days.length === 5 && days.every((d) => d >= 1 && d <= 5)) return 'Weekdays';
    if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends';

    return days.map((d) => DAY_LABELS[d]).join(', ');
  };

  const formatJobScope = (jobTypes: IProviderScheduleOverride['jobTypes']): string => {
    if (!jobTypes || jobTypes.length === 0) return 'All Jobs';
    return jobTypes.map((jt) => JOB_TYPE_LABELS[jt]).join(', ');
  };

  const getPresetName = (presetId: string): string => {
    const preset = presetOptions.find((p) => p.value === presetId);
    return preset?.label || presetId;
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {overrides.length === 0 ? (
          <p className="text-slate-500 text-sm italic">No schedule overrides configured.</p>
        ) : (
          overrides.map((override, index) => (
            <div key={index}>
              {editingIndex === index ? (
                <OverrideForm
                  override={override}
                  onChange={(o) => handleUpdateOverride(index, o)}
                  onSave={() => setEditingIndex(null)}
                  onCancel={() => setEditingIndex(null)}
                  presetOptions={presetOptions}
                />
              ) : (
                <div
                  className={`flex items-start justify-between p-4 rounded-md border bg-slate-950/40 ${
                    override.enabled
                      ? 'border-slate-800'
                      : 'border-slate-800/50 opacity-60'
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <Switch
                        checked={override.enabled}
                        onChange={() => handleToggleEnabled(index)}
                      />
                      <span className="text-slate-100 font-medium">{override.label}</span>
                    </div>
                    <div className="text-sm text-slate-400 ml-11">
                      <span className="text-indigo-400">{getPresetName(override.presetId)}</span>
                      {' · '}
                      {formatDays(override.days)}
                      {' · '}
                      {override.startTime} - {override.endTime}
                      {' · '}
                      {formatJobScope(override.jobTypes)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingIndex(index)}
                      className="p-2 text-slate-400 hover:text-slate-200"
                      aria-label={`Edit ${override.label}`}
                      title={`Edit ${override.label}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteOverride(index)}
                      className="p-2 text-red-400 hover:text-red-300"
                      aria-label={`Delete ${override.label}`}
                      title={`Delete ${override.label}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showAddForm ? (
        <OverrideForm
          override={newOverride}
          onChange={setNewOverride}
          onSave={handleAddOverride}
          onCancel={() => {
            setShowAddForm(false);
            setNewOverride({ ...emptyOverride });
          }}
          isNew
          presetOptions={presetOptions}
        />
      ) : (
        <Button variant="ghost" onClick={() => setShowAddForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Schedule Override
        </Button>
      )}
    </div>
  );
};

export default ScheduleOverrideEditor;
