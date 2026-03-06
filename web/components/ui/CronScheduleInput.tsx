import React from 'react';
import { CRON_PRESETS, getPresetValue } from '../../utils/cron';
import Input from './Input';
import Select from './Select';

interface CronScheduleInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helperText?: string;
  placeholder?: string;
}

const CronScheduleInput: React.FC<CronScheduleInputProps> = ({
  label,
  value,
  onChange,
  helperText,
  placeholder = '5 */3 * * *',
}) => {
  const presetValue = getPresetValue(value);
  const isCustom = presetValue === '__custom__';

  const handlePresetChange = (newValue: string) => {
    if (newValue !== '__custom__') {
      onChange(newValue);
    }
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const currentPreset = CRON_PRESETS.find((p) => p.value === presetValue);

  return (
    <div className="space-y-3">
      <Select
        label={label}
        value={presetValue}
        onChange={handlePresetChange}
        options={CRON_PRESETS.map((p) => ({ label: p.label, value: p.value }))}
        helperText={isCustom ? undefined : currentPreset?.description || helperText}
      />
      {isCustom && (
        <div className="space-y-2 mt-2">
          <Input
            label="Cron Expression"
            value={value}
            onChange={handleCustomChange}
            placeholder={placeholder}
          />
          <div className="text-xs text-slate-500 bg-slate-900/40 p-3 rounded-md border border-slate-800/60">
            <strong className="text-slate-400">Format:</strong> minute hour day month weekday
            <br />
            <strong className="text-slate-400">Examples:</strong>{' '}
            <code className="bg-slate-950 px-1 py-0.5 rounded text-indigo-300">0 * * * *</code> (hourly),{' '}
            <code className="bg-slate-950 px-1 py-0.5 rounded text-indigo-300">0 0 * * *</code> (daily at midnight)
          </div>
        </div>
      )}
    </div>
  );
};

export default CronScheduleInput;
