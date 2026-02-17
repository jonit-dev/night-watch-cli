/**
 * Slicer Prompt Template
 *
 * Provides functionality to render the AI prompt for generating PRDs from roadmap items.
 * The template is loaded from templates/night-watch-slicer.md and interpolated with
 * runtime values from the roadmap item being processed.
 */

import * as fs from "fs";
import * as path from "path";

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
 */
const DEFAULT_SLICER_TEMPLATE = `You are a **PRD Creator Agent**. Your job: analyze the codebase and write a complete Product Requirements Document (PRD) for a feature.

When this activates: \`PRD Creator: Initializing\`

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

1. **Explore the Codebase** - Read relevant existing files to understand the project structure, patterns, and conventions.

2. **Assess Complexity** - Score the complexity using the rubric and determine whether this is LOW, MEDIUM, or HIGH complexity.

3. **Write a Complete PRD** - Create a full PRD following the prd-creator template structure with Context, Solution, Phases, Tests, and Acceptance Criteria.

4. **Write the PRD File** - Use the Write tool to create the PRD file at the exact path specified in \`{{OUTPUT_FILE_PATH}}\`.

---

## Complexity Scoring

\`\`\`
COMPLEXITY SCORE (sum all that apply):
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
| 1-3   | LOW    | Minimal (skip sections marked with MEDIUM/HIGH) |
| 4-6   | MEDIUM | Standard (all sections)                         |
| 7+    | HIGH   | Full + mandatory checkpoints every phase        |
\`\`\`

---

## PRD Template Structure

Your PRD MUST follow this exact structure with these sections:
1. **Context** - Problem, files analyzed, current behavior, integration points
2. **Solution** - Approach, architecture diagram, key decisions, data changes
3. **Sequence Flow** (MEDIUM/HIGH) - Mermaid sequence diagram
4. **Execution Phases** - Concrete phases with files, implementation steps, and tests
5. **Acceptance Criteria** - Checklist of completion requirements

---

## Critical Instructions

1. **Read all relevant existing files BEFORE writing any code**
2. **Follow existing patterns in the codebase**
3. **Write the PRD with concrete file paths and implementation details**
4. **Include specific test names and assertions**
5. **Use the Write tool to create the PRD file at \`{{OUTPUT_FILE_PATH}}\`**
6. **The PRD must be complete and actionable - no TODO placeholders**

DO NOT leave placeholder text like "[Name]" or "[description]" in the final PRD.
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
    ? path.join(templateDir, "night-watch-slicer.md")
    : path.resolve(__dirname, "..", "..", "templates", "night-watch-slicer.md");

  try {
    cachedTemplate = fs.readFileSync(templatePath, "utf-8");
    return cachedTemplate;
  } catch (_error) {
    // Fall back to the default template
    console.warn(
      `Warning: Could not load slicer template from ${templatePath}, using default`,
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
export function renderSlicerPrompt(
  vars: ISlicerPromptVars,
  customTemplate?: string,
): string {
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
    description: description || "(No description provided)",
    outputFilePath: path.join(prdDir, prdFilename),
    prdDir,
  };
}
