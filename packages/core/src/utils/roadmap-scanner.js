/**
 * Roadmap Scanner for Night Watch CLI
 * Scans ROADMAP.md files and generates PRD skeleton files
 */
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { getNextPrdNumber, slugify } from "./prd-utils.js";
import { parseRoadmap } from "./roadmap-parser.js";
import { isItemProcessed, loadRoadmapState, markItemProcessed, saveRoadmapState, } from "./roadmap-state.js";
import { createSlicerPromptVars, renderSlicerPrompt, } from "../templates/slicer-prompt.js";
/**
 * Get the current status of the roadmap scanner
 *
 * @param projectDir - The project directory
 * @param config - The Night Watch configuration
 * @returns The roadmap scanner status
 */
export function getRoadmapStatus(projectDir, config) {
    const roadmapPath = path.join(projectDir, config.roadmapScanner.roadmapPath);
    // Check if enabled
    if (!config.roadmapScanner.enabled) {
        return {
            found: false,
            enabled: false,
            totalItems: 0,
            processedItems: 0,
            pendingItems: 0,
            status: "disabled",
            items: [],
        };
    }
    // Check if roadmap file exists
    if (!fs.existsSync(roadmapPath)) {
        return {
            found: false,
            enabled: true,
            totalItems: 0,
            processedItems: 0,
            pendingItems: 0,
            status: "no-roadmap",
            items: [],
        };
    }
    // Parse roadmap
    const content = fs.readFileSync(roadmapPath, "utf-8");
    const items = parseRoadmap(content);
    // Load state
    const prdDir = path.join(projectDir, config.prdDir);
    const state = loadRoadmapState(prdDir);
    // Scan existing PRD files for title-based duplicate detection
    const existingPrdSlugs = scanExistingPrdSlugs(prdDir);
    // Build status items
    const statusItems = items.map((item) => {
        const processed = isItemProcessed(state, item.hash);
        const stateItem = state.items[item.hash];
        // Also check for duplicates by title match
        const itemSlug = slugify(item.title);
        const isDuplicateByTitle = existingPrdSlugs.has(itemSlug) && !processed;
        return {
            ...item,
            processed: processed || isDuplicateByTitle,
            prdFile: stateItem?.prdFile,
        };
    });
    // Count processed and pending
    const processedItems = statusItems.filter((item) => item.processed).length;
    const pendingItems = statusItems.filter((item) => !item.processed && !item.checked).length;
    // Determine status
    let status;
    if (pendingItems === 0 && statusItems.length > 0) {
        status = "complete";
    }
    else {
        status = "idle";
    }
    return {
        found: true,
        enabled: true,
        totalItems: items.length,
        processedItems,
        pendingItems,
        status,
        items: statusItems,
    };
}
/**
 * Scan existing PRD files and extract their slugs for duplicate detection
 */
function scanExistingPrdSlugs(prdDir) {
    const slugs = new Set();
    if (!fs.existsSync(prdDir)) {
        return slugs;
    }
    const files = fs.readdirSync(prdDir);
    for (const file of files) {
        // Skip non-markdown files and special files
        if (!file.endsWith(".md") || file === "NIGHT-WATCH-SUMMARY.md") {
            continue;
        }
        // Extract slug from filename (e.g., "01-feature-name.md" -> "feature-name")
        const match = file.match(/^\d+-(.+)\.md$/);
        if (match) {
            slugs.add(match[1]);
        }
        else {
            // Handle files without number prefix
            const slugMatch = file.match(/^(.+)\.md$/);
            if (slugMatch) {
                slugs.add(slugMatch[1]);
            }
        }
    }
    return slugs;
}
/**
 * Build provider CLI arguments based on provider type
 */
function buildProviderArgs(provider, prompt) {
    if (provider === "codex") {
        return ["--quiet", "--yolo", "--prompt", prompt];
    }
    // Default: claude
    return ["-p", prompt, "--dangerously-skip-permissions"];
}
/**
 * Slice a single roadmap item into a PRD using the AI provider
 *
 * @param projectDir - The project directory
 * @param prdDir - The PRD directory
 * @param item - The roadmap item to slice
 * @param config - The Night Watch configuration
 * @returns The slice result
 */
