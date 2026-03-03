import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import Select from '../../../ui/Select';
import Switch from '../../../ui/Switch';
import type { CampaignFormData } from './validationSchema.js';
import {
  ARTICLE_STYLE_OPTIONS,
  INTERNAL_LINKS_OPTIONS,
  IMAGE_STYLE_OPTIONS,
  TONE_OPTIONS,
  WORD_COUNT_OPTIONS,
  CONTENT_TOGGLE_CONFIGS,
} from './constants.js';

interface IGenerationSettingsStepProps {
  form: UseFormReturn<CampaignFormData>;
}

const GenerationSettingsStep: React.FC<IGenerationSettingsStepProps> = ({
  form,
}) => {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = form;

  const watchGlobalInstructions = watch('globalInstructions') || '';
  const watchImagePreset = watch('imagePreset');
  const watchArticleStyle = watch('articleStyle');
  const watchInternalLinksCount = watch('internalLinksCount');
  const watchTone = watch('tone');
  const watchWordCount = watch('wordCount');
  const watchImageStyle = watch('imageStyle');
  const watchIncludeYoutube = watch('includeYoutube');
  const watchIncludeCta = watch('includeCta');
  const watchIncludeEmojis = watch('includeEmojis');
  const watchIncludeInfographics = watch('includeInfographics');

  const handleSelectChange = (field: keyof CampaignFormData) => (value: string) => {
    if (field === 'internalLinksCount' || field === 'wordCount') {
      setValue(field, parseInt(value, 10) || 0, { shouldValidate: true });
    } else {
      setValue(field, value, { shouldValidate: true });
    }
  };

  const handleSwitchChange = (field: keyof CampaignFormData) => (checked: boolean) => {
    setValue(field, checked, { shouldValidate: true });
  };

  return (
    <div className="space-y-6">
      {/* Tone and Word Count Section */}
      <div>
        <h4 className="text-sm font-medium text-slate-300 mb-3">Basic Settings</h4>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Tone"
            options={TONE_OPTIONS}
            value={watchTone || ''}
            onChange={handleSelectChange('tone')}
            error={errors.tone?.message}
          />
          <Select
            label="Word Count"
            options={WORD_COUNT_OPTIONS}
            value={watchWordCount || 1500}
            onChange={handleSelectChange('wordCount')}
            error={errors.wordCount?.message}
          />
        </div>
      </div>

      {/* Content Style Section */}
      <div>
        <h4 className="text-sm font-medium text-slate-300 mb-3">Content Style</h4>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Article Style"
            options={ARTICLE_STYLE_OPTIONS}
            value={watchArticleStyle || 'informative'}
            onChange={handleSelectChange('articleStyle')}
            helperText="Structure of the article"
          />
          <Select
            label="Internal Links"
            options={INTERNAL_LINKS_OPTIONS}
            value={watchInternalLinksCount ?? 2}
            onChange={handleSelectChange('internalLinksCount')}
            helperText="Number of internal links to include"
          />
        </div>
      </div>

      {/* Global Instructions */}
      <div>
        <label className="block text-sm font-medium text-slate-400 mb-1.5">
          Global Instructions
        </label>
        <textarea
          {...register('globalInstructions')}
          className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all duration-200 min-h-[100px] resize-y"
          placeholder="Add any specific instructions for the AI to follow when generating content..."
          maxLength={2000}
        />
        <div className="flex justify-between mt-1.5">
          {errors.globalInstructions ? (
            <p className="text-xs text-red-400">{errors.globalInstructions.message}</p>
          ) : (
            <p className="text-xs text-slate-500">Custom instructions for article generation</p>
          )}
          <p className="text-xs text-slate-500 ml-auto">
            {watchGlobalInstructions.length}/2000
          </p>
        </div>
      </div>

      {/* Content Toggles */}
      <div>
        <h4 className="text-sm font-medium text-slate-300 mb-3">Content Options</h4>
        <div className="grid grid-cols-2 gap-4">
          {CONTENT_TOGGLE_CONFIGS.map((config) => {
            const currentValue =
              config.key === 'includeYoutube'
                ? watchIncludeYoutube
                : config.key === 'includeCta'
                  ? watchIncludeCta
                  : config.key === 'includeEmojis'
                    ? watchIncludeEmojis
                    : watchIncludeInfographics;

            return (
              <div
                key={config.key}
                className="flex flex-col space-y-1 p-3 bg-slate-950/50 rounded-lg border border-slate-800"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">{config.label}</span>
                  <Switch
                    checked={currentValue ?? false}
                    onChange={handleSwitchChange(config.key)}
                  />
                </div>
                <span className="text-xs text-slate-500">{config.description}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Image Style - Only show if imagePreset is set */}
      {watchImagePreset && (
        <div>
          <h4 className="text-sm font-medium text-slate-300 mb-3">Image Settings</h4>
          <Select
            label="Image Style"
            options={IMAGE_STYLE_OPTIONS}
            value={watchImageStyle || 'brand_text'}
            onChange={handleSelectChange('imageStyle')}
            helperText="Visual style for generated images"
          />
        </div>
      )}
    </div>
  );
};

export default GenerationSettingsStep;
