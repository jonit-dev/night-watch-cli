import React from 'react';
import Input from './Input';
import Select from './Select';
import { CRON_PRESETS, getPresetValue, cronToHuman } from '../../utils/cron';

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
  placeholder = '0 0-21 * * *',
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
    <div className="space-y-2">
      <Select
        label={label}
        value={presetValue}
        onChange={handlePresetChange}
        options={CRON_PRESETS.map((p) => ({ label: p.label, value: p.value }))}
        helperText={currentPreset?.description || helperText}
      />
      {isCustom && (
        <>
          <Input
            label="Custom Cron Expression"
            value={value}
            onChange={handleCustomChange}
            helperText="Custom cron expression (format: minute hour day month weekday)"
            placeholder={placeholder}
          />
          <div className="text-xs text-slate-500 mt-1">
            <strong>Cron format:</strong> minute hour day month weekday
            <br />
            <strong>Examples:</strong> <code>0 * * * *</code> (hourly),{' '}
            <code>0 0 * * *</code> (daily at midnight),{' '}
            <code>0 0-21/3 * * *</code> (every 3 hours from 0-21)
          </div>
        </>
      )}
      {!isCustom && (
        <div className="text-sm text-slate-400 mt-1">
          <span className="text-slate-500">Schedule:</span>{' '}
          <span className="text-slate-200">{cronToHuman(value)}</span>
        </div>
      )}
    </div>
  );
};

export default CronScheduleInput;
