/**
 * Tests for project feedback prompt augmentation rendering.
 */

import { describe, expect, it } from 'vitest';

import {
  renderProjectFeedbackBlock,
  selectPromptAugmentations,
} from '../../feedback/prompt-augmenter.js';
import type { IPromptAugmentation } from '../../types.js';

function makeAugmentation(
  id: number,
  promptText: string,
  status: IPromptAugmentation['status'] = 'active',
): IPromptAugmentation {
  return {
    appliedCount: 0,
    createdAt: id,
    expiresAt: null,
    id,
    jobType: 'executor',
    patternId: id,
    projectPath: '/tmp/project',
    promptText,
    status,
    successCount: 0,
    updatedAt: id,
  };
}

describe('prompt augmenter', () => {
  it('should cap active prompt snippets', () => {
    const augmentations = [
      makeAugmentation(1, 'first repeated failure note'),
      makeAugmentation(2, 'second repeated failure note'),
      makeAugmentation(3, 'third repeated failure note'),
      makeAugmentation(4, 'fourth repeated failure note'),
    ];

    const selected = selectPromptAugmentations(augmentations);
    const block = renderProjectFeedbackBlock(augmentations);

    expect(selected.map((augmentation) => augmentation.id)).toEqual([1, 2, 3]);
    expect(block).toContain('## Project Feedback');
    expect(block).toContain('first repeated failure note');
    expect(block).toContain('third repeated failure note');
    expect(block).not.toContain('fourth repeated failure note');
  });

  it('should render prompt block only when augmentations are active', () => {
    expect(renderProjectFeedbackBlock([])).toBe('');
    expect(renderProjectFeedbackBlock([makeAugmentation(1, 'paused note', 'paused')])).toBe('');

    const block = renderProjectFeedbackBlock([makeAugmentation(1, 'active note')]);
    expect(block).toContain('## Project Feedback');
    expect(block).toContain('active note');
  });
});
