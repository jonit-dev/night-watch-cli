/**
 * MemoryService — manages per-persona, per-project persistent memory files.
 *
 * Memory files live at:
 *   ~/.night-watch/agents/{personaName}/memories/{projectSlug}/core.md
 *   ~/.night-watch/agents/{personaName}/memories/{projectSlug}/working.md
 *
 * Legacy `main.md` files are auto-migrated to `working.md` on first read.
 *
 * Each persona accumulates lessons from interactions. Memory is injected
 * into system prompts before interactions and compacted when it grows too large.
 * Core memory is permanent and never compacted; working memory is periodically
 * condensed by the LLM.
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
  CORE_CHAR_BUDGET,
  MAX_MEMORY_LINES,
  MEMORY_CHAR_BUDGET,
  NIGHT_WATCH_DIR,
  WORKING_CHAR_BUDGET,
} from './memory-constants.js';
import { CORE_CATEGORIES } from './memory-types.js';
import { buildCompactionPrompt, buildReflectionPrompt } from './reflection-prompts.js';

const log = createLogger('memory');

/** Minimum occurrences of a lesson theme before promotion is considered. */
const PROMOTION_THRESHOLD = 3;

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

  // ---------------------------------------------------------------------------
  // Path helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve the filesystem path for a persona's project memory file.
   * Points to the legacy `main.md` — used for backward compat checks.
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
   * Resolve the path to the permanent core memory file for a persona/project.
   */
  getCoreMemoryPath(personaName: string, projectSlug: string): string {
    return join(
      this.baseHomeDir,
      NIGHT_WATCH_DIR,
      'agents',
      personaName,
      'memories',
      projectSlug,
      'core.md',
    );
  }

  /**
   * Resolve the path to the working memory file for a persona/project.
   */
  getWorkingMemoryPath(personaName: string, projectSlug: string): string {
    return join(
      this.baseHomeDir,
      NIGHT_WATCH_DIR,
      'agents',
      personaName,
      'memories',
      projectSlug,
      'working.md',
    );
  }

  // ---------------------------------------------------------------------------
  // Read / Write
  // ---------------------------------------------------------------------------

  /**
   * Read the tiered memory for a persona/project pair.
   *
   * Reads `core.md` (truncated to CORE_CHAR_BUDGET) and `working.md`
   * (last WORKING_CHAR_BUDGET chars). If only a legacy `main.md` exists,
   * it is migrated (renamed to `working.md`, empty `core.md` created).
   *
   * Returns a formatted string:
   *   ## Core Lessons
   *   {core}
   *
   *   ## Working Memory
   *   {working}
   */
  async getMemory(personaName: string, projectSlug: string): Promise<string> {
    const corePath = this.getCoreMemoryPath(personaName, projectSlug);
    const workingPath = this.getWorkingMemoryPath(personaName, projectSlug);
    const legacyPath = this.getMemoryPath(personaName, projectSlug);

    // --- Migration: main.md → working.md + core.md ---
    const legacyExists = await pathExists(legacyPath);
    if (legacyExists) {
      const coreExists = await pathExists(corePath);
      const workingExists = await pathExists(workingPath);
      if (!coreExists && !workingExists) {
        log.info('migrating legacy main.md to working.md', { agent: personaName, project: projectSlug });
        await rename(legacyPath, workingPath);
        await writeFile(corePath, '', { encoding: 'utf-8' });
      }
    }

    // --- Read core ---
    let coreContent = '';
    try {
      const raw = await readFile(corePath, 'utf-8');
      coreContent = raw.length > CORE_CHAR_BUDGET ? raw.slice(0, CORE_CHAR_BUDGET) : raw;
    } catch (err: unknown) {
      if (!isNodeError(err) || err.code !== 'ENOENT') {
        throw err;
      }
    }

    // --- Read working (keep last N chars) ---
    let workingContent = '';
    try {
      const raw = await readFile(workingPath, 'utf-8');
      workingContent =
        raw.length > WORKING_CHAR_BUDGET ? raw.slice(raw.length - WORKING_CHAR_BUDGET) : raw;
    } catch (err: unknown) {
      if (!isNodeError(err) || err.code !== 'ENOENT') {
        throw err;
      }
    }

    return `## Core Lessons\n${coreContent}\n## Working Memory\n${workingContent}`;
  }

  /**
   * Append a reflection entry to `working.md`.
   * Creates the directory structure lazily on first write.
   * Appends a markdown section with a date header and bullet-point lessons.
   */
  async appendReflection(
    personaName: string,
    projectSlug: string,
    entry: IMemoryEntry,
  ): Promise<void> {
    const filePath = this.getWorkingMemoryPath(personaName, projectSlug);
    const dir = join(filePath, '..');

    await mkdir(dir, { recursive: true });

    const categoryTag = entry.category ? ` [${entry.category}]` : '';
    const bullets = entry.lessons.map((lesson) => `- ${lesson}`).join('\n');
    const section = `## ${entry.date}${categoryTag}\n${bullets}\n\n`;

    await writeFile(filePath, section, { flag: 'a', encoding: 'utf-8' });
    log.info('memory reflection appended', {
      agent: personaName,
      project: projectSlug,
      lessons: entry.lessons.length,
    });
  }

  // ---------------------------------------------------------------------------
  // Compaction (working.md only)
  // ---------------------------------------------------------------------------

  /**
   * Compact `working.md` when it exceeds MAX_MEMORY_LINES.
   * Calls llmCaller with a compaction prompt and overwrites working.md with
   * the result. Validates the output before overwriting — if validation fails,
   * keeps the original content and logs a warning.
   * Core memory is never touched.
   */
  async compact(personaName: string, projectSlug: string, llmCaller: LlmCaller): Promise<void> {
    const filePath = this.getWorkingMemoryPath(personaName, projectSlug);

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

    const condensed = await llmCaller(COMPACTION_SYSTEM_PROMPT, content);

    // Validate compaction output
    const condensedLines = condensed.split('\n').filter((l) => l.trim().length > 0);
    const startsWithBullet = condensed.trimStart().startsWith('- [') || condensed.trimStart().startsWith('- ');
    const withinLineTarget = condensedLines.length <= COMPACTION_TARGET_LINES;

    if (!startsWithBullet || !withinLineTarget) {
      log.warn('compact: validation failed, keeping original working memory', {
        agent: personaName,
        project: projectSlug,
        startsWithBullet,
        condensedLines: condensedLines.length,
        targetLines: COMPACTION_TARGET_LINES,
      });
      return;
    }

    await writeFile(filePath, condensed, { encoding: 'utf-8' });
    log.info('working memory compacted', { agent: personaName, project: projectSlug });
  }

  // ---------------------------------------------------------------------------
  // Core promotion
  // ---------------------------------------------------------------------------

  /**
   * Append a lesson to `core.md` with a PATTERN/DECISION/ARCHITECTURE tag.
   * If the resulting file exceeds CORE_CHAR_BUDGET, logs a warning but does NOT
   * truncate — core memory requires manual review.
   */
  async promoteToCore(
    personaName: string,
    projectSlug: string,
    lesson: string,
    _llmCaller: LlmCaller,
  ): Promise<void> {
    const corePath = this.getCoreMemoryPath(personaName, projectSlug);
    const dir = join(corePath, '..');

    await mkdir(dir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const entry = `- [PATTERN] ${lesson} (promoted ${date})\n`;

    await writeFile(corePath, entry, { flag: 'a', encoding: 'utf-8' });

    const coreContent = await readFile(corePath, 'utf-8');
    if (coreContent.length > CORE_CHAR_BUDGET) {
      log.warn('core memory exceeds budget — manual review needed', {
        agent: personaName,
        project: projectSlug,
        size: coreContent.length,
        budget: CORE_CHAR_BUDGET,
      });
    }

    log.info('lesson promoted to core memory', { agent: personaName, project: projectSlug, lesson });
  }

  // ---------------------------------------------------------------------------
  // Reflection (entry point)
  // ---------------------------------------------------------------------------

  /**
   * Ask the LLM (in persona) to reflect on an interaction and persist the lessons.
   *
   * Flow:
   *  1. Build a role-flavored prompt from the persona and context.
   *  2. Call llmCaller with a minimal system prompt and the reflection prompt.
   *  3. Parse lines starting with "- " from the response as individual lessons.
   *  4. Skip writing if no lessons were extracted.
   *  5. Append the lessons as a dated IMemoryEntry to working.md.
   *  6. Run checkPromotion to identify lessons that may graduate to core.
   *  7. Compact working.md if it has grown beyond MAX_MEMORY_LINES.
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

    // Parse category tags from lessons: "[CATEGORY] lesson text (ref: path#L42)"
    const parsedCategory = extractCategory(lessons[0]);

    log.info('agent reflection', {
      agent: persona.name,
      project: projectSlug,
      trigger: context.triggerType,
      outcome: context.outcome,
      lessons: lessons.length,
      category: parsedCategory ?? undefined,
    });

    const entry: IMemoryEntry = {
      date: new Date().toISOString().split('T')[0],
      persona: persona.name,
      project: projectSlug,
      lessons,
      ...(parsedCategory !== null ? { category: parsedCategory } : {}),
    };

    await this.appendReflection(persona.name, projectSlug, entry);

    // Check if any lessons are recurring enough to promote to core
    await this.checkPromotion(persona.name, projectSlug, llmCaller);

    // Check line count and compact working memory if needed
    const workingPath = this.getWorkingMemoryPath(persona.name, projectSlug);
    let workingContent: string;
    try {
      workingContent = await readFile(workingPath, 'utf-8');
    } catch {
      return;
    }

    const lineCount = workingContent.split('\n').length;
    if (lineCount > MAX_MEMORY_LINES) {
      const compactionCaller: LlmCaller = (_systemPrompt, _userPrompt) =>
        llmCaller(COMPACTION_SYSTEM_PROMPT, buildCompactionPrompt(persona, workingContent));
      await this.compact(persona.name, projectSlug, compactionCaller);
    }
  }

  /**
   * Scan working memory for lessons whose themes appear >= PROMOTION_THRESHOLD
   * times across different dates. If found, call LLM to synthesize a core lesson
   * and promote it, then remove those entries from working.md.
   *
   * This is intentionally conservative — it only promotes when the same theme
   * has appeared repeatedly, indicating a durable pattern rather than a one-off.
   */
  async checkPromotion(
    personaName: string,
    projectSlug: string,
    llmCaller: LlmCaller,
  ): Promise<void> {
    const workingPath = this.getWorkingMemoryPath(personaName, projectSlug);

    let content: string;
    try {
      content = await readFile(workingPath, 'utf-8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return;
      }
      throw err;
    }

    // Extract dated sections and their lessons
    const sections = parseDateSections(content);
    if (sections.length < PROMOTION_THRESHOLD) {
      return;
    }

    // Build a flat list of all lessons with their source date
    const allLessons: Array<{ date: string; lesson: string }> = sections.flatMap((sec) =>
      sec.lessons.map((l) => ({ date: sec.date, lesson: l })),
    );

    if (allLessons.length < PROMOTION_THRESHOLD) {
      return;
    }

    // Find lessons that share a theme appearing across multiple dates.
    // We use a simplified keyword-overlap heuristic: any two lessons that
    // share >= 3 significant words are considered "related".
    const promoted: string[] = [];
    const used = new Set<number>();

    for (let i = 0; i < allLessons.length; i++) {
      if (used.has(i)) continue;

      const group: number[] = [i];
      const datesInGroup = new Set<string>([allLessons[i].date]);

      for (let j = i + 1; j < allLessons.length; j++) {
        if (used.has(j)) continue;
        if (lessonsSimilar(allLessons[i].lesson, allLessons[j].lesson)) {
          group.push(j);
          datesInGroup.add(allLessons[j].date);
        }
      }

      // Only promote if the theme appears across >= PROMOTION_THRESHOLD distinct dates
      if (datesInGroup.size >= PROMOTION_THRESHOLD) {
        const groupLessons = group.map((idx) => allLessons[idx].lesson);
        const synthesisPrompt =
          `Synthesize these related lessons into a single, concise core lesson (one bullet starting with "- [PATTERN] "):\n\n` +
          groupLessons.map((l) => `- ${l}`).join('\n');

        const synthesized = await llmCaller(
          'You are a memory synthesis assistant. Respond only with a single bullet point.',
          synthesisPrompt,
        );

        const coreLessonLine = synthesized
          .split('\n')
          .find((l) => l.trimStart().startsWith('- '));

        if (coreLessonLine) {
          const coreLesson = coreLessonLine.trimStart().slice(2).trim();
          await this.promoteToCore(personaName, projectSlug, coreLesson, llmCaller);
          promoted.push(...groupLessons);
          group.forEach((idx) => used.add(idx));
        }
      }
    }

    // Remove promoted lessons from working.md
    if (promoted.length > 0) {
      const promotedSet = new Set(promoted);
      const filteredLines = content
        .split('\n')
        .filter((line) => {
          const lessonText = line.trimStart().startsWith('- ')
            ? line.trimStart().slice(2).trim()
            : null;
          return lessonText === null || !promotedSet.has(lessonText);
        });
      await writeFile(workingPath, filteredLines.join('\n'), { encoding: 'utf-8' });
      log.info('promoted lessons removed from working memory', {
        agent: personaName,
        project: projectSlug,
        promoted: promoted.length,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Migration helpers
  // ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

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

interface IDateSection {
  date: string;
  lessons: string[];
}

/** Parse a memory file into date-keyed sections with their bullet lessons. */
function parseDateSections(content: string): IDateSection[] {
  const sections: IDateSection[] = [];
  let current: IDateSection | null = null;

  for (const line of content.split('\n')) {
    const headerMatch = /^## (\d{4}-\d{2}-\d{2})/.exec(line);
    if (headerMatch) {
      if (current) sections.push(current);
      current = { date: headerMatch[1], lessons: [] };
    } else if (current && line.trimStart().startsWith('- ')) {
      const lesson = line.trimStart().slice(2).trim();
      if (lesson.length > 0) {
        current.lessons.push(lesson);
      }
    }
  }

  if (current) sections.push(current);
  return sections;
}

/** Stop-words to exclude from similarity comparison. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'to', 'of', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'and', 'or', 'but', 'not', 'this', 'that', 'it',
  'its', 'we', 'you', 'i', 'they', 'them', 'their',
]);

/** Return significant words from a lesson string. */
function significantWords(lesson: string): Set<string> {
  return new Set(
    lesson
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

/** Return true if two lessons share >= 3 significant words (simple theme overlap). */
function lessonsSimilar(a: string, b: string): boolean {
  const wordsA = significantWords(a);
  const wordsB = significantWords(b);
  let shared = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      shared++;
      if (shared >= 3) return true;
    }
  }
  return false;
}

/** Known memory category tags emitted by the reflection prompt. */
const VALID_CATEGORIES = new Set(['PATTERN', 'DECISION', 'ARCHITECTURE', 'OBSERVATION', 'HYPOTHESIS', 'TODO']);

/**
 * Extract the category tag from a lesson string formatted as:
 *   "[CATEGORY] lesson text (ref: path/to/file.ts#L42-L45)"
 *
 * Returns the category string if it is a known category, otherwise null.
 */
function extractCategory(lesson: string): string | null {
  const match = /^\[([A-Z]+)\]/.exec(lesson.trim());
  if (!match) return null;
  const tag = match[1];
  return VALID_CATEGORIES.has(tag) ? tag : null;
}

/**
 * Return true when a string looks like a file reference: contains '/' or '#L'.
 * Used to validate (ref: ...) values parsed from lesson strings.
 */
function isValidRef(ref: string): boolean {
  return ref.includes('/') || ref.includes('#L');
}

// Re-export for backward compatibility (used by soul-compiler / tests)
export { MEMORY_CHAR_BUDGET, isValidRef };
