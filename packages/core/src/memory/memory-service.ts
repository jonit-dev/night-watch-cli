/**
 * MemoryService — manages per-persona, per-project persistent memory files.
 *
 * Memory files live at:
 *   ~/.night-watch/agents/{personaName}/memories/{projectSlug}/main.md
 *
 * Each persona accumulates lessons from interactions. Memory is injected
 * into system prompts before interactions and compacted when it grows too large.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { injectable } from 'tsyringe';

import { IAgentPersona, IMemoryEntry, IReflectionContext, LlmCaller } from '@/shared/types.js';
import { createLogger } from '@/utils/logger.js';

import {
  COMPACTION_SYSTEM_PROMPT,
  COMPACTION_TARGET_LINES,
  MAX_MEMORY_LINES,
  MEMORY_CHAR_BUDGET,
  NIGHT_WATCH_DIR,
} from './memory-constants.js';
import { buildCompactionPrompt, buildReflectionPrompt } from './reflection-prompts.js';

const log = createLogger('memory');

@injectable()
export class MemoryService {
  /**
   * Optional home-directory override. Used in tests to redirect memory
   * files to a temp directory without needing to mock the ESM `os` module.
   */
  private readonly baseHomeDir: string;

  constructor(homeDir?: string) {
    this.baseHomeDir = homeDir ?? homedir();
  }

  /**
   * Resolve the filesystem path for a persona's project memory file.
   */
  getMemoryPath(personaName: string, projectSlug: string): string {
    return join(
      this.baseHomeDir,
      NIGHT_WATCH_DIR,
      'agents',
      personaName,
      'memories',
      projectSlug,
      'main.md',
    );
  }

  /**
   * Read the memory file for a persona/project pair.
   * Returns empty string if the file does not exist.
   * Truncates content to MEMORY_CHAR_BUDGET characters.
   */
  async getMemory(personaName: string, projectSlug: string): Promise<string> {
    const filePath = this.getMemoryPath(personaName, projectSlug);
    try {
      const content = await readFile(filePath, 'utf-8');
      if (content.length > MEMORY_CHAR_BUDGET) {
        return content.slice(content.length - MEMORY_CHAR_BUDGET);
      }
      return content;
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return '';
      }
      throw err;
    }
  }

  /**
   * Append a reflection entry to the memory file.
   * Creates the directory structure lazily on first write.
   * Appends a markdown section with a date header and bullet-point lessons.
   */
  async appendReflection(
    personaName: string,
    projectSlug: string,
    entry: IMemoryEntry,
  ): Promise<void> {
    const filePath = this.getMemoryPath(personaName, projectSlug);
    const dir = join(filePath, '..');

    await mkdir(dir, { recursive: true });

    const bullets = entry.lessons.map((lesson) => `- ${lesson}`).join('\n');
    const section = `## ${entry.date}\n${bullets}\n\n`;

    await writeFile(filePath, section, { flag: 'a', encoding: 'utf-8' });
    log.info('memory reflection appended', {
      agent: personaName,
      project: projectSlug,
      lessons: entry.lessons.length,
    });
  }

  /**
   * Compact the memory file when it exceeds MAX_MEMORY_LINES.
   * Calls llmCaller with a compaction prompt and overwrites the file with the result.
   * LlmCaller is passed as a parameter to avoid circular dependencies with the slack package.
   */
  async compact(personaName: string, projectSlug: string, llmCaller: LlmCaller): Promise<void> {
    const filePath = this.getMemoryPath(personaName, projectSlug);

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return;
      }
      throw err;
    }

    const lines = content.split('\n');
    if (lines.length <= MAX_MEMORY_LINES) {
      return;
    }

    const systemPrompt = `You are a memory compaction assistant. Condense the following agent memory log into a concise set of key lessons. Preserve the most important insights. Output in the same markdown format with ## date headers and bullet points. Target approximately ${String(COMPACTION_TARGET_LINES)} key bullet points total.`;
    const userPrompt = `Compact the following memory log:\n\n${content}`;

    const condensed = await llmCaller(systemPrompt, userPrompt);
    await writeFile(filePath, condensed, { encoding: 'utf-8' });
    log.info('memory compacted', { agent: personaName, project: projectSlug });
  }

  /**
   * Ask the LLM (in persona) to reflect on an interaction and persist the lessons.
   *
   * Flow:
   *  1. Build a role-flavored prompt from the persona and context.
   *  2. Call llmCaller with a minimal system prompt and the reflection prompt.
   *  3. Parse lines starting with "- " from the response as individual lessons.
   *  4. Skip writing if no lessons were extracted.
   *  5. Append the lessons as a dated IMemoryEntry to the memory file.
   *  6. Compact the memory file if it has grown beyond MAX_MEMORY_LINES.
   */
  async reflect(
    persona: IAgentPersona,
    projectSlug: string,
    context: IReflectionContext,
    llmCaller: LlmCaller,
  ): Promise<void> {
    const systemPrompt = `You are ${persona.name}, ${persona.role}. Respond only with bullet points, no preamble.`;
    const reflectionPrompt = buildReflectionPrompt(persona, context);

    const response = await llmCaller(systemPrompt, reflectionPrompt);

    const lessons = response
      .split('\n')
      .filter((line) => line.trimStart().startsWith('- '))
      .map((line) => line.trimStart().slice(2).trim())
      .filter((lesson) => lesson.length > 0);

    if (lessons.length === 0) {
      log.debug('reflect: no lessons extracted', {
        agent: persona.name,
        project: projectSlug,
        trigger: context.triggerType,
      });
      return;
    }

    log.info('agent reflection', {
      agent: persona.name,
      project: projectSlug,
      trigger: context.triggerType,
      outcome: context.outcome,
      lessons: lessons.length,
    });

    const entry: IMemoryEntry = {
      date: new Date().toISOString().split('T')[0],
      persona: persona.name,
      project: projectSlug,
      lessons,
    };

    await this.appendReflection(persona.name, projectSlug, entry);

    // Check line count and compact if needed
    const filePath = this.getMemoryPath(persona.name, projectSlug);
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      return;
    }

    const lineCount = content.split('\n').length;
    if (lineCount > MAX_MEMORY_LINES) {
      const compactionCaller: LlmCaller = (_systemPrompt, _userPrompt) =>
        llmCaller(COMPACTION_SYSTEM_PROMPT, buildCompactionPrompt(persona, content));
      await this.compact(persona.name, projectSlug, compactionCaller);
    }
  }

  /**
   * Migrate (rename) a persona's memory directory when the persona is renamed.
   * No-op if source directory does not exist.
   * If target already exists, the target gets a -{timestamp} suffix to avoid collision.
   */
  async migrateMemory(oldName: string, newName: string): Promise<void> {
    const agentsDir = join(this.baseHomeDir, NIGHT_WATCH_DIR, 'agents');
    const sourcePath = join(agentsDir, oldName);
    const targetPath = join(agentsDir, newName);

    // Check if source exists
    const sourceExists = await pathExists(sourcePath);
    if (!sourceExists) {
      return;
    }

    // If target already exists, add timestamp suffix to target to avoid collision
    const targetExists = await pathExists(targetPath);
    const resolvedTarget = targetExists ? `${targetPath}-${Date.now()}` : targetPath;

    await rename(sourcePath, resolvedTarget);
  }

  /**
   * Archive a persona's memory directory when the persona is deleted.
   * Moves `~/.night-watch/agents/{name}/` to `~/.night-watch/agents/.archived/{name}-{timestamp}/`.
   * Creates the `.archived/` directory if it does not exist.
   */
  async archiveMemory(name: string): Promise<void> {
    const agentsDir = join(this.baseHomeDir, NIGHT_WATCH_DIR, 'agents');
    const sourcePath = join(agentsDir, name);

    const sourceExists = await pathExists(sourcePath);
    if (!sourceExists) {
      return;
    }

    const archivedDir = join(agentsDir, '.archived');
    await mkdir(archivedDir, { recursive: true });

    const archiveName = `${name}-${Date.now()}`;
    const archivePath = join(archivedDir, archiveName);

    await rename(sourcePath, archivePath);
  }
}

/** Type guard for Node.js filesystem errors. */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/** Check whether a path exists without throwing. */
async function pathExists(p: string): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises');
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
