import { describe, it, expect } from 'vitest';
import type { IRoadmapItem, IBoardIssue } from '../../api';
import {
  getItemHorizonAndCategory,
  groupItemsByHorizon,
  getItemPipelineStage,
  matchItemToBoardIssue,
  getFullPipelineStage,
  getPipelineSummary,
  filterItems,
  isAuditFinding,
  enrichRoadmapItems,
  DEFAULT_FILTERS,
  type IEnrichedRoadmapItem,
  type CategoryLabel,
  type HorizonLabel,
  type PipelineStage,
  type IRoadmapFilters,
} from '../../utils/roadmap-helpers';

// ==================== Test Fixtures ====================

const createRoadmapItem = (overrides: Partial<IRoadmapItem> = {}): IRoadmapItem => ({
  hash: 'test-hash',
  title: 'Test Item',
  description: 'Test description',
  checked: false,
  section: 'Test Section',
  processed: false,
  ...overrides,
});

const createBoardIssue = (overrides: Partial<IBoardIssue> = {}): IBoardIssue => ({
  id: 'issue-1',
  number: 1,
  title: 'Test Issue',
  body: '',
  url: 'https://github.com/test/test/issues/1',
  column: 'Draft',
  labels: [],
  assignees: [],
  ...overrides,
});

const createEnrichedItem = (
  item: IRoadmapItem,
  mapping: { horizon: HorizonLabel; category: CategoryLabel } | null,
  pipelineStage: PipelineStage,
  boardIssue: IBoardIssue | null,
): IEnrichedRoadmapItem => ({
  ...item,
  mapping,
  pipelineStage,
  boardIssue,
});

// ==================== getItemHorizonAndCategory ====================

describe('getItemHorizonAndCategory', () => {
  it('should map §1 Reliability section to short-term/reliability', () => {
    const item = createRoadmapItem({ section: '§1 Reliability and correctness' });
    const result = getItemHorizonAndCategory(item);
    expect(result).toEqual({ horizon: 'short-term', category: 'reliability' });
  });

  it('should map §7 Platformization section to long-term/platform', () => {
    const item = createRoadmapItem({ section: '§7 Platformization and enterprise' });
    const result = getItemHorizonAndCategory(item);
    expect(result).toEqual({ horizon: 'long-term', category: 'platform' });
  });

  it('should return null for unrecognized section', () => {
    const item = createRoadmapItem({ section: 'Some Random Section' });
    const result = getItemHorizonAndCategory(item);
    expect(result).toBeNull();
  });

  it('should handle fallback patterns without § prefix', () => {
    const item = createRoadmapItem({ section: 'Reliability and correctness' });
    const result = getItemHorizonAndCategory(item);
    expect(result).toEqual({ horizon: 'short-term', category: 'reliability' });
  });

  it('should match simple keyword patterns', () => {
    const item = createRoadmapItem({ section: 'Quality improvements' });
    const result = getItemHorizonAndCategory(item);
    expect(result).toEqual({ horizon: 'short-term', category: 'quality' });
  });

  it('should return null for empty section', () => {
    const item = createRoadmapItem({ section: '' });
    const result = getItemHorizonAndCategory(item);
    expect(result).toBeNull();
  });
});

// ==================== groupItemsByHorizon ====================

describe('groupItemsByHorizon', () => {
  it('should group items by horizon then category', () => {
    const items: IEnrichedRoadmapItem[] = [
      createEnrichedItem(
        createRoadmapItem({ section: '§1 Reliability' }),
        { horizon: 'short-term', category: 'reliability' },
        'pending',
        null,
      ),
      createEnrichedItem(
        createRoadmapItem({ section: '§2 Quality' }),
        { horizon: 'short-term', category: 'quality' },
        'pending',
        null,
      ),
      createEnrichedItem(
        createRoadmapItem({ section: '§4 UX' }),
        { horizon: 'medium-term', category: 'ux' },
        'pending',
        null,
      ),
    ];
    const result = groupItemsByHorizon(items);
    expect(Object.keys(result)).toEqual(['short-term', 'medium-term', 'long-term', 'unmapped']);
    expect(result['short-term']['reliability']).toHaveLength(1);
    expect(result['short-term']['quality']).toHaveLength(1);
    expect(result['medium-term']['ux']).toHaveLength(1);
    expect(result['long-term']).toEqual({});
  });

  it('should put unmapped items in other bucket', () => {
    const items: IEnrichedRoadmapItem[] = [
      createEnrichedItem(createRoadmapItem({ section: 'Some Random Section' }), null, 'pending', null),
    ];
    const result = groupItemsByHorizon(items);
    expect(result.unmapped.other).toHaveLength(1);
  });
});

