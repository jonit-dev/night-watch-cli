/**
 * PRD state persistence for Night Watch CLI
 * Tracks pending-review (and future) PRD states via the SQLite repository layer.
 */
import { getRepositories } from "../storage/repositories/index.js";
export function readPrdStates() {
    const { prdState } = getRepositories();
    return prdState.readAll();
}
export function getPrdStatesForProject(projectDir) {
    const { prdState } = getRepositories();
    return prdState.getAll(projectDir);
}
export function writePrdState(projectDir, prdName, entry) {
    const { prdState } = getRepositories();
    prdState.set(projectDir, prdName, entry);
}
export function clearPrdState(projectDir, prdName) {
    const { prdState } = getRepositories();
    prdState.delete(projectDir, prdName);
}
export function listPrdStatesByStatus(projectDir, status) {
    const states = getPrdStatesForProject(projectDir);
    return Object.entries(states)
        .filter(([, entry]) => entry.status === status)
        .map(([prdName]) => prdName);
}
//# sourceMappingURL=prd-states.js.map