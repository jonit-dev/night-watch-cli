import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PatternList from '../PatternList.js';

const now = Date.now();

describe('PatternList', () => {
  it('should disable augmentation', async () => {
    const onAugmentationAction = vi.fn();

    render(
      <PatternList
        activePatterns={[]}
        topFailurePatterns={[]}
        augmentations={[
          {
            id: 3,
            projectPath: '/tmp/night-watch',
            patternId: null,
            jobType: 'reviewer',
            promptText: 'Prefer the known fix for flaky tests.',
            status: 'active',
            createdAt: now,
            updatedAt: now,
            expiresAt: null,
            appliedCount: 4,
            successCount: 3,
          },
        ]}
        onAugmentationAction={onAugmentationAction}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /disable/i }));

    expect(onAugmentationAction).toHaveBeenCalledWith(3, 'disable');
  });
});
