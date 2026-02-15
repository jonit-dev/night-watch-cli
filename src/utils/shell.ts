/**
 * Shell execution utility for running bash scripts
 */

import { spawn } from "child_process";

/**
 * Execute a bash script with arguments and environment variables
 *
 * @param scriptPath - Absolute path to the bash script to execute
 * @param args - Arguments to pass to the script
 * @param env - Environment variables to set for the child process
 * @returns Promise that resolves with the exit code (0 for success)
 */
export async function executeScript(
  scriptPath: string,
  args: string[] = [],
  env: Record<string, string> = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    // Merge provided env with process.env, with provided env taking precedence
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...env,
    };

    const child = spawn("bash", [scriptPath, ...args], {
      env: childEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });

    // Stream stdout to console in real-time
    child.stdout?.on("data", (data: Buffer) => {
      process.stdout.write(data);
    });

    // Stream stderr to console in real-time
    child.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(data);
    });

    // Handle process errors
    child.on("error", (error: Error) => {
      console.error(`Failed to execute script: ${scriptPath}`);
      console.error(error.message);
      reject(error);
    });

    // Handle process completion
    child.on("close", (code: number | null) => {
      resolve(code ?? 1);
    });
  });
}
