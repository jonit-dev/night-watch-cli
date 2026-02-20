/**
 * Configuration loader for Night Watch CLI
 * Loads config from: defaults -> config file -> environment variables
 */
import { INightWatchConfig } from "./types.js";
/**
 * Get the default configuration values
 */
export declare function getDefaultConfig(): INightWatchConfig;
/**
 * Load Night Watch configuration
 * Priority: defaults < config file < environment variables
 *
 * @param projectDir - The project directory to load config from
 * @returns Merged configuration object
 */
export declare function loadConfig(projectDir: string): INightWatchConfig;
/**
 * Get the path to a bundled script
 * This returns the path to a script in the package's scripts/ directory
 */
export declare function getScriptPath(scriptName: string): string;
//# sourceMappingURL=config.d.ts.map