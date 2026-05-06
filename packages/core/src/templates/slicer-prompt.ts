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

1. **Explore the Codebase** — Read relevant existing files to understand structure, patterns, and conventions. Look for:
   - \`CLAUDE.md\` or similar AI assistant documentation
   - Existing code in the area you'll be modifying
   - Related features or modules this feature interacts with
   - Test patterns and verification commands
   - \`.env\` files or env-loading utilities (use those patterns, never hardcode values)

2. **Assess Complexity** — Score using the rubric below and determine LOW / MEDIUM / HIGH.

3. **Write a Complete PRD** — Follow the exact template structure below. Every section must be filled with concrete information. No placeholder text.

   The PRD MUST include these sections: Context (with Problem, Files Analyzed, Current Behavior, Integration Points), Solution (with Approach, Key Decisions), Execution Phases (with Files, Implementation steps, Tests), and Acceptance Criteria.

4. **Write the PRD File** — Use the Write tool to create the PRD file at \`{{OUTPUT_FILE_PATH}}\`.

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
| 1-3   | LOW    | Minimal (skip sections marked MEDIUM/HIGH)      |
| 4-6   | MEDIUM | Standard (all sections)                         |
| 7+    | HIGH   | Full + mandatory checkpoints every phase        |
\`\`\`

---

## PRD Template Structure

Your PRD MUST follow this exact structure. Replace every \`[bracketed placeholder]\` with real content.

\`\`\`\`markdown
# PRD: [Title from roadmap item]

**Complexity: [SCORE] → [LEVEL] mode**

- [Complexity breakdown as bullet list]

---

## 1. Context

**Problem:** [1-2 sentences describing the issue being solved]

**Files Analyzed:**

- \`path/to/file.ts\` — [what the file does / what you looked for]
- [List every file you read before writing this PRD]

**Current Behavior:**

- [3-5 bullets describing what happens today]

### Integration Points

**How will this feature be reached?**

- [ ] Entry point: [cron job / CLI command / event / API route]
- [ ] Caller file: [file that will invoke this new code]
- [ ] Registration/wiring: [anything that must be connected]

**Is this user-facing?**

- [ ] YES → UI components required: [list them]
- [ ] NO → Internal/background (explain how it is triggered)

**Full user flow:**

1. User does: [action]
2. Triggers: [code path]
3. Reaches new feature via: [specific connection point]
4. Result: [what the user sees]

---

## 2. Solution

**Approach:**

- [3-5 bullets explaining the chosen solution]

**Architecture Diagram** (MEDIUM/HIGH):

\`\`\`mermaid
flowchart LR
    A[Component A] --> B[Component B] --> C[Result]
\`\`\`

**Key Decisions:**

- [Library/framework choices, error-handling strategy, reused utilities]

**Data Changes:** [New schemas/migrations, or "None"]

---

## 3. Sequence Flow (MEDIUM/HIGH)

\`\`\`mermaid
sequenceDiagram
    participant A as ComponentA
    participant B as ComponentB
    A->>B: methodName(args)
    alt Error
        B-->>A: ErrorType
    else Success
        B-->>A: Response
    end
\`\`\`

---

## 4. Execution Phases

Critical rules:
1. Each phase = ONE user-testable vertical slice
2. Max 5 files per phase (split if larger)
3. Each phase MUST include concrete tests
4. Checkpoint after each phase

### Phase 1: [Name] — [User-visible outcome in 1 sentence]

**Files (max 5):**

- \`src/path/file.ts\` — [what changes]

**Implementation:**

- [ ] Step 1
- [ ] Step 2

**Tests Required:**
| Test File | Test Name | Assertion |
|-----------|-----------|-----------|
| \`src/__tests__/feature.test.ts\` | \`should do X when Y\` | \`expect(result).toBe(Z)\` |

**Verification Plan:**

1. **Unit Tests:** [file and test names]
2. **User Verification:**
   - Action: [what to do]
   - Expected: [what should happen]

**Checkpoint:** Run \`yarn verify\` and related tests after this phase.

---

[Repeat Phase block for each additional phase]

---

## 5. Acceptance Criteria

- [ ] All phases complete
- [ ] All specified tests pass
- [ ] \`yarn verify\` passes
- [ ] Feature is reachable (entry point connected, not orphaned code)
- [ ] [Feature-specific criterion]
- [ ] [Feature-specific criterion]
\`\`\`\`

---

## Critical Instructions

1. **Read all relevant files BEFORE writing the PRD** — never guess at file paths or API shapes
2. **Follow existing patterns** — reuse utilities, match naming conventions, use path aliases (\`@/*\`)
3. **Concrete file paths and implementation details** — no vague steps
4. **Specific test names and assertions** — not "write tests"
5. **Use the Write tool** to create the file at \`{{OUTPUT_FILE_PATH}}\`
6. **No placeholder text** in the final PRD — every section must have real content
7. **Self-contained** — the PRD will be read as a GitHub issue; it must make sense without context

DO NOT leave \`[bracketed placeholder]\` text in the output.
DO NOT skip any sections.
DO NOT forget to write the file.

---

## Output

After writing the PRD file, report:

\`\`\`
PRD Creation Complete
File: {{OUTPUT_FILE_PATH}}
Title: [PRD title]
Complexity: [score] → [level]
Phases: [count]
Summary: [1-2 sentences]
\`\`\`
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

  const candidatePaths = templateDir
    ? [path.join(templateDir, 'slicer.md')]
    : [
        path.resolve(__dirname, 'slicer.md'),
        path.resolve(__dirname, '..', 'templates', 'slicer.md'),
        path.resolve(__dirname, '..', '..', '..', '..', 'templates', 'slicer.md'),
      ];
  const templatePath =
    candidatePaths.find((candidate) => fs.existsSync(candidate)) ?? candidatePaths[0]!;

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
