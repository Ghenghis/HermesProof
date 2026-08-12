import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const server = path.join(root, "src", "server.mjs");
const sha = "a".repeat(64);

function git(dir, args) {
  const proc = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
  return proc.stdout.trim();
}

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hp-hybrid-stdio-"));
  await fs.writeFile(path.join(dir, "README.md"), "# proof\n", "utf8");
  git(dir, ["init"]);
  git(dir, ["add", "README.md"]);
  git(dir, ["-c", "user.email=test@example.invalid", "-c", "user.name=Proof", "commit", "-m", "init"]);
  return dir;
}

async function start(dir) {
  const proc = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, MCP_LOCK_WORKSPACE: dir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let buffer = "";
  let next = 1;
  proc.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  });
  proc.on("error", (err) => {
    for (const waiter of pending.values()) waiter.reject(err);
    pending.clear();
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP request timed out: ${method}`));
    }, 10_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "hybrid-helper-stdio", version: "1" },
  });
  proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  return {
    call: (name, args) => request("tools/call", { name, arguments: args }),
    list: () => request("tools/list", {}),
    stop: () => {
      proc.stdin.end();
      proc.kill();
    },
  };
}

function result(response) {
  assert.equal(response.result?.isError, undefined, response.result?.content?.[0]?.text);
  return JSON.parse(response.result?.content?.[0]?.text || "{}");
}

test("hybrid helper MCP tools register and return fact verdicts through stdio", { timeout: 30_000 }, async () => {
  const dir = await setup();
  const client = await start(dir);
  try {
    const list = await client.list();
    const names = new Set((list.result?.tools || []).map((tool) => tool.name));
    for (const name of ["hermes_workspace_hygiene", "hermes_staleness_evaluate", "hermes_helper_runtime_evaluate", "hermes_storage_census", "hermes_archive_plan"]) {
      assert.ok(names.has(name), `tools/list missing ${name}`);
    }
    const hygiene = result(await client.call("hermes_workspace_hygiene", {}));
    assert.equal(hygiene.ok, true);
    assert.equal(hygiene.verdict, "pass");
    const storage = result(await client.call("hermes_storage_census", { maxFiles: 1, maxDepth: 2, groupDepth: 1 }));
    assert.equal(storage.ok, false);
    assert.equal(storage.verdict, "blocked");
    assert.ok(storage.findings.some((finding) => finding.endsWith(":file_limit_reached")));
    const stale = result(await client.call("hermes_staleness_evaluate", {
      report: {
        schema: "hermesproof.staleness.v1",
        contractVersion: "hermesproof.staleness.2026-07-10",
        current: { commit: sha, vsixSha256: sha, contractVersion: "kilocode.e2e-proof-contract.2026-07-10" },
        requiredKinds: ["ui-proof"],
        records: [{
          id: "gate7-proof",
          kind: "ui-proof",
          status: "passed",
          current: true,
          recordedAtUtc: new Date().toISOString(),
          sha256: sha,
          commit: sha,
          vsixSha256: sha,
          contractVersion: "kilocode.e2e-proof-contract.2026-07-10",
          runId: "run-gate7-proof",
          evidenceId: "ev_abcdef1234567890",
          summary: "Redacted installed VSIX proof.",
        }],
      },
    }));
    assert.equal(stale.ok, true);
    assert.equal(stale.verdict, "pass");
    const helper = result(await client.call("hermes_helper_runtime_evaluate", {
      envelope: {
        schema: "hermesproof.helper-runtime.v1",
        contractVersion: "hermesproof.helper-runtime.2026-07-10",
        runId: "run-helper-proof",
        taskId: "task-helper-health",
        worker: { id: "hermes-agent-local-01", runtime: "hermes-agent", location: "local" },
        workspace: { commit: sha, vsixSha256: sha },
        scope: ["health"],
        startedAtUtc: "2026-07-10T21:00:00.000Z",
        finishedAtUtc: "2026-07-10T21:00:01.000Z",
        status: "completed",
        runner: { statusOk: true, timedOut: false, exitCode: 0 },
        artifacts: [{ id: "health-proof", sha256: sha }],
        hermesProof: { evidenceId: "ev_abcdef1234567890" },
        secretValuesReturned: false,
        summary: "Redacted helper health proof.",
      },
    }));
    assert.equal(helper.ok, true);
  } finally {
    client.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
