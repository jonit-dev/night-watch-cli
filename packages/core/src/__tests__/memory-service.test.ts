import 'reflect-metadata';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_MEMORY_LINES, MEMORY_CHAR_BUDGET } from '../memory/memory-constants.js';
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

  describe('getMemory', () => {
    it('should return empty string for new persona', async () => {
      const result = await service.getMemory('maya', 'my-project');
      expect(result).toBe('');
    });

    it('should return file content when memory file exists', async () => {
      const memPath = service.getMemoryPath('maya', 'my-project');
      const dir = join(memPath, '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(memPath, '## 2026-02-20\n- learned something\n\n', 'utf-8');

      const result = await service.getMemory('maya', 'my-project');
      expect(result).toContain('## 2026-02-20');
      expect(result).toContain('- learned something');
    });

    it('should truncate memory to char budget', async () => {
      const memPath = service.getMemoryPath('maya', 'my-project');
      const dir = join(memPath, '..');
      mkdirSync(dir, { recursive: true });

      // Write content larger than MEMORY_CHAR_BUDGET
      const largeContent = 'x'.repeat(MEMORY_CHAR_BUDGET + 1000);
      writeFileSync(memPath, largeContent, 'utf-8');

      const result = await service.getMemory('maya', 'my-project');
      expect(result.length).toBeLessThanOrEqual(MEMORY_CHAR_BUDGET);
    });
  });

  describe('appendReflection', () => {
    it('should append reflection with date header', async () => {
      const entry: IMemoryEntry = {
        date: '2026-02-20',
        persona: 'maya',
        project: 'my-project',
        lessons: ['Always check types before merging', 'Prefer small PRs'],
      };

      await service.appendReflection('maya', 'my-project', entry);

      const memPath = service.getMemoryPath('maya', 'my-project');
      const content = await readFile(memPath, 'utf-8');

      expect(content).toContain('## 2026-02-20');
      expect(content).toContain('- Always check types before merging');
      expect(content).toContain('- Prefer small PRs');
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

      const memPath = service.getMemoryPath('carlos', 'new-project');
      const content = await readFile(memPath, 'utf-8');
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

  describe('compact', () => {
    it('should not compact when lines are within threshold', async () => {
      const memPath = service.getMemoryPath('maya', 'my-project');
      const dir = join(memPath, '..');
      mkdirSync(dir, { recursive: true });

      const smallContent = '## 2026-02-20\n- only a few lines\n\n';
      writeFileSync(memPath, smallContent, 'utf-8');

      const mockLlm = vi.fn().mockResolvedValue('condensed content');
      await service.compact('maya', 'my-project', mockLlm);

      // LLM should NOT be called since lines are within the threshold
      expect(mockLlm).not.toHaveBeenCalled();
    });

    it('should call llmCaller and overwrite file when lines exceed threshold', async () => {
      const memPath = service.getMemoryPath('maya', 'my-project');
      const dir = join(memPath, '..');
      mkdirSync(dir, { recursive: true });

      // Build content that exceeds MAX_MEMORY_LINES (150)
      const lines = Array.from({ length: 160 }, (_, i) => `- lesson ${String(i)}`);
      const largeContent = lines.join('\n');
      writeFileSync(memPath, largeContent, 'utf-8');

      const condensed = '## Compacted\n- key insight\n';
      const mockLlm = vi.fn().mockResolvedValue(condensed);

      await service.compact('maya', 'my-project', mockLlm);

      expect(mockLlm).toHaveBeenCalledOnce();

      const resultContent = await readFile(memPath, 'utf-8');
      expect(resultContent).toBe(condensed);
    });

    it('should be a no-op when memory file does not exist', async () => {
      const mockLlm = vi.fn();
      await expect(
        service.compact('unknown-persona', 'unknown-project', mockLlm),
      ).resolves.toBeUndefined();
      expect(mockLlm).not.toHaveBeenCalled();
    });
  });

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

      expect(mockLlm).toHaveBeenCalledOnce();

      const memPath = service.getMemoryPath('Dev', 'my-project');
      const content = await readFile(memPath, 'utf-8');

      expect(content).toContain('- lesson 1');
      expect(content).toContain('- lesson 2');
    });

    it('should not append reflection when LLM returns no bullet lessons', async () => {
      const persona = buildPersonaFixture({ name: 'Dev', role: 'Implementer' });
      // Returns text but no lines starting with "- "
      const mockLlm = vi.fn().mockResolvedValue('Nothing useful here.\nJust plain text.');

      await service.reflect(persona, 'my-project', reflectionContext, mockLlm);

      expect(mockLlm).toHaveBeenCalledOnce();

      // Memory file should not have been created
      const memPath = service.getMemoryPath('Dev', 'my-project');
      await expect(stat(memPath)).rejects.toThrow();
    });

    it('should not append reflection when LLM returns empty string', async () => {
      const persona = buildPersonaFixture({ name: 'Dev', role: 'Implementer' });
      const mockLlm = vi.fn().mockResolvedValue('');

      await service.reflect(persona, 'my-project', reflectionContext, mockLlm);

      const memPath = service.getMemoryPath('Dev', 'my-project');
      await expect(stat(memPath)).rejects.toThrow();
    });

    it('should compact when line count exceeds MAX_MEMORY_LINES after appending', async () => {
      const persona = buildPersonaFixture({ name: 'Dev', role: 'Implementer' });

      // Pre-populate the memory file with more than MAX_MEMORY_LINES lines
      const memPath = service.getMemoryPath('Dev', 'my-project');
      const memDir = join(memPath, '..');
      mkdirSync(memDir, { recursive: true });

      const existingLines = Array.from(
        { length: MAX_MEMORY_LINES + 10 },
        (_, i) => `- old lesson ${String(i)}`,
      );
      writeFileSync(memPath, existingLines.join('\n') + '\n', 'utf-8');

      const condensedContent = '## Compacted\n- key insight only\n';
      // First call: reflection response; second+ calls: compaction response
      const mockLlm = vi
        .fn()
        .mockResolvedValueOnce('- new lesson from reflect\n')
        .mockResolvedValue(condensedContent);

      await service.reflect(persona, 'my-project', reflectionContext, mockLlm);

      // LLM should have been called at least twice (reflect + compact)
      expect(mockLlm).toHaveBeenCalledTimes(2);

      const resultContent = await readFile(memPath, 'utf-8');
      // After compaction the file content should be the condensed form
      expect(resultContent).toBe(condensedContent);
    });

    it('should not compact when line count stays within MAX_MEMORY_LINES', async () => {
      const persona = buildPersonaFixture({ name: 'Dev', role: 'Implementer' });

      // First call returns lessons, second would be compaction (should NOT happen)
      const mockLlm = vi
        .fn()
        .mockResolvedValueOnce('- concise lesson\n')
        .mockResolvedValue('compacted content');

      await service.reflect(persona, 'my-project', reflectionContext, mockLlm);

      // Only the reflection call should happen; no compaction
      expect(mockLlm).toHaveBeenCalledOnce();
    });
  });
});