// ==================== getItemPipelineStage ====================

describe('getItemPipelineStage', () => {
  it('should return done for checked item', () => {
    const item = createRoadmapItem({ checked: true });
    expect(getItemPipelineStage(item)).toBe('done');
  });

  it('should return sliced for processed item', () => {
    const item = createRoadmapItem({ processed: true });
    expect(getItemPipelineStage(item)).toBe('sliced');
  });

  it('should return pending for unprocessed item', () => {
    const item = createRoadmapItem({ processed: false });
    expect(getItemPipelineStage(item)).toBe('pending');
  });
});

// ==================== matchItemToBoardIssue ====================

describe('matchItemToBoardIssue', () => {
  it('should match roadmap item to board issue by normalized title', () => {
    const item = createRoadmapItem({ title: 'User Authentication' });
    const boardIssues: IBoardIssue[] = [
      createBoardIssue({ title: 'Implement User Authentication System' }),
    ];
    const result = matchItemToBoardIssue(item, boardIssues);
    expect(result).not.toBeNull();
    expect(result?.title).toBe('Implement User Authentication System');
  });

  it('should return null when no board issue matches', () => {
    const item = createRoadmapItem({ title: 'Unrelated Item' });
    const boardIssues: IBoardIssue[] = [
      createBoardIssue({ title: 'Some Other Task' }),
    ];
    const result = matchItemToBoardIssue(item, boardIssues);
    expect(result).toBeNull();
  });
});

// ==================== getFullPipelineStage ====================

describe('getFullPipelineStage', () => {
  it('should compute pipeline stage as sliced when PRD exists but no board issue', () => {
    const item = createRoadmapItem({ processed: true, checked: false });
    const result = getFullPipelineStage(item, null);
    expect(result).toBe('sliced');
  });

  it('should compute pipeline stage as active when board issue is In Progress', () => {
    const item = createRoadmapItem({ processed: true, checked: false });
    const boardIssue = createBoardIssue({ column: 'In Progress' });
    const result = getFullPipelineStage(item, boardIssue);
    expect(result).toBe('active');
  });

  it('should compute pipeline stage as on-board when board issue is Draft', () => {
    const item = createRoadmapItem({ processed: true, checked: false });
    const boardIssue = createBoardIssue({ column: 'Draft' });
    const result = getFullPipelineStage(item, boardIssue);
    expect(result).toBe('on-board');
  });

  it('should compute pipeline stage as done when checked', () => {
    const item = createRoadmapItem({ processed: true, checked: true });
    const result = getFullPipelineStage(item, null);
    expect(result).toBe('done');
  });

  it('should compute pipeline stage as done when board issue is Done', () => {
    const item = createRoadmapItem({ processed: true, checked: false });
    const boardIssue = createBoardIssue({ column: 'Done' });
    const result = getFullPipelineStage(item, boardIssue);
    expect(result).toBe('done');
  });

  it('should compute pipeline stage as pending when not processed', () => {
    const item = createRoadmapItem({ processed: false, checked: false });
    const result = getFullPipelineStage(item, null);
    expect(result).toBe('pending');
  });
});

// ==================== getPipelineSummary ====================

