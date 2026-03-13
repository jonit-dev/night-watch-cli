import { useState, useCallback } from 'react';
import type { IJobProviders, IProviderPreset } from '../api.js';
import { updateConfig } from '../api.js';
import { useStore } from '../store/useStore.js';
import { BUILT_IN_PRESET_IDS, BUILT_IN_PRESETS } from '../constants/presets.js';

interface IDeleteWarning {
  presetId: string;
  presetName: string;
  references: string[];
}

export function usePresetManagement(
  providerPresets: Record<string, IProviderPreset>,
  provider: string,
  jobProviders: IJobProviders,
  updateField: (key: string, value: unknown) => void,
) {
  const { addToast } = useStore();

  // Preset modal state
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPreset, setEditingPreset] = useState<IProviderPreset | null>(null);
  const [deleteWarning, setDeleteWarning] = useState<IDeleteWarning | null>(null);

  const getAllPresets = useCallback((): Record<string, IProviderPreset> => {
    return { ...BUILT_IN_PRESETS, ...providerPresets };
  }, [providerPresets]);

  const getPresetOptions = useCallback(
    (_customPresets: Record<string, IProviderPreset>): Array<{ label: string; value: string }> => {
      const allPresets = getAllPresets();
      return Object.entries(allPresets).map(([id, preset]) => ({
        label: preset.name,
        value: id,
      }));
    },
    [getAllPresets],
  );

  const getPresetReferences = useCallback(
    (presetId: string): string[] => {
      const references: string[] = [];

      if (provider === presetId) {
        references.push('Global Provider');
      }

      const jobLabels: Record<string, string> = {
        executor: 'Executor',
        reviewer: 'Reviewer',
        qa: 'QA',
        audit: 'Audit',
        slicer: 'Planner',
        analytics: 'Analytics',
      };

      for (const [jobType, assignedProvider] of Object.entries(jobProviders)) {
        if (assignedProvider === presetId) {
          references.push(jobLabels[jobType] ?? jobType);
        }
      }

      return references;
    },
    [provider, jobProviders],
  );

  const handleAddPreset = useCallback(() => {
    setEditingPresetId(null);
    setEditingPreset(null);
    setPresetModalOpen(true);
  }, []);

  const handleEditPreset = useCallback(
    (presetId: string) => {
      const allPresets = getAllPresets();
      const preset = allPresets[presetId];
      if (preset) {
        setEditingPresetId(presetId);
        setEditingPreset(preset);
        setPresetModalOpen(true);
      }
    },
    [getAllPresets],
  );

  const handleSavePreset = useCallback(
    async (presetId: string, preset: IProviderPreset) => {
      const isNew = !editingPresetId;
      const updatedPresets = { ...providerPresets, [presetId]: preset };
      updateField('providerPresets', updatedPresets);

      try {
        await updateConfig({ providerPresets: { [presetId]: preset } });
        addToast({
          title: isNew ? 'Preset Added' : 'Preset Updated',
          message: isNew
            ? `${preset.name} has been added. You can now assign it to jobs.`
            : `${preset.name} has been saved.`,
          type: 'success',
        });
      } catch (err) {
        addToast({
          title: 'Save Failed',
          message: err instanceof Error ? err.message : 'Failed to save preset',
          type: 'error',
        });
        // Revert local state on failure
        updateField('providerPresets', providerPresets);
      }
    },
    [editingPresetId, providerPresets, updateField, addToast],
  );

  const handleDeletePreset = useCallback(
    (presetId: string) => {
      if ((BUILT_IN_PRESET_IDS as readonly string[]).includes(presetId)) {
        addToast({
          title: 'Cannot Delete',
          message: 'Built-in presets cannot be deleted.',
          type: 'error',
        });
        return;
      }

      const references = getPresetReferences(presetId);
      if (references.length > 0) {
        setDeleteWarning({
          presetId,
          presetName: getAllPresets()[presetId]?.name ?? presetId,
          references,
        });
        return;
      }

      const updatedPresets = { ...providerPresets };
      delete updatedPresets[presetId];
      updateField('providerPresets', updatedPresets);

      addToast({
        title: 'Preset Deleted',
        message: `${getAllPresets()[presetId]?.name ?? presetId} has been removed.`,
        type: 'success',
      });
    },
    [providerPresets, updateField, addToast, getPresetReferences, getAllPresets],
  );

  const handleResetPreset = useCallback(
    (presetId: string) => {
      const updatedPresets = { ...providerPresets };
      delete updatedPresets[presetId];
      updateField('providerPresets', updatedPresets);

      addToast({
        title: 'Preset Reset',
        message: `${presetId} has been reset to built-in defaults.`,
        type: 'success',
      });
    },
    [providerPresets, updateField, addToast],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!deleteWarning) return;

    const { presetId } = deleteWarning;
    const updatedPresets = { ...providerPresets };
    delete updatedPresets[presetId];
    updateField('providerPresets', updatedPresets);

    // Also clear any job assignments that reference this preset
    const newJobProviders = { ...jobProviders };
    for (const key of Object.keys(newJobProviders)) {
      if (newJobProviders[key as keyof IJobProviders] === presetId) {
        delete newJobProviders[key as keyof IJobProviders];
      }
    }
    updateField('jobProviders', newJobProviders);

    // Clear global provider if it was this preset
    if (provider === presetId) {
      updateField('provider', 'claude');
    }

    setDeleteWarning(null);
    addToast({
      title: 'Preset Deleted',
      message: `${deleteWarning.presetName} has been removed and all references cleared.`,
      type: 'success',
    });
  }, [deleteWarning, providerPresets, jobProviders, provider, updateField, addToast]);

  return {
    // Modal state
    presetModalOpen,
    setPresetModalOpen,
    editingPresetId,
    editingPreset,
    deleteWarning,
    setDeleteWarning,

    // Computed
    getAllPresets,
    getPresetOptions,
    getPresetReferences,

    // Actions
    handleAddPreset,
    handleEditPreset,
    handleSavePreset,
    handleDeletePreset,
    handleResetPreset,
    handleConfirmDelete,
  };
}
