/**
 * Parse machine-readable execution markers emitted by bash scripts.
 *
 * Format:
 *   NIGHT_WATCH_RESULT:<status>|key=value|key=value
 */
export interface IScriptResult {
    status: string;
    data: Record<string, string>;
}
export declare function parseScriptResult(output: string): IScriptResult | null;
//# sourceMappingURL=script-result.d.ts.map