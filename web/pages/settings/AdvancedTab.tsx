import React from 'react';
import TagInput from '../../components/settings/TagInput.js';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';

interface IAdvancedFormFields {
  templatesDir: string;
  maxRetries: number;
  prdPriority: string[];
}

interface IAdvancedTabProps {
  form: IAdvancedFormFields;
  updateField: <K extends keyof IAdvancedFormFields>(key: K, value: IAdvancedFormFields[K]) => void;
}

const AdvancedTab: React.FC<IAdvancedTabProps> = ({ form, updateField }) => {
  return (
    <Card className="p-6 space-y-6">
      <h3 className="text-lg font-medium text-slate-200">Advanced Settings</h3>
      <p className="text-sm text-slate-400">Templates, retry policy, and PRD execution priority</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Input
          label="Templates Directory"
          value={form.templatesDir}
          onChange={(e) => updateField('templatesDir', e.target.value)}
          helperText="Directory for custom template overrides"
        />
        <Input
          label="Max Retries"
          type="number"
          min="1"
          value={String(form.maxRetries)}
          onChange={(e) => {
            const val = Math.max(1, Number(e.target.value || 1));
            updateField('maxRetries', val);
          }}
          helperText="Retry attempts for rate-limited API calls"
        />
      </div>

      <div className="pt-4 border-t border-slate-800 space-y-4">
        <TagInput
          label="PRD Priority"
          value={form.prdPriority}
          onChange={(priority) => updateField('prdPriority', priority)}
          placeholder="e.g., feature-x"
          helpText="PRDs matching these names are executed first"
        />
      </div>
    </Card>
  );
};

export default AdvancedTab;
