/**
 * Roadmap section to label mapping.
 *
 * Maps ROADMAP.md sections to their corresponding category and horizon labels.
 */

import type { CategoryLabel, HorizonLabel } from './labels.js';

// Horizon label constants
const HORIZON_SHORT_TERM: HorizonLabel = 'short-term';
const HORIZON_MEDIUM_TERM: HorizonLabel = 'medium-term';
const HORIZON_LONG_TERM: HorizonLabel = 'long-term';

export interface IRoadmapSectionMapping {
  sectionPattern: RegExp;
  category: CategoryLabel;
  horizon: HorizonLabel;
}

/**
 * Mapping from ROADMAP.md section headers to category and horizon labels.
 * Based on the PRD specification.
 */
export const ROADMAP_SECTION_MAPPINGS: IRoadmapSectionMapping[] = [
  {
    sectionPattern: /§1.*Reliability.*correctness/i,
    category: 'reliability',
    horizon: HORIZON_SHORT_TERM,
  },
  {
    sectionPattern: /§2.*Quality.*developer/i,
    category: 'quality',
    horizon: HORIZON_SHORT_TERM,
  },
  {
    sectionPattern: /§3.*Product.*operators/i,
    category: 'product',
    horizon: HORIZON_SHORT_TERM,
  },
  {
    sectionPattern: /§4.*Unified.*operations/i,
    category: 'ux',
    horizon: HORIZON_MEDIUM_TERM,
  },
  {
    sectionPattern: /§5.*Provider.*execution/i,
    category: 'provider',
    horizon: HORIZON_MEDIUM_TERM,
  },
  {
    sectionPattern: /§6.*Team.*multi-project/i,
    category: 'team',
    horizon: HORIZON_MEDIUM_TERM,
  },
  {
    sectionPattern: /§7.*Platformization.*enterprise/i,
    category: 'platform',
    horizon: HORIZON_LONG_TERM,
  },
  {
    sectionPattern: /§8.*Intelligence.*autonomous/i,
    category: 'intelligence',
    horizon: HORIZON_LONG_TERM,
  },
  {
    sectionPattern: /§9.*Ecosystem.*adoption/i,
    category: 'ecosystem',
    horizon: HORIZON_LONG_TERM,
  },
  // Fallback patterns without section numbers
  {
    sectionPattern: /Reliability.*correctness/i,
    category: 'reliability',
    horizon: HORIZON_SHORT_TERM,
  },
  {
    sectionPattern: /Quality.*developer.*workflow/i,
    category: 'quality',
    horizon: HORIZON_SHORT_TERM,
  },
  {
    sectionPattern: /Product.*completeness/i,
    category: 'product',
    horizon: HORIZON_SHORT_TERM,
  },
  {
    sectionPattern: /Unified.*operations/i,
    category: 'ux',
    horizon: HORIZON_MEDIUM_TERM,
  },
  {
    sectionPattern: /Provider.*execution/i,
    category: 'provider',
    horizon: HORIZON_MEDIUM_TERM,
  },
  {
    sectionPattern: /Team.*multi-project/i,
    category: 'team',
    horizon: HORIZON_MEDIUM_TERM,
  },
  {
    sectionPattern: /Platformization.*enterprise/i,
    category: 'platform',
    horizon: HORIZON_LONG_TERM,
  },
  {
    sectionPattern: /Intelligence.*autonomous/i,
    category: 'intelligence',
    horizon: HORIZON_LONG_TERM,
  },
  {
    sectionPattern: /Ecosystem.*adoption/i,
    category: 'ecosystem',
    horizon: HORIZON_LONG_TERM,
  },
];

/**
 * Get the category and horizon for a roadmap section.
 * Returns null if no mapping is found.
 */
export function getLabelsForSection(
  sectionName: string,
): { category: CategoryLabel; horizon: HorizonLabel } | null {
  for (const mapping of ROADMAP_SECTION_MAPPINGS) {
    if (mapping.sectionPattern.test(sectionName)) {
      return { category: mapping.category, horizon: mapping.horizon };
    }
  }
  return null;
}

/**
 * Calculate similarity between two strings using Levenshtein distance.
 * Returns a value between 0 and 1, where 1 is an exact match.
 */
export function calculateStringSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2[i - 1] === s1[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  const distance = matrix[s2.length][s1.length];
  const maxLength = Math.max(s1.length, s2.length);
  return 1 - distance / maxLength;
}

/**
 * Find a matching issue by title similarity.
 * Returns the matching issue if similarity >= threshold, or null.
 */
export function findMatchingIssue<T extends { title: string }>(
  targetTitle: string,
  issues: T[],
  threshold = 0.8,
): T | null {
  let bestMatch: T | null = null;
  let bestSimilarity = 0;

  for (const issue of issues) {
    const similarity = calculateStringSimilarity(targetTitle, issue.title);
    if (similarity >= threshold && similarity > bestSimilarity) {
      bestMatch = issue;
      bestSimilarity = similarity;
    }
  }

  return bestMatch;
}
