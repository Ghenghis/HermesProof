import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

test("automation runner refuses a native invocation without persisted lease authority", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-automation-runner-"));
  try {
    await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ name: "hermesproof" }));
    await assert.rejects(
      execFileAsync(process.execPath, [
        fileURLToPath(new URL("./automation-runner.mjs", import.meta.url)),
        "--workspace", workspaceRoot,
        "--job", "deep-doctor"
      ], { windowsHide: true, timeout: 15_000 }),
      /automation-state|no such file|ENOENT/i
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
