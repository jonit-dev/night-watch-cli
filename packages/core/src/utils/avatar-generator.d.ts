/**
 * Generates persona avatars using Replicate's Flux 1.1 Pro model.
 * Output URLs are valid for ~1 hour; Slack caches them on first display.
 */
export declare function generatePersonaAvatar(personaName: string, personaRole: string, apiToken: string): Promise<string | null>;
//# sourceMappingURL=avatar-generator.d.ts.map