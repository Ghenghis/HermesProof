import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GateRunner } from "./gate-runner.mjs";

test("npm gate executes through the real Windows npm shim without spawn EINVAL", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-gate-npm-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify({
      name: "hermesproof-gate-fixture",
      private: true,
      scripts: { test: "node -e \"process.stdout.write('gate-ok')\"" }
    }) + "\n",
    "utf8"
  );

  const boundedPath = process.platform === "win32"
    ? [path.dirname(process.execPath), path.join(process.env.SystemRoot || "C:\\Windows", "System32")].join(";")
    : process.env.PATH;
  const result = await new GateRunner({ workspaceRoot }).runGate({
    owner: "codex-test",
    gateId: "npm-test",
    env: { PATH: boundedPath }
  });

  assert.equal(result.ok, true, result.report.stderr_tail);
  assert.match(result.report.stdout_tail, /gate-ok/);
});
