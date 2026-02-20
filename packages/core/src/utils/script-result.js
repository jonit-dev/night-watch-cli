/**
 * Parse machine-readable execution markers emitted by bash scripts.
 *
 * Format:
 *   NIGHT_WATCH_RESULT:<status>|key=value|key=value
 */
const RESULT_PREFIX = "NIGHT_WATCH_RESULT:";
export function parseScriptResult(output) {
    if (!output || output.trim().length === 0) {
        return null;
    }
    const lines = output.split(/\r?\n/);
    // Use the most recent marker in case multiple scripts were chained.
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim();
        if (!line.startsWith(RESULT_PREFIX)) {
            continue;
        }
        const payload = line.slice(RESULT_PREFIX.length).trim();
        if (!payload) {
            return null;
        }
        const [statusRaw, ...parts] = payload.split("|");
        const status = statusRaw.trim();
        if (!status) {
            return null;
        }
        const data = {};
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed)
                continue;
            const eqIndex = trimmed.indexOf("=");
            if (eqIndex <= 0)
                continue;
            const key = trimmed.slice(0, eqIndex).trim();
            const value = trimmed.slice(eqIndex + 1).trim();
            if (!key)
                continue;
            data[key] = value;
        }
        return { status, data };
    }
    return null;
}
//# sourceMappingURL=script-result.js.map