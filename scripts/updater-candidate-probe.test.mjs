import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { probeCandidateServer } from "./updater-candidate-probe.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("candidate probe performs a real core MCP handshake and lists its registry", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-candidate-probe-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const result = await probeCandidateServer({
    candidateRoot: repoRoot,
    workspaceRoot,
    server: "hermes3d-locks"
  });
  assert.equal(result.ok, true);
  assert.equal(result.server, "hermes3d-locks");
  assert.equal(result.toolCount, 121);
  assert.equal(result.tools.includes("hermes_doctor"), true);
});

test("candidate probe rejects unknown server names before process launch", async () => {
  await assert.rejects(
    probeCandidateServer({ candidateRoot: repoRoot, workspaceRoot: repoRoot, server: "shell" }),
    /server is not allowlisted/
  );
});
