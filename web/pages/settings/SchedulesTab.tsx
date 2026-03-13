import React from 'react';
import { INightWatchConfig } from '../../api.js';
import ScheduleConfig, { IScheduleConfigForm } from '../../components/scheduling/ScheduleConfig.js';
import { IScheduleTemplate } from '../../utils/cron.js';

interface ISchedulesTabProps {
  form: IScheduleConfigForm;
  scheduleMode: 'template' | 'custom';
  selectedTemplateId: string | null;
  onFieldChange: (field: string, value: unknown) => void;
  onSwitchToTemplate: () => void;
  onSwitchToCustom: () => void;
  onApplyTemplate: (tpl: IScheduleTemplate) => void;
  allProjectConfigs?: Array<{ projectId: string; config: INightWatchConfig }>;
  currentProjectId?: string;
  onEditJob?: (projectId: string, jobType: string) => void;
}

const SchedulesTab: React.FC<ISchedulesTabProps> = ({
  form,
  scheduleMode,
  selectedTemplateId,
  onFieldChange,
  onSwitchToTemplate,
  onSwitchToCustom,
  onApplyTemplate,
  allProjectConfigs,
  currentProjectId,
  onEditJob,
}) => {
  return (
    <ScheduleConfig
      form={form}
      scheduleMode={scheduleMode}
      selectedTemplateId={selectedTemplateId}
      onFieldChange={onFieldChange}
      onSwitchToTemplate={onSwitchToTemplate}
      onSwitchToCustom={onSwitchToCustom}
      onApplyTemplate={onApplyTemplate}
      allProjectConfigs={allProjectConfigs}
      currentProjectId={currentProjectId}
      onEditJob={onEditJob}
    />
  );
};

export default SchedulesTab;