describe('getPipelineSummary', () => {
  it('should compute correct pipeline summary counts', () => {
    const items: IEnrichedRoadmapItem[] = [
      createEnrichedItem(createRoadmapItem({ title: 'Item 1' }), null, 'pending', null),
      createEnrichedItem(createRoadmapItem({ title: 'Item 2' }), null, 'sliced', null),
      createEnrichedItem(createRoadmapItem({ title: 'Item 3' }), null, 'done', null),
    ];
    const result = getPipelineSummary(items);
    expect(result).toEqual({
      pending: 1,
      sliced: 1,
      'on-board': 0,
      active: 0,
      done: 1,
    });
  });
});

// ==================== filterItems ====================

describe('filterItems', () => {
  it('should filter items by category', () => {
    const items: IEnrichedRoadmapItem[] = [
      createEnrichedItem(
        createRoadmapItem({ title: 'Reliability fix' }),
        { horizon: 'short-term', category: 'reliability' },
        'pending',
        null,
      ),
      createEnrichedItem(
        createRoadmapItem({ title: 'Product feature' }),
        { horizon: 'short-term', category: 'product' },
        'sliced',
        null,
      ),
    ];
    const filters: IRoadmapFilters = {
      ...DEFAULT_FILTERS,
      categories: new Set<CategoryLabel>(['reliability']),
    };
    const result = filterItems(items, filters);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Reliability fix');
  });

  it('should filter items by search term', () => {
    const items: IEnrichedRoadmapItem[] = [
      createEnrichedItem(
        createRoadmapItem({ title: 'Reliability fix' }),
        { horizon: 'short-term', category: 'reliability' },
        'pending',
        null,
      ),
      createEnrichedItem(
        createRoadmapItem({ title: 'Product feature' }),
        { horizon: 'short-term', category: 'product' },
        'sliced',
        null,
      ),
    ];
    const filters: IRoadmapFilters = {
      ...DEFAULT_FILTERS,
      search: 'reliability',
    };
    const result = filterItems(items, filters);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Reliability fix');
  });

  it('should return all items when no filters applied', () => {
    const items: IEnrichedRoadmapItem[] = [
      createEnrichedItem(
        createRoadmapItem({ title: 'Item 1' }),
        { horizon: 'short-term', category: 'reliability' },
        'pending',
        null,
      ),
      createEnrichedItem(
        createRoadmapItem({ title: 'Item 2' }),
        { horizon: 'short-term', category: 'product' },
        'sliced',
        null,
      ),
    ];
    const result = filterItems(items, DEFAULT_FILTERS);
    expect(result).toHaveLength(2);
  });
});

// ==================== isAuditFinding ====================

describe('isAuditFinding', () => {
  it('should identify audit finding items by section name', () => {
    const item = createRoadmapItem({ section: 'Audit Findings' });
    expect(isAuditFinding(item)).toBe(true);
  });

  it('should identify items with audit in section name', () => {
    const item = createRoadmapItem({ section: 'Security Audit Results' });
    expect(isAuditFinding(item)).toBe(true);
  });

  it('should identify items with finding in section name', () => {
    const item = createRoadmapItem({ section: 'Code Review Findings' });
    expect(isAuditFinding(item)).toBe(true);
  });

  it('should return false for regular sections', () => {
    const item = createRoadmapItem({ section: 'Reliability' });
    expect(isAuditFinding(item)).toBe(false);
  });
});

// ==================== enrichRoadmapItems ====================

describe('enrichRoadmapItems', () => {
  it('should enrich items with mapping, pipeline stage, and board issue', () => {
    const items: IRoadmapItem[] = [
      createRoadmapItem({ title: 'User Authentication', section: '§1 Reliability', processed: true }),
    ];
    const boardIssues: IBoardIssue[] = [
      createBoardIssue({ title: 'Implement User Authentication System', column: 'In Progress' }),
    ];
    const result = enrichRoadmapItems(items, boardIssues);
    expect(result).toHaveLength(1);
    expect(result[0].mapping?.category).toBe('reliability');
    expect(result[0].mapping?.horizon).toBe('short-term');
    expect(result[0].pipelineStage).toBe('active');
    expect(result[0].boardIssue).not.toBeNull();
  });
});
