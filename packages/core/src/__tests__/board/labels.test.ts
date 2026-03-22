/**
 * Tests for board label taxonomy
 */

import { describe, it, expect } from 'vitest';
import {
  NIGHT_WATCH_LABELS,
  PRIORITY_LABELS,
  CATEGORY_LABELS,
  HORIZON_LABELS,
  isValidPriority,
  isValidCategory,
  isValidHorizon,
} from '../../board/labels.js';

describe('NIGHT_WATCH_LABELS', () => {
  it('includes e2e-validated label', () => {
    const names = NIGHT_WATCH_LABELS.map((l) => l.name);
    expect(names).toContain('e2e-validated');
  });

  it('e2e-validated has correct description and green color', () => {
    const label = NIGHT_WATCH_LABELS.find((l) => l.name === 'e2e-validated');
    expect(label).toBeDefined();
    expect(label!.color).toBe('0e8a16');
    expect(label!.description).toBe(
      'PR acceptance requirements validated by e2e/integration tests',
    );
  });

  it('includes all priority labels', () => {
    const names = NIGHT_WATCH_LABELS.map((l) => l.name);
    for (const p of PRIORITY_LABELS) {
      expect(names).toContain(p);
    }
  });

  it('includes all category labels', () => {
    const names = NIGHT_WATCH_LABELS.map((l) => l.name);
    for (const c of CATEGORY_LABELS) {
      expect(names).toContain(c);
    }
  });

  it('includes all horizon labels', () => {
    const names = NIGHT_WATCH_LABELS.map((l) => l.name);
    for (const h of HORIZON_LABELS) {
      expect(names).toContain(h);
    }
  });

  it('each label has required fields', () => {
    for (const label of NIGHT_WATCH_LABELS) {
      expect(typeof label.name).toBe('string');
      expect(label.name.length).toBeGreaterThan(0);
      expect(typeof label.description).toBe('string');
      expect(typeof label.color).toBe('string');
      expect(label.color).toMatch(/^[0-9a-f]{6}$/i);
    }
  });
});

describe('isValidPriority', () => {
  it('returns true for valid priority labels', () => {
    expect(isValidPriority('P0')).toBe(true);
    expect(isValidPriority('P1')).toBe(true);
    expect(isValidPriority('P2')).toBe(true);
  });

  it('returns false for invalid labels', () => {
    expect(isValidPriority('P3')).toBe(false);
    expect(isValidPriority('e2e-validated')).toBe(false);
    expect(isValidPriority('')).toBe(false);
  });
});

describe('isValidCategory', () => {
  it('returns true for valid category labels', () => {
    expect(isValidCategory('reliability')).toBe(true);
    expect(isValidCategory('quality')).toBe(true);
    expect(isValidCategory('product')).toBe(true);
  });

  it('returns false for invalid labels', () => {
    expect(isValidCategory('e2e-validated')).toBe(false);
    expect(isValidCategory('P0')).toBe(false);
  });
});

describe('isValidHorizon', () => {
  it('returns true for valid horizon labels', () => {
    expect(isValidHorizon('short-term')).toBe(true);
    expect(isValidHorizon('medium-term')).toBe(true);
    expect(isValidHorizon('long-term')).toBe(true);
  });

  it('returns false for invalid labels', () => {
    expect(isValidHorizon('e2e-validated')).toBe(false);
    expect(isValidHorizon('immediate')).toBe(false);
  });
});