export async function sliceRoadmapItem(projectDir, prdDir, item, config) {
    // Check for duplicate by slug
    const itemSlug = slugify(item.title);
    const existingPrdSlugs = scanExistingPrdSlugs(prdDir);
    if (existingPrdSlugs.has(itemSlug)) {
        return {
            sliced: false,
            error: `Duplicate detected: PRD with slug "${itemSlug}" already exists`,
            item,
        };
    }
    // Compute next PRD number and filename
    const nextNum = getNextPrdNumber(prdDir);
    const padded = String(nextNum).padStart(2, "0");
    const filename = `${padded}-${itemSlug}.md`;
    const filePath = path.join(prdDir, filename);
    // Ensure PRD directory exists
    if (!fs.existsSync(prdDir)) {
        fs.mkdirSync(prdDir, { recursive: true });
    }
    // Build slicer prompt
    const promptVars = createSlicerPromptVars(item.title, item.section, item.description, prdDir, filename);
    const prompt = renderSlicerPrompt(promptVars);
    // Spawn the AI provider
    const providerArgs = buildProviderArgs(config.provider, prompt);
    // Create log file for stdout/stderr
    const logDir = path.join(projectDir, "logs");
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, `slicer-${itemSlug}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: "w" });
    // Handle log stream errors silently (don't fail the slice on logging errors)
    logStream.on("error", () => {
        // Silently ignore log file errors - the main operation is more important
    });
    return new Promise((resolve) => {
        // Merge providerEnv with process.env
        const childEnv = {
            ...process.env,
            ...config.providerEnv,
        };
        const child = spawn(config.provider, providerArgs, {
            env: childEnv,
            cwd: projectDir,
            stdio: ["inherit", "pipe", "pipe"],
        });
        // Pipe stdout to log file
        child.stdout?.on("data", (data) => {
            logStream.write(data);
        });
        // Pipe stderr to log file
        child.stderr?.on("data", (data) => {
            logStream.write(data);
        });
        // Handle process errors
        child.on("error", (error) => {
            logStream.end();
            resolve({
                sliced: false,
                error: `Failed to spawn provider: ${error.message}`,
                item,
            });
        });
        // Handle process completion
        child.on("close", (code) => {
            logStream.end();
            if (code !== 0) {
                resolve({
                    sliced: false,
                    error: `Provider exited with code ${code ?? 1}`,
                    item,
                });
                return;
            }
            // Verify output file was created
            if (!fs.existsSync(filePath)) {
                resolve({
                    sliced: false,
                    error: `Provider did not create expected file: ${filePath}`,
                    item,
                });
                return;
            }
            resolve({
                sliced: true,
                file: filename,
                item,
            });
        });
    });
}
/**
 * Slice the next unprocessed roadmap item
 *
 * @param projectDir - The project directory
 * @param config - The Night Watch configuration
 * @returns The slice result
 */
export async function sliceNextItem(projectDir, config) {
    // Check if scanner is enabled
    if (!config.roadmapScanner.enabled) {
        return {
            sliced: false,
            error: "Roadmap scanner is disabled",
        };
    }
    const roadmapPath = path.join(projectDir, config.roadmapScanner.roadmapPath);
    // Check if roadmap file exists
    if (!fs.existsSync(roadmapPath)) {
        return {
            sliced: false,
            error: "ROADMAP.md not found",
        };
    }
    // Parse roadmap
    const content = fs.readFileSync(roadmapPath, "utf-8");
    const items = parseRoadmap(content);
    if (items.length === 0) {
        return {
            sliced: false,
            error: "No items in roadmap",
        };
    }
    // Setup PRD directory
    const prdDir = path.join(projectDir, config.prdDir);
    // Load state
    const state = loadRoadmapState(prdDir);
    // Scan existing PRD files for duplicate detection
    const existingPrdSlugs = scanExistingPrdSlugs(prdDir);
    // Find first unprocessed, unchecked, non-duplicate item
    let targetItem;
    for (const item of items) {
        // Skip checked items
        if (item.checked) {
            continue;
        }
        // Skip already processed items
        if (isItemProcessed(state, item.hash)) {
            continue;
        }
        // Skip duplicates by title
        const itemSlug = slugify(item.title);
        if (existingPrdSlugs.has(itemSlug)) {
            continue;
        }
        targetItem = item;
        break;
    }
    if (!targetItem) {
        return {
            sliced: false,
            error: "No pending items to process",
        };
    }
    // Slice the item
    const result = await sliceRoadmapItem(projectDir, prdDir, targetItem, config);
    // On success, update state
    if (result.sliced && result.file) {
        let updatedState = loadRoadmapState(prdDir);
        const stateItem = {
            title: targetItem.title,
            prdFile: result.file,
            createdAt: new Date().toISOString(),
        };
        updatedState = markItemProcessed(updatedState, targetItem.hash, stateItem);
        saveRoadmapState(prdDir, updatedState);
    }
    return result;
}
/**
 * Scan the roadmap and slice ONE item
 * This is now async and processes only a single item per call
 *
 * @param projectDir - The project directory
 * @param config - The Night Watch configuration
 * @returns The scan result with created, skipped, and error lists
 */
export async function scanRoadmap(projectDir, config) {
    const result = {
        created: [],
        skipped: [],
        errors: [],
    };
    // Slice just one item
    const sliceResult = await sliceNextItem(projectDir, config);
    if (sliceResult.sliced && sliceResult.file) {
        result.created.push(sliceResult.file);
    }
    else if (sliceResult.item) {
        // Item was found but not sliced
        if (sliceResult.error?.includes("checked")) {
            result.skipped.push(`${sliceResult.item.title} (checked)`);
        }
        else if (sliceResult.error?.includes("processed")) {
            result.skipped.push(`${sliceResult.item.title} (processed)`);
        }
        else if (sliceResult.error?.includes("duplicate")) {
            result.skipped.push(`${sliceResult.item.title} (duplicate)`);
        }
        else if (sliceResult.error) {
            result.errors.push(`${sliceResult.item.title}: ${sliceResult.error}`);
        }
    }
    // If no item was found (all done or no items), return empty result
    return result;
}
/**
 * Check if there are new (unprocessed) items in the roadmap
 */
export function hasNewItems(projectDir, config) {
    const status = getRoadmapStatus(projectDir, config);
    return status.pendingItems > 0;
}
//# sourceMappingURL=roadmap-scanner.js.map