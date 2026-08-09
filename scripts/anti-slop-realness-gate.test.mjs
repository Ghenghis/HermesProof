import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SERVER = path.join(REPO_ROOT, "src", "server.mjs");

async function makeTempWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-realness-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "feature.ts"), "export const feature = true;\n", "utf8");
  return root;
}

async function startServer(workspaceRoot) {
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MCP_LOCK_WORKSPACE: workspaceRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buf = "";
  const queue = [];
  const stderrChunks = [];
  let nextId = 0;

  proc.stderr.on("data", (chunk) => stderrChunks.push(chunk.toString()));
  proc.on("error", (err) => {
    while (queue.length) queue.shift().reject(err);
  });
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const next = queue.shift();
      if (next) next.resolve(msg);
    }
  });

  function request(method, params) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  function notify(method, params) {
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "anti-slop-realness-gate", version: "0.0.1" },
  });
  notify("notifications/initialized", {});

  return {
    async call(name, args) {
      return request("tools/call", { name, arguments: args });
    },
    stop() {
      try { proc.stdin.end(); } catch {}
      try { proc.kill("SIGTERM"); } catch {}
    },
    stderr() {
      return stderrChunks.join("");
    },
  };
}

function parseToolResult(resp) {
  if (resp.error) return { ok: false, _protocol_error: resp.error };
  if (resp?.result?.isError === true) return { ok: false, _tool_error: resp.result.content?.[0]?.text || "" };
  const text = resp?.result?.content?.find((entry) => entry.type === "text")?.text;
  assert.ok(text, `missing text result: ${JSON.stringify(resp)}`);
  return JSON.parse(text);
}

test("anti-slop review rejects pass-shaped fake, stubbed, UI-only, and failed gates", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const server = await startServer(workspaceRoot);
  t.after(() => server.stop());

  const result = parseToolResult(await server.call("hermes_anti_slop_review", {
    owner: "codex-realness",
    summary: "Feature complete and release-ready.",
    files: ["src/feature.ts"],
    gates: [
      { gate: "npm test", status: "pass", exitCode: 1 },
      { gate: "ui smoke", status: "pass", uiOnly: true },
      { gate: "backend smoke", status: "pass", stubbed: true },
      { gate: "hermes_evidence_chain", status: "pass" },
    ],
    evidence: [],
    createTicket: false,
    scanFileContent: false,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.status, "needs_review");
  const codes = result.review.findings.map((finding) => finding.code);
  assert.ok(codes.includes("gate.nonzero_exit_claimed_pass"), codes.join(", "));
  assert.ok(codes.includes("gate.fake_or_stub_claimed_pass"), codes.join(", "));
  assert.ok(codes.includes("gate.hermes_evidence_id_missing"), codes.join(", "));
  assert.ok(codes.includes("claim.unproven_completion"), codes.join(", "));
});

test("anti-slop review accepts real pass gates with Hermes evidence ids", async (t) => {
  const workspaceRoot = await makeTempWorkspace();
  const server = await startServer(workspaceRoot);
  t.after(() => server.stop());

  const result = parseToolResult(await server.call("hermes_anti_slop_review", {
    owner: "codex-realness",
    summary: "Feature verified with real smoke output.",
    files: [],
    gates: [
      { gate: "npm test", status: "pass", exitCode: 0, evidence: "2 pass, 0 fail" },
      { gate: "hermes_evidence_chain", status: "pass", evidence_id: "ev_abcdef123456" },
    ],
    evidence: [{ evidence_id: "ev_abcdef123456", kind: "truth-gate", status: "pass" }],
    createTicket: false,
    scanFileContent: false,
  }));

  assert.equal(result.ok, true, JSON.stringify(result.review.findings));
  assert.equal(result.status, "pass");
  assert.deepEqual(result.review.findings, []);
});
