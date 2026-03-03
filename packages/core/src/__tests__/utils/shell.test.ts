import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { executeScriptWithOutput } from "../../utils/shell.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "night-watch-shell-test-"));
}

describe("executeScriptWithOutput", () => {
  it("injects environment variables into the child process", async () => {
    const tempDir = makeTempDir();
    try {
      const scriptPath = path.join(tempDir, "print-env.sh");
      fs.writeFileSync(scriptPath, "#!/usr/bin/env bash\necho \"${NW_TEST_ENV:-}\"\n");

      const result = await executeScriptWithOutput(scriptPath, [], { NW_TEST_ENV: "scoped" });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("scoped");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runs scripts in the provided cwd", async () => {
    const tempDir = makeTempDir();
    const targetDir = path.join(tempDir, "target");
    fs.mkdirSync(targetDir, { recursive: true });

    try {
      const scriptPath = path.join(tempDir, "print-cwd.sh");
      fs.writeFileSync(scriptPath, "#!/usr/bin/env bash\npwd\n");

      const result = await executeScriptWithOutput(scriptPath, [], {}, { cwd: targetDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(targetDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
