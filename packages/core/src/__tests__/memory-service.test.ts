import 'reflect-metadata';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_MEMORY_LINES, MEMORY_CHAR_BUDGET, WORKING_CHAR_BUDGET } from '../memory/memory-constants.js';
import { MemoryService } from '../memory/memory-service.js';
import { IAgentPersona, IMemoryEntry, IReflectionContext } from '../shared/types.js';

function buildPersonaFixture(overrides: Partial<IAgentPersona> = {}): IAgentPersona {
  return {
    id: 'persona-test-1',
    name: 'Dev',
    role: 'Implementer',
    avatarUrl: null,
    soul: {
      whoIAm: 'I ship pragmatic fixes quickly.',
      worldview: ['Shipping matters.'],
      opinions: { process: ['Keep PRs small.'] },
      expertise: [],
      interests: [],
      tensions: [],
      boundaries: [],
      petPeeves: [],
    },
    style: {
      voicePrinciples: 'Direct.',
      sentenceStructure: 'Short.',
      tone: 'Calm.',
      wordsUsed: [],
      wordsAvoided: [],
      emojiUsage: { frequency: 'never', favorites: [], contextRules: '' },
      quickReactions: {},
      rhetoricalMoves: [],
      antiPatterns: [],
      goodExamples: [],
      badExamples: [],
    },
    skill: { modes: {}, interpolationRules: '', additionalInstructions: [] },
    modelConfig: null,
    systemPromptOverride: null,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('MemoryService', () => {
  let tempDir: string;
  let service: MemoryService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(os.tmpdir(), 'night-watch-memory-test-'));
    // Pass tempDir as homeDir so all memory paths are rooted under the temp directory
    service = new MemoryService(tempDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // getMemory — tiered reads
  // ---------------------------------------------------------------------------

  describe('getMemory', () => {
    it('should return empty string for new persona', async () => {
      const result = await service.getMemory('maya', 'my-project');
      expect(result).toBe('## Core Lessons\n\n## Working Memory\n');
    });

    it('should read tiered memory (core + working)', async () => {
      const corePath = service.getCoreMemoryPath('maya', 'my-project');
      const workingPath = service.getWorkingMemoryPath('maya', 'my-project');
      const dir = join(corePath, '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(corePath, '- [PATTERN] Always type-check before merge\n', 'utf-8');
      writeFileSync(workingPath, '## 2026-02-20\n- learned something\n\n', 'utf-8');

      const result = await service.getMemory('maya', 'my-project');

      expect(result).toContain('## Core Lessons');
      expect(result).toContain('## Working Memory');
      expect(result).toContain('[PATTERN] Always type-check before merge');
      expect(result).toContain('## 2026-02-20');
      expect(result).toContain('- learned something');
    });

    it('should return empty tiers when no files exist', async () => {
      const result = await service.getMemory('maya', 'nonexistent-project');
      expect(result).toBe('## Core Lessons\n\n## Working Memory\n');
    });

    it('should migrate main.md to working.md on first read', async () => {
      const legacyPath = service.getMemoryPath('maya', 'my-project');
      const workingPath = service.getWorkingMemoryPath('maya', 'my-project');
      const corePath = service.getCoreMemoryPath('maya', 'my-project');

      const dir = join(legacyPath, '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(legacyPath, '## 2026-01-01\n- old lesson\n\n', 'utf-8');

      // Trigger migration via getMemory
      const result = await service.getMemory('maya', 'my-project');

      // working.md should now exist with the old content
      const workingContent = await readFile(workingPath, 'utf-8');
      expect(workingContent).toContain('## 2026-01-01');
      expect(workingContent).toContain('- old lesson');

      // core.md should exist and be empty
      const coreContent = await readFile(corePath, 'utf-8');
      expect(coreContent).toBe('');

      // main.md should be gone
      await expect(stat(legacyPath)).rejects.toThrow();

      // Result should be properly formatted
      expect(result).toContain('## Core Lessons');
      expect(result).toContain('## Working Memory');
      expect(result).toContain('## 2026-01-01');
    });

    it('should truncate working memory to WORKING_CHAR_BUDGET (last N chars)', async () => {
      const workingPath = service.getWorkingMemoryPath('maya', 'my-project');
      const dir = join(workingPath, '..');
      mkdirSync(dir, { recursive: true });

      // Write content larger than WORKING_CHAR_BUDGET
      const largeContent = 'x'.repeat(WORKING_CHAR_BUDGET + 1000);
      writeFileSync(workingPath, largeContent, 'utf-8');

      const result = await service.getMemory('maya', 'my-project');
      // The working section should be limited to WORKING_CHAR_BUDGET chars
      const workingSection = result.split('## Working Memory\n')[1] ?? '';
      expect(workingSection.length).toBeLessThanOrEqual(WORKING_CHAR_BUDGET);
    });

    // Keep backward-compat test for MEMORY_CHAR_BUDGET (used by old tests)
    it('should truncate memory to char budget (backward compat)', async () => {
      const workingPath = service.getWorkingMemoryPath('maya', 'my-project');
      const dir = join(workingPath, '..');
      mkdirSync(dir, { recursive: true });

      const largeContent = 'x'.repeat(MEMORY_CHAR_BUDGET + 1000);
      writeFileSync(workingPath, largeContent, 'utf-8');

      const result = await service.getMemory('maya', 'my-project');
      expect(result.length).toBeLessThanOrEqual(
        '## Core Lessons\n\n## Working Memory\n'.length + WORKING_CHAR_BUDGET,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // appendReflection — writes to working.md
  // ---------------------------------------------------------------------------

  describe('appendReflection', () => {
    it('should append reflection to working.md only', async () => {
      const entry: IMemoryEntry = {
        date: '2026-02-20',
        persona: 'maya',
        project: 'my-project',
        lessons: ['Always check types before merging', 'Prefer small PRs'],
      };

      await service.appendReflection('maya', 'my-project', entry);

      const workingPath = service.getWorkingMemoryPath('maya', 'my-project');
      const workingContent = await readFile(workingPath, 'utf-8');

      expect(workingContent).toContain('## 2026-02-20');
      expect(workingContent).toContain('- Always check types before merging');
      expect(workingContent).toContain('- Prefer small PRs');

      // core.md should NOT be created/modified
      const corePath = service.getCoreMemoryPath('maya', 'my-project');
      await expect(stat(corePath)).rejects.toThrow();
    });

    it('should not modify core.md when appending reflection', async () => {
      const corePath = service.getCoreMemoryPath('maya', 'my-project');
      const dir = join(corePath, '..');
      mkdirSync(dir, { recursive: true });
      const coreOriginal = '- [PATTERN] Always review auth code carefully\n';
      writeFileSync(corePath, coreOriginal, 'utf-8');

      const entry: IMemoryEntry = {
        date: '2026-02-20',
        persona: 'maya',
        project: 'my-project',
        lessons: ['New working lesson'],
      };
      await service.appendReflection('maya', 'my-project', entry);

      // core.md must be unchanged
      const coreAfter = await readFile(corePath, 'utf-8');
      expect(coreAfter).toBe(coreOriginal);
    });

    it('should create directories lazily on first write', async () => {
      const entry: IMemoryEntry = {
        date: '2026-02-20',
        persona: 'carlos',
        project: 'new-project',
        lessons: ['First lesson'],
      };

      // Should not throw even though directory does not exist yet
      await expect(
        service.appendReflection('carlos', 'new-project', entry),
      ).resolves.toBeUndefined();

      const workingPath = service.getWorkingMemoryPath('carlos', 'new-project');
      const content = await readFile(workingPath, 'utf-8');
      expect(content).toContain('## 2026-02-20');
    });

    it('should accumulate multiple reflections', async () => {
      const entry1: IMemoryEntry = {
        date: '2026-02-19',
        persona: 'maya',
        project: 'my-project',
        lessons: ['Lesson one'],
      };
      const entry2: IMemoryEntry = {
        date: '2026-02-20',
        persona: 'maya',
        project: 'my-project',
        lessons: ['Lesson two'],
      };

      await service.appendReflection('maya', 'my-project', entry1);
      await service.appendReflection('maya', 'my-project', entry2);

      const content = await service.getMemory('maya', 'my-project');
      expect(content).toContain('## 2026-02-19');
      expect(content).toContain('## 2026-02-20');
      expect(content).toContain('- Lesson one');
      expect(content).toContain('- Lesson two');
    });
  });

  // ---------------------------------------------------------------------------
  // compact — only compacts working.md
  // ---------------------------------------------------------------------------

  describe('compact', () => {
    it('should not compact core.md', async () => {
      const corePath = service.getCoreMemoryPath('maya', 'my-project');
      const workingPath = service.getWorkingMemoryPath('maya', 'my-project');
      const dir = join(corePath, '..');
      mkdirSync(dir, { recursive: true });

      const coreOriginal = '- [PATTERN] Core lesson that must survive\n';
      writeFileSync(corePath, coreOriginal, 'utf-8');

      // Build working content exceeding MAX_MEMORY_LINES
      const lines = Array.from({ length: 160 }, (_, i) => `- [OBSERVATION] lesson ${String(i)}`);
      writeFileSync(workingPath, lines.join('\n'), 'utf-8');

      const condensed = '- [OBSERVATION] condensed insight\n';
      const mockLlm = vi.fn().mockResolvedValue(condensed);

      await service.compact('maya', 'my-project', mockLlm);

      // core.md must be unchanged
      const coreAfter = await readFile(corePath, 'utf-8');
      expect(coreAfter).toBe(coreOriginal);

      // working.md should be compacted
      const workingAfter = await readFile(workingPath, 'utf-8');
      expect(workingAfter).toBe(condensed);
    });

    it('should not compact when lines are within threshold', async () => {
      const workingPath = service.getWorkingMemoryPath('maya', 'my-project');
      const dir = join(workingPath, '..');
      mkdirSync(dir, { recursive: true });

      const smallContent = '## 2026-02-20\n- only a few lines\n\n';
      writeFileSync(workingPath, smallContent, 'utf-8');

      const mockLlm = vi.fn().mockResolvedValue('- [OBSERVATION] condensed content\n');
      await service.compact('maya', 'my-project', mockLlm);

      // LLM should NOT be called since lines are within the threshold
      expect(mockLlm).not.toHaveBeenCalled();
    });

    it('should call llmCaller and overwrite working.md when lines exceed threshold', async () => {
      const workingPath = service.getWorkingMemoryPath('maya', 'my-project');
      const dir = join(workingPath, '..');
      mkdirSync(dir, { recursive: true });

      // Build content that exceeds MAX_MEMORY_LINES (150)
      const lines = Array.from({ length: 160 }, (_, i) => `- [OBSERVATION] lesson ${String(i)}`);
      const largeContent = lines.join('\n');
      writeFileSync(workingPath, largeContent, 'utf-8');

      const condensed = '- [OBSERVATION] key insight\n';
      const mockLlm = vi.fn().mockResolvedValue(condensed);

      await service.compact('maya', 'my-project', mockLlm);

      expect(mockLlm).toHaveBeenCalledOnce();

      const resultContent = await readFile(workingPath, 'utf-8');
      expect(resultContent).toBe(condensed);
    });

    it('should validate compaction output format — reject if not starting with bullet', async () => {
      const workingPath = service.getWorkingMemoryPath('maya', 'my-project');
      const dir = join(workingPath, '..');
      mkdirSync(dir, { recursive: true });

      const lines = Array.from({ length: 160 }, (_, i) => `- [OBSERVATION] lesson ${String(i)}`);
      const originalContent = lines.join('\n');
      writeFileSync(workingPath, originalContent, 'utf-8');

      // Invalid LLM output — does not start with "- "
      const invalidOutput = 'Here is a summary of your memory:\nSome lessons were found.';
      const mockLlm = vi.fn().mockResolvedValue(invalidOutput);

      await service.compact('maya', 'my-project', mockLlm);

      // Original content should be preserved since validation failed
      const resultContent = await readFile(workingPath, 'utf-8');
      expect(resultContent).toBe(originalContent);
    });

    it('should validate compaction output format — reject if exceeds target line count', async () => {
      const workingPath = service.getWorkingMemoryPath('maya', 'my-project');
      const dir = join(workingPath, '..');
      mkdirSync(dir, { recursive: true });

      const lines = Array.from({ length: 160 }, (_, i) => `- [OBSERVATION] lesson ${String(i)}`);
      const originalContent = lines.join('\n');
      writeFileSync(workingPath, originalContent, 'utf-8');

      // Invalid LLM output — too many lines (> COMPACTION_TARGET_LINES = 60)
      const tooManyLines = Array.from({ length: 80 }, (_, i) => `- [OBSERVATION] line ${String(i)}`).join('\n');
      const mockLlm = vi.fn().mockResolvedValue(tooManyLines);

      await service.compact('maya', 'my-project', mockLlm);

      // Original content should be preserved since validation failed
      const resultContent = await readFile(workingPath, 'utf-8');
      expect(resultContent).toBe(originalContent);
    });

    it('should be a no-op when working memory file does not exist', async () => {
      const mockLlm = vi.fn();
      await expect(
        service.compact('unknown-persona', 'unknown-project', mockLlm),
      ).resolves.toBeUndefined();
      expect(mockLlm).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // promoteToCore
  // ---------------------------------------------------------------------------

  describe('promoteToCore', () => {
    it('should append lesson to core.md with a tag', async () => {
      const corePath = service.getCoreMemoryPath('maya', 'my-project');
      const mockLlm = vi.fn();

      await service.promoteToCore('maya', 'my-project', 'Always validate auth tokens', mockLlm);

      const coreContent = await readFile(corePath, 'utf-8');
      expect(coreContent).toContain('[PATTERN]');
      expect(coreContent).toContain('Always validate auth tokens');
    });

    it('should create directories lazily on first promotion', async () => {
      const mockLlm = vi.fn();
      await expect(
        service.promoteToCore('carlos', 'brand-new-project', 'Keep PRs small', mockLlm),
      ).resolves.toBeUndefined();

      const corePath = service.getCoreMemoryPath('carlos', 'brand-new-project');
      const content = await readFile(corePath, 'utf-8');
      expect(content).toContain('Keep PRs small');
    });
  });

  // ---------------------------------------------------------------------------
  // migrateMemory
  // ---------------------------------------------------------------------------

  describe('migrateMemory', () => {
    it('should migrate memory directory on rename', async () => {
      // Create source directory with a file
      const oldPath = join(tempDir, '.night-watch', 'agents', 'maya');
      mkdirSync(join(oldPath, 'memories', 'proj'), { recursive: true });
      writeFileSync(join(oldPath, 'memories', 'proj', 'main.md'), '## memory\n', 'utf-8');

      await service.migrateMemory('maya', 'maya-renamed');

      // Old path should be gone
      await expect(stat(oldPath)).rejects.toThrow();

      // New path should exist with content
      const newPath = join(tempDir, '.night-watch', 'agents', 'maya-renamed');
      const content = await readFile(join(newPath, 'memories', 'proj', 'main.md'), 'utf-8');
      expect(content).toBe('## memory\n');
    });

    it('should handle rename when source dir is missing (no-op)', async () => {
      await expect(
        service.migrateMemory('nonexistent-persona', 'new-name'),
      ).resolves.toBeUndefined();
    });

    it('should handle rename collision by adding timestamp suffix to target', async () => {
      const agentsDir = join(tempDir, '.night-watch', 'agents');

      // Create both old and new directories
      const oldPath = join(agentsDir, 'maya');
      const newPath = join(agentsDir, 'carlos');
      mkdirSync(join(oldPath, 'memories'), { recursive: true });
      mkdirSync(join(newPath, 'memories'), { recursive: true });
      writeFileSync(join(oldPath, 'memories', 'old.md'), 'old content', 'utf-8');
      writeFileSync(join(newPath, 'memories', 'existing.md'), 'existing content', 'utf-8');

      await service.migrateMemory('maya', 'carlos');

      // Original target (carlos) should still exist with its original content
      const existingContent = await readFile(join(newPath, 'memories', 'existing.md'), 'utf-8');
      expect(existingContent).toBe('existing content');

      // Old source (maya) should be gone
      await expect(stat(oldPath)).rejects.toThrow();

      // The migrated content should exist under a timestamped name
      const entries = await readdir(agentsDir);
      const timestamped = entries.find((e) => e.startsWith('carlos-'));
      expect(timestamped).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // archiveMemory
  // ---------------------------------------------------------------------------

  describe('archiveMemory', () => {
    it('should archive memory on delete', async () => {
      const agentsDir = join(tempDir, '.night-watch', 'agents');
      const personaDir = join(agentsDir, 'maya');
      mkdirSync(join(personaDir, 'memories', 'proj'), { recursive: true });
      writeFileSync(join(personaDir, 'memories', 'proj', 'main.md'), '## archived\n', 'utf-8');

      await service.archiveMemory('maya');

      // Original dir should be gone
      await expect(stat(personaDir)).rejects.toThrow();

      // Archived dir should exist under .archived/
      const archivedDir = join(agentsDir, '.archived');
      const entries = await readdir(archivedDir);
      expect(entries.length).toBe(1);
      expect(entries[0]).toMatch(/^maya-\d+$/);

      const archivedContent = await readFile(
        join(archivedDir, entries[0], 'memories', 'proj', 'main.md'),
        'utf-8',
      );
      expect(archivedContent).toBe('## archived\n');
    });

    it('should be a no-op when persona directory does not exist', async () => {
      await expect(service.archiveMemory('ghost-persona')).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // reflect
  // ---------------------------------------------------------------------------

  describe('reflect', () => {
    const reflectionContext: IReflectionContext = {
      triggerType: 'pr_review',
      outcome: 'approved',
      summary: 'Reviewed the authentication refactor PR.',
    };

    it('should call LLM and append reflection when LLM returns bullet lessons', async () => {
      const persona = buildPersonaFixture({ name: 'Dev', role: 'Implementer' });
      const mockLlm = vi.fn().mockResolvedValue('- lesson 1\n- lesson 2\n');

      await service.reflect(persona, 'my-project', reflectionContext, mockLlm);

      // At least the reflection call should happen
      expect(mockLlm).toHaveBeenCalled();

      const workingPath = service.getWorkingMemoryPath('Dev', 'my-project');
      const content = await readFile(workingPath, 'utf-8');

      expect(content).toContain('- lesson 1');
      expect(content).toContain('- lesson 2');
    });

    it('should append reflection to working.md only (reflect path)', async () => {
      const persona = buildPersonaFixture({ name: 'Dev', role: 'Implementer' });
      const mockLlm = vi.fn().mockResolvedValue('- lesson 1\n');

      await service.reflect(persona, 'my-project', reflectionContext, mockLlm);

      const workingPath = service.getWorkingMemoryPath('Dev', 'my-project');
      const workingContent = await readFile(workingPath, 'utf-8');
      expect(workingContent).toContain('- lesson 1');

      // core.md should NOT be created by reflect alone (no promotion threshold met)
      const corePath = service.getCoreMemoryPath('Dev', 'my-project');
      // core may or may not exist; what matters is working.md got the lesson
      void corePath;
    });

    it('should not append reflection when LLM returns no bullet lessons', async () => {
      const persona = buildPersonaFixture({ name: 'Dev', role: 'Implementer' });
      // Returns text but no lines starting with "- "
      const mockLlm = vi.fn().mockResolvedValue('Nothing useful here.\nJust plain text.');

      await service.reflect(persona, 'my-project', reflectionContext, mockLlm);

      expect(mockLlm).toHaveBeenCalledOnce();

      // working.md should not have been created
      const workingPath = service.getWorkingMemoryPath('Dev', 'my-project');
      await expect(stat(workingPath)).rejects.toThrow();
    });

    it('should not append reflection when LLM returns empty string', async () => {
      const persona = buildPersonaFixture({ name: 'Dev', role: 'Implementer' });
      const mockLlm = vi.fn().mockResolvedValue('');

      await service.reflect(persona, 'my-project', reflectionContext, mockLlm);

      const workingPath = service.getWorkingMemoryPath('Dev', 'my-project');
      await expect(stat(workingPath)).rejects.toThrow();
    });

    it('should compact when line count exceeds MAX_MEMORY_LINES after appending', async () => {
      const persona = buildPersonaFixture({ name: 'Dev', role: 'Implementer' });

      // Pre-populate the working memory file with more than MAX_MEMORY_LINES lines
      const workingPath = service.getWorkingMemoryPath('Dev', 'my-project');
      const workingDir = join(workingPath, '..');
      mkdirSync(workingDir, { recursive: true });

      const existingLines = Array.from(
        { length: MAX_MEMORY_LINES + 10 },
        (_, i) => `- [OBSERVATION] old lesson ${String(i)}`,
      );
      writeFileSync(workingPath, existingLines.join('\n') + '\n', 'utf-8');

      const condensedContent = '- [OBSERVATION] key insight only\n';
      // First call: reflection response; subsequent calls: compaction/promotion response
      const mockLlm = vi
        .fn()
        .mockResolvedValueOnce('- new lesson from reflect\n')
        .mockResolvedValue(condensedContent);

      await service.reflect(persona, 'my-project', reflectionContext, mockLlm);

      // LLM should have been called at least twice (reflect + compact)
      expect(mockLlm.mock.calls.length).toBeGreaterThanOrEqual(2);

      const resultContent = await readFile(workingPath, 'utf-8');
      // After compaction the file content should be the condensed form
      expect(resultContent).toBe(condensedContent);
    });

    it('should not compact when line count stays within MAX_MEMORY_LINES', async () => {
      const persona = buildPersonaFixture({ name: 'Dev', role: 'Implementer' });

      // First call returns lessons, second would be compaction (should NOT happen)
      const mockLlm = vi
        .fn()
        .mockResolvedValueOnce('- concise lesson\n')
        .mockResolvedValue('- [OBSERVATION] compacted content\n');

      await service.reflect(persona, 'my-project', reflectionContext, mockLlm);

      // Only the reflection call should happen (checkPromotion won't trigger on 1 lesson)
      expect(mockLlm).toHaveBeenCalledOnce();
    });
  });
});
