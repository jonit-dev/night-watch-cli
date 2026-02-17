/**
 * Serve command for Night Watch CLI
 * Starts the HTTP API server for the Web UI
 */

import { Command } from "commander";
import { startServer } from "../server/index.js";

export function serveCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the Night Watch web UI server")
    .option("-p, --port <number>", "Port to run the server on", "7575")
    .action((options) => {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${options.port}. Port must be between 1 and 65535.`);
        process.exit(1);
      }
      const projectDir = process.cwd();
      startServer(projectDir, port);
    });
}
