/**
 * Soul compiler for Night Watch agent personas.
 * Compiles SOUL + STYLE + SKILL JSON into a system prompt for the AI provider.
 */
import { IAgentPersona } from "@/shared/types.js";
/**
 * Compile an agent persona's soul layers into a system prompt string.
 * If systemPromptOverride is set, returns it directly.
 */
export declare function compileSoul(persona: IAgentPersona): string;
//# sourceMappingURL=soul-compiler.d.ts.map