/**
 * PRD state persistence for Night Watch CLI
 * Tracks pending-review (and future) PRD states via the SQLite repository layer.
 */
export interface IPrdStateEntry {
    status: "pending-review";
    branch: string;
    timestamp: number;
}
export type IPrdStates = Record<string, Record<string, IPrdStateEntry>>;
export declare function readPrdStates(): IPrdStates;
export declare function getPrdStatesForProject(projectDir: string): Record<string, IPrdStateEntry>;
export declare function writePrdState(projectDir: string, prdName: string, entry: IPrdStateEntry): void;
export declare function clearPrdState(projectDir: string, prdName: string): void;
export declare function listPrdStatesByStatus(projectDir: string, status: "pending-review"): string[];
//# sourceMappingURL=prd-states.d.ts.map