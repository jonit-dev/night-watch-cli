/**
 * Slicer Prompt Template
 *
 * Provides functionality to render the AI prompt for generating PRDs from roadmap items.
 * The template is loaded from templates/night-watch-slicer.md and interpolated with
 * runtime values from the roadmap item being processed.
 */
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
 * Load the slicer prompt template from the templates directory.
 * Falls back to the default template if the file cannot be read.
 *
 * @param templateDir - Optional custom template directory
 * @returns The template string
 */
export declare function loadSlicerTemplate(templateDir?: string): string;
/**
 * Clear the cached template (useful for testing)
 */
export declare function clearTemplateCache(): void;
/**
 * Render the slicer prompt by interpolating the template with the provided variables.
 *
 * @param vars - The variables to interpolate into the template
 * @param customTemplate - Optional custom template to use instead of the default
 * @returns The rendered prompt string
 */
export declare function renderSlicerPrompt(vars: ISlicerPromptVars, customTemplate?: string): string;
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
export declare function createSlicerPromptVars(title: string, section: string, description: string, prdDir: string, prdFilename: string): ISlicerPromptVars;
//# sourceMappingURL=slicer-prompt.d.ts.map