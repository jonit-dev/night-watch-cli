/**
 * Slicer Prompt Template
 *
 * Provides functionality to render the AI prompt for generating PRDs from roadmap items.
 * The template is loaded from templates/slicer.md and interpolated with
 * runtime values from the roadmap item being processed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Variables needed to render the slicer prompt
 */
export interface ISlicerPromptVars {
  /** The title of the roadmap item */
  title: string;
  /** The section/category of the roadmap item */
  section: string;
  /** The description of the roadmap item */
  description: string;
  /** The full path where the PRD should be written */
  outputFilePath: string;
  /** The directory containing PRDs */
  prdDir: string;
}

/**
 * The default slicer prompt template.
 * This is used if the template file cannot be read.
 * Keep in sync with templates/slicer.md.
 */
const DEFAULT_SLICER_TEMPLATE = `You are a **Principal Software Architect**. Your job: analyze the codebase and write a complete Product Requirements Document (PRD) for a feature. The PRD will be used directly as a GitHub issue body, so it must be self-contained and immediately actionable by an engineer.

When this activates: \`Planning Mode: Principal Architect\`

---

## Input

You are creating a PRD for the following roadmap item:

**Section:** {{SECTION}}
**Title:** {{TITLE}}
**Description:** {{DESCRIPTION}}

The PRD must be written to this exact file path:
**Output File:** \`{{OUTPUT_FILE_PATH}}\`

The PRD directory is: \`{{PRD_DIR}}\`

---

## Your Task

1. **Explore the Codebase** — Read relevant existing files to understand structure, patterns, and conventions.
2. **Assess Complexity** — Score using the rubric below and determine LOW / MEDIUM / HIGH.
3. **Write a Complete PRD** — Follow the exact template structure below. Every section must be filled with concrete information.
4. **Write the PRD File** — Use the Write tool to create the PRD file at \`{{OUTPUT_FILE_PATH}}\`.

---

## Complexity Scoring

\`\`\`
+1  Touches 1-5 files
+2  Touches 6-10 files
+3  Touches 10+ files
+2  New system/module from scratch
+2  Complex state logic / concurrency
+2  Multi-package changes
+1  Database schema changes
+1  External API integration

| Score | Level  | Template Mode                                   |
| ----- | ------ | ----------------------------------------------- |
| 1-3   | LOW    | Minimal (skip sections marked MEDIUM/HIGH)      |
| 4-6   | MEDIUM | Standard (all sections)                         |
| 7+    | HIGH   | Full + mandatory checkpoints every phase        |
\`\`\`

---

## PRD Template Structure

Your PRD MUST use this structure. Replace every [bracketed placeholder] with real content.

# PRD: [Title]

**Complexity: [SCORE] → [LEVEL] mode**

## 1. Context

**Problem:** [1-2 sentences]

**Files Analyzed:**
- \`path/to/file.ts\` — [what you found]

**Current Behavior:**
- [3-5 bullets]

### Integration Points
- Entry point: [cron / CLI / event / route]
- Caller file: [file invoking new code]
- User flow: User does X → triggers Y → result Z

## 2. Solution

**Approach:**
- [3-5 bullets]

**Key Decisions:** [library choices, error handling, reused utilities]

**Data Changes:** [schema changes, or "None"]

## 3. Sequence Flow (MEDIUM/HIGH only)

[mermaid sequenceDiagram]

## 4. Execution Phases

### Phase N: [Name] — [User-visible outcome]

**Files (max 5):**
- \`src/path/file.ts\` — [what changes]

**Implementation:**
- [ ] Step 1

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| \`src/__tests__/feature.test.ts\` | \`should X when Y\` | \`expect(r).toBe(Z)\` |

**Checkpoint:** Run \`yarn verify\` and related tests after this phase.

## 5. Acceptance Criteria

- [ ] All phases complete
- [ ] All tests pass
- [ ] \`yarn verify\` passes
- [ ] Feature is reachable (not orphaned code)

---

## Critical Instructions

1. Read all relevant files BEFORE writing the PRD
2. Follow existing patterns — use \`@/*\` path aliases, match naming conventions
3. Include concrete file paths and implementation steps
4. Include specific test names and assertions
5. Use the Write tool to create the file at \`{{OUTPUT_FILE_PATH}}\`
6. No placeholder text in the final PRD
7. The PRD is the GitHub issue body — make it self-contained

DO NOT leave [bracketed placeholder] text in the output.
DO NOT skip any sections.
DO NOT forget to write the file.
`;

// Cache for the loaded template
let cachedTemplate: string | null = null;

/**
 * Load the slicer prompt template from the templates directory.
 * Falls back to the default template if the file cannot be read.
 *
 * @param templateDir - Optional custom template directory
 * @returns The template string
 */
export function loadSlicerTemplate(templateDir?: string): string {
  if (cachedTemplate) {
    return cachedTemplate;
  }

  // Determine the template file path
  const templatePath = templateDir
    ? path.join(templateDir, 'slicer.md')
    : path.resolve(__dirname, '..', '..', 'templates', 'slicer.md');

  try {
    cachedTemplate = fs.readFileSync(templatePath, 'utf-8');
    return cachedTemplate;
  } catch (error) {
    // Fall back to the default template
    console.warn(
      `Warning: Could not load slicer template from ${templatePath}, using default:`,
      error instanceof Error ? error.message : String(error),
    );
    return DEFAULT_SLICER_TEMPLATE;
  }
}

/**
 * Clear the cached template (useful for testing)
 */
export function clearTemplateCache(): void {
  cachedTemplate = null;
}

/**
 * Render the slicer prompt by interpolating the template with the provided variables.
 *
 * @param vars - The variables to interpolate into the template
 * @param customTemplate - Optional custom template to use instead of the default
 * @returns The rendered prompt string
 */
export function renderSlicerPrompt(vars: ISlicerPromptVars, customTemplate?: string): string {
  const template = customTemplate ?? loadSlicerTemplate();

  let result = template;

  // Replace all placeholders with their values
  result = result.replace(/\{\{TITLE\}\}/g, vars.title);
  result = result.replace(/\{\{SECTION\}\}/g, vars.section);
  result = result.replace(/\{\{DESCRIPTION\}\}/g, vars.description);
  result = result.replace(/\{\{OUTPUT_FILE_PATH\}\}/g, vars.outputFilePath);
  result = result.replace(/\{\{PRD_DIR\}\}/g, vars.prdDir);

  return result;
}

/**
 * Create slicer prompt variables from a roadmap item.
 *
 * @param item - The roadmap item title
 * @param section - The roadmap item section
 * @param description - The roadmap item description
 * @param prdDir - The PRD directory path
 * @param prdFilename - The filename for the new PRD
 * @returns The slicer prompt variables
 */
export function createSlicerPromptVars(
  title: string,
  section: string,
  description: string,
  prdDir: string,
  prdFilename: string,
): ISlicerPromptVars {
  return {
    title,
    section,
    description: description || '(No description provided)',
    outputFilePath: path.join(prdDir, prdFilename),
    prdDir,
  };
}
