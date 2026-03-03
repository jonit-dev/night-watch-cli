import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Modal from '../../ui/Modal';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import GenerationSettingsStep from './new-campaign-modal/GenerationSettingsStep.js';
import {
  campaignSchema,
  CampaignFormData,
  DEFAULT_CAMPAIGN_VALUES,
} from './new-campaign-modal/validationSchema.js';
import type { IArticleStylePreferences } from '@shared/types';

interface INewCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ICampaignSubmitData) => Promise<void>;
  projectDefaults?: Partial<IArticleStylePreferences>;
}

export interface ICampaignSubmitData {
  name: string;
  keyword: string;
  tone?: string;
  wordCount?: number;
  aiModel?: string;
  imagePreset?: string | null;
  autoPublish?: boolean;
  // Outrank fields
  articleStyle?: IArticleStylePreferences['articleStyle'];
  internalLinksCount?: number;
  globalInstructions?: string;
  includeYoutube?: boolean;
  includeCta?: boolean;
  includeEmojis?: boolean;
  includeInfographics?: boolean;
  imageStyle?: IArticleStylePreferences['imageStyle'];
}

type Step = 1 | 2 | 3;

const NewCampaignModal: React.FC<INewCampaignModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  projectDefaults,
}) => {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<CampaignFormData>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      ...DEFAULT_CAMPAIGN_VALUES,
      // Override with project defaults if provided
      articleStyle: projectDefaults?.articleStyle ?? DEFAULT_CAMPAIGN_VALUES.articleStyle,
      internalLinksCount:
        projectDefaults?.internalLinksCount ?? DEFAULT_CAMPAIGN_VALUES.internalLinksCount,
      globalInstructions:
        projectDefaults?.globalInstructions ?? DEFAULT_CAMPAIGN_VALUES.globalInstructions,
      includeYoutube: projectDefaults?.includeYoutube ?? DEFAULT_CAMPAIGN_VALUES.includeYoutube,
      includeCta: projectDefaults?.includeCta ?? DEFAULT_CAMPAIGN_VALUES.includeCta,
      includeEmojis: projectDefaults?.includeEmojis ?? DEFAULT_CAMPAIGN_VALUES.includeEmojis,
      includeInfographics:
        projectDefaults?.includeInfographics ?? DEFAULT_CAMPAIGN_VALUES.includeInfographics,
      imageStyle: projectDefaults?.imageStyle ?? DEFAULT_CAMPAIGN_VALUES.imageStyle,
    },
  });

  const {
    register,
    formState: { errors },
    handleSubmit,
    reset,
  } = form;

  const handleNext = () => {
    if (currentStep < 3) {
      setCurrentStep((currentStep + 1) as Step);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as Step);
    }
  };

  const handleLaunch = async (data: CampaignFormData) => {
    setIsSubmitting(true);
    try {
      const submitData: ICampaignSubmitData = {
        name: data.name,
        keyword: data.keyword,
        tone: data.tone,
        wordCount: data.wordCount,
        aiModel: data.aiModel,
        imagePreset: data.imagePreset,
        autoPublish: data.autoPublish,
        // Include outrank fields
        articleStyle: data.articleStyle,
        internalLinksCount: data.internalLinksCount,
        globalInstructions: data.globalInstructions,
        includeYoutube: data.includeYoutube,
        includeCta: data.includeCta,
        includeEmojis: data.includeEmojis,
        includeInfographics: data.includeInfographics,
        imageStyle: data.imageStyle,
      };

      await onSubmit(submitData);
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    reset();
    setCurrentStep(1);
    onClose();
  };

  const stepTitles = ['Basic Info', 'Content Style', 'Review'];

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create New Campaign">
      <div className="space-y-6">
        {/* Step Indicator */}
        <div className="flex items-center justify-center space-x-4">
          {stepTitles.map((title, index) => {
            const stepNum = (index + 1) as Step;
            const isActive = stepNum === currentStep;
            const isCompleted = stepNum < currentStep;

            return (
              <React.Fragment key={stepNum}>
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-600 text-white'
                        : isCompleted
                          ? 'bg-green-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {isCompleted ? '✓' : stepNum}
                  </div>
                  <span
                    className={`text-sm ${
                      isActive ? 'text-slate-200' : 'text-slate-500'
                    }`}
                  >
                    {title}
                  </span>
                </div>
                {index < stepTitles.length - 1 && (
                  <div className="w-12 h-px bg-slate-700" />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Step Content */}
        <form onSubmit={handleSubmit(handleLaunch)}>
          {currentStep === 1 && (
            <div className="space-y-4">
              <Input
                label="Campaign Name"
                placeholder="Enter campaign name..."
                error={errors.name?.message}
                {...register('name')}
              />
              <Input
                label="Target Keyword"
                placeholder="Enter target keyword..."
                error={errors.keyword?.message}
                {...register('keyword')}
              />
            </div>
          )}

          {currentStep === 2 && <GenerationSettingsStep form={form} />}

          {currentStep === 3 && (
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-slate-300 mb-3">Review Campaign</h4>
              <div className="bg-slate-950/50 rounded-lg border border-slate-800 p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Name:</span>
                  <span className="text-sm text-slate-200">{form.watch('name')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Keyword:</span>
                  <span className="text-sm text-slate-200">{form.watch('keyword')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Tone:</span>
                  <span className="text-sm text-slate-200">{form.watch('tone') || 'Not set'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Word Count:</span>
                  <span className="text-sm text-slate-200">{form.watch('wordCount') || 'Not set'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Article Style:</span>
                  <span className="text-sm text-slate-200 capitalize">
                    {form.watch('articleStyle') || 'Not set'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Internal Links:</span>
                  <span className="text-sm text-slate-200">{form.watch('internalLinksCount') ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">YouTube:</span>
                  <span className="text-sm text-slate-200">
                    {form.watch('includeYoutube') ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">CTA:</span>
                  <span className="text-sm text-slate-200">
                    {form.watch('includeCta') ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Emojis:</span>
                  <span className="text-sm text-slate-200">
                    {form.watch('includeEmojis') ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-400">Infographics:</span>
                  <span className="text-sm text-slate-200">
                    {form.watch('includeInfographics') ? 'Yes' : 'No'}
                  </span>
                </div>
                {form.watch('imagePreset') && (
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-400">Image Style:</span>
                    <span className="text-sm text-slate-200 capitalize">
                      {form.watch('imageStyle') || 'Not set'}
                    </span>
                  </div>
                )}
                {form.watch('globalInstructions') && (
                  <div className="pt-2 border-t border-slate-700">
                    <span className="text-sm text-slate-400 block mb-1">Global Instructions:</span>
                    <p className="text-sm text-slate-300 bg-slate-900/50 p-2 rounded">
                      {form.watch('globalInstructions')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-6 pt-4 border-t border-slate-800">
            <Button
              type="button"
              variant="ghost"
              onClick={currentStep === 1 ? handleClose : handleBack}
              disabled={isSubmitting}
            >
              {currentStep === 1 ? 'Cancel' : 'Back'}
            </Button>

            {currentStep < 3 ? (
              <Button type="button" onClick={handleNext}>
                Next
              </Button>
            ) : (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Campaign'}
              </Button>
            )}
          </div>
        </form>
      </div>
    </Modal>
  );
};

export default NewCampaignModal;
