import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { IProviderPreset } from '../../api.js';
import PresetCard from '../../components/providers/PresetCard.js';
import PresetFormModal from '../../components/providers/PresetFormModal.js';

const glmPreset: IProviderPreset = {
  name: 'GLM-5',
  command: 'claude',
  modelFlag: '--model',
  model: 'glm-5',
  envVars: {
    ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
  },
};

describe('GLM preset warnings', () => {
  it('shows a missing key warning on the preset card for GLM presets without ANTHROPIC_API_KEY', () => {
    render(
      <PresetCard
        presetId="glm-5"
        preset={glmPreset}
        isBuiltIn
        onEdit={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByText('Missing ANTHROPIC_API_KEY')).toBeInTheDocument();
  });

  it('shows a warning in the edit preset modal for GLM presets without ANTHROPIC_API_KEY', () => {
    render(
      <PresetFormModal
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        presetId="glm-5"
        preset={glmPreset}
        isBuiltIn
        existingIds={['glm-5']}
      />,
    );

    expect(screen.getByText('GLM presets require `ANTHROPIC_API_KEY`.')).toBeInTheDocument();
    expect(
      screen.getByText('Add `ANTHROPIC_API_KEY` in Environment Variables before using this preset.'),
    ).toBeInTheDocument();
  });

  it('does not show the warning when ANTHROPIC_API_KEY is present', () => {
    render(
      <PresetFormModal
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        presetId="glm-5"
        preset={{
          ...glmPreset,
          envVars: {
            ...glmPreset.envVars,
            ANTHROPIC_API_KEY: 'test-key',
          },
        }}
        isBuiltIn
        existingIds={['glm-5']}
      />,
    );

    expect(screen.queryByText('GLM presets require `ANTHROPIC_API_KEY`.')).not.toBeInTheDocument();
  });
});
