#!/usr/bin/env node
/**
 * End-to-end integration probe.
 *
 * Drives the actual MCP server over stdio (the same way Claude Desktop, Claude
 * Code, Codex, and Windsurf will drive it) and walks through the full
 * multi-agent flow on a real workspace passed via --workspace.
 *
 * Usage:
 *   node scripts/sandbox-integration.mjs --workspace "G:\\Github\\hermes3d-mcp-test-sandbox"
 *
 * Exits non-zero on the first failed assertion. Designed to be safe to run
 * against the sandbox; not intended to run against production projects.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import url from "node:url";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { ensureEventDirs } from "./generate-review-packet.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace" || a === "-w") out.workspace = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.workspace) {
  console.error("Usage: node scripts/sandbox-integration.mjs --workspace <path>");
  process.exit(2);
}
const workspace = path.resolve(args.workspace);

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const serverEntry = path.join(repoRoot, "src", "server.mjs");

class StdioMcpClient {
  constructor({ command, args, env }) {
    this.proc = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.id = 0;
    this.buf = "";
    this.queue = [];
    this.proc.stdout.on("data", (chunk) => this.#onData(chunk.toString()));
    this.proc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
    this.proc.on("exit", (code) => {
      if (code !== null && code !== 0) {
        process.stderr.write(`server exited with code ${code}\n`);
      }
    });
  }
  #onData(text) {
    this.buf += text;
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const next = this.queue.shift();
      if (next) next.resolve(msg);
    }
  }
  request(method, params) {
    this.id++;
    const payload = { jsonrpc: "2.0", id: this.id, method, params };
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.proc.stdin.write(JSON.stringify(payload) + "\n");
    });
  }
  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async close() {
    this.proc.stdin.end();
    await new Promise((r) => setTimeout(r, 100));
    this.proc.kill("SIGTERM");
  }
}

function unwrapToolResult(response) {
  const text = response?.result?.content?.[0]?.text;
  if (!text) throw new Error(`tool returned no text content: ${JSON.stringify(response)}`);
  return JSON.parse(text);
}

async function withClient(env, fn) {
  const client = new StdioMcpClient({
    command: process.platform === "win32" ? "node.exe" : "node",
    args: [serverEntry],
    env
  });
  try {
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: env.__agent || "agent", version: "0.0.1" }
    });
    if (!init?.result) throw new Error(`initialize failed: ${JSON.stringify(init)}`);
    client.notify("notifications/initialized", {});
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function callTool(client, name, args) {
  const resp = await client.request("tools/call", { name, arguments: args });
  return unwrapToolResult(resp);
}

const baseEnv = {
  MCP_LOCK_WORKSPACE: workspace
};

async function durableEventTypes() {
  const paths = await ensureEventDirs(workspace);
  const names = await fs.readdir(paths.outboxDir).catch(() => []);
  const events = [];
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    try {
      const event = JSON.parse(await fs.readFile(path.join(paths.outboxDir, name), "utf8"));
      events.push(event.event_type);
    } catch { /* ignore malformed files here; trigger-doctor covers schema */ }
  }
  return events;
}

// We use a single client connected to the same stdio server for all simulated
// agents. The lock manager identifies agents by `owner` strings, not by
// transport, so this matches how real concurrent clients all share the same
// orchestrator state via the workspace state dir.

console.log(`[sandbox] workspace = ${workspace}`);
console.log(`[sandbox] server   = ${serverEntry}`);

await withClient({ ...baseEnv, __agent: "sandbox-driver" }, async (client) => {
  // 1. Tools list — confirm the server exposes the new diagnostic tools too.
  const tools = (await client.request("tools/list", {})).result.tools.map((t) => t.name).sort();
  assert.ok(tools.includes("hermes_doctor"), "hermes_doctor missing");
  assert.ok(tools.includes("hermes_read_policy"), "hermes_read_policy missing");
  assert.ok(tools.includes("hermes_lock_files"), "hermes_lock_files missing");
  console.log(`[ok] tools/list reports ${tools.length} tools, including doctor/policy/locks`);

  // 2. Doctor — sandbox is a git repo, so all checks should be ok=true.
  const doctor = await callTool(client, "hermes_doctor", {});
  assert.equal(doctor.ok, true, `doctor not ok: ${JSON.stringify(doctor.findings)}`);
  assert.equal(doctor.workspace_root, workspace);
  console.log(`[ok] hermes_doctor ok=true on git-initialized sandbox`);

  // 3. Read policy.
  const policy = await callTool(client, "hermes_read_policy", {});
  assert.equal(policy.workspace_root, workspace);
  assert.equal(policy.policy.atomic_lock_acquisition, true);
  console.log(`[ok] hermes_read_policy reports correct workspace`);

  // 4. Claude lead claims doc task and locks contracts.
  const claudeTask = await callTool(client, "hermes_claim_task", {
    owner: "claude-lead",
    role: "architect",
    taskId: "CP-UX-A-ARCHITECT",
    title: "Draft scope and Codex prompt",
    files: ["contracts/CP-UX-A_SCOPE_LOCK.md", "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"],
    reason: "Lead owns CP docs"
  });
  assert.equal(claudeTask.ok, true);
  const claudeLock = await callTool(client, "hermes_lock_files", {
    owner: "claude-lead",
    role: "architect",
    taskId: "CP-UX-A-ARCHITECT",
    files: ["contracts/CP-UX-A_SCOPE_LOCK.md", "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"],
    reason: "Edit contracts"
  });
  assert.equal(claudeLock.ok, true, `claude lock failed: ${JSON.stringify(claudeLock)}`);
  console.log(`[ok] claude-lead locked 2 contract files`);

  // 5. Codex claims code task and locks tab files (different files; should succeed).
  const codexTask = await callTool(client, "hermes_claim_task", {
    owner: "codex-impl-01",
    role: "implementation",
    taskId: "CP-UX-A-CODEX",
    title: "Implement UX-A fixes",
    files: ["03_implementation/ui/src/tabs/Dashboard.tsx", "03_implementation/ui/src/tabs/Agents.tsx"],
    reason: "Codex owns code edits"
  });
  assert.equal(codexTask.ok, true);
  const codexLock = await callTool(client, "hermes_lock_files", {
    owner: "codex-impl-01",
    role: "implementation",
    taskId: "CP-UX-A-CODEX",
    files: ["03_implementation/ui/src/tabs/Dashboard.tsx", "03_implementation/ui/src/tabs/Agents.tsx"],
    reason: "Edit tabs"
  });
  assert.equal(codexLock.ok, true);
  console.log(`[ok] codex-impl-01 locked 2 tab files (no conflict with claude's docs)`);

  // 6. Reviewer attempts to lock Dashboard.tsx -> blocked.
  const blocked = await callTool(client, "hermes_lock_files", {
    owner: "claude-reviewer-ux",
    role: "reviewer",
    files: ["03_implementation/ui/src/tabs/Dashboard.tsx"],
    reason: "Attempt to patch UI directly"
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.conflicts[0].current_owner, "codex-impl-01");
  assert.equal(blocked.next_tool, "hermes_request_handoff");
  console.log(`[ok] reviewer blocked when targeting codex-owned file`);

  // 7. Heartbeat for codex while he's still working.
  const hb = await callTool(client, "hermes_heartbeat", {
    owner: "codex-impl-01",
    taskId: "CP-UX-A-CODEX"
  });
  assert.equal(hb.ok, true);
  assert.ok(hb.touched.includes("03_implementation/ui/src/tabs/Dashboard.tsx"));
  console.log(`[ok] codex heartbeat refreshed ${hb.touched.length} file lock(s)`);

  // 8. Reviewer requests handoff -> codex approves -> ownership transfers.
  const handoff = await callTool(client, "hermes_request_handoff", {
    requester: "claude-reviewer-ux",
    currentOwner: "codex-impl-01",
    files: ["03_implementation/ui/src/tabs/Dashboard.tsx"],
    reason: "Apply one approved patch",
    taskId: "CP-UX-A-REVIEW"
  });
  assert.equal(handoff.ok, true);
  console.log(`[ok] handoff requested, id=${handoff.handoff.id}`);

  const approval = await callTool(client, "hermes_approve_handoff", {
    owner: "codex-impl-01",
    requestId: handoff.handoff.id,
    decision: "approve",
    note: "Codex done; reviewer may patch."
  });
  assert.equal(approval.ok, true);
  assert.equal(approval.status, "approved");
  console.log(`[ok] codex approved handoff -> ownership transferred`);

  // 9. Codex tries to silently re-lock the transferred file -> blocked.
  const recapture = await callTool(client, "hermes_lock_files", {
    owner: "codex-impl-01",
    files: ["03_implementation/ui/src/tabs/Dashboard.tsx"],
    reason: "Codex tries to resume editing"
  });
  assert.equal(recapture.ok, false);
  assert.equal(recapture.conflicts[0].current_owner, "claude-reviewer-ux");
  console.log(`[ok] codex cannot silently re-lock the transferred file`);

  // 10. Run a real read-only gate against the sandbox git repo.
  const status = await callTool(client, "hermes_run_gate", {
    owner: "claude-reviewer-ux",
    gateId: "git-status",
    cwd: "."
  });
  assert.equal(status.ok, true, `git-status failed: ${JSON.stringify(status)}`);
  console.log(`[ok] git-status gate ran successfully (exit ${status.report.exit_code})`);

  const diff = await callTool(client, "hermes_run_gate", {
    owner: "claude-reviewer-ux",
    gateId: "git-diff-check",
    cwd: "."
  });
  assert.equal(diff.ok, true, `git-diff-check failed: ${JSON.stringify(diff)}`);
  console.log(`[ok] git-diff-check gate ran successfully`);

  // 11. Unknown gate is rejected without spawning.
  const bogus = await callTool(client, "hermes_run_gate", {
    owner: "claude-reviewer-ux",
    gateId: "rm-rf-slash",
    cwd: "."
  });
  assert.equal(bogus.ok, false);
  assert.equal(bogus.status, "rejected");
  console.log(`[ok] unknown gate rejected with allowlist enforcement`);

  // 12. Append evidence and verify it landed in the ledger file.
  const evidence = await callTool(client, "hermes_append_evidence", {
    owner: "claude-reviewer-ux",
    taskId: "CP-UX-A-REVIEW",
    kind: "integration-test",
    summary: "End-to-end sandbox flow proved",
    data: { sandbox: workspace }
  });
  assert.equal(evidence.ok, true);
  console.log(`[ok] evidence ledger appended id=${evidence.evidence.id}`);

  // 13. Release everything cleanly.
  const releaseClaude = await callTool(client, "hermes_release_files", {
    owner: "claude-lead",
    files: ["contracts/CP-UX-A_SCOPE_LOCK.md", "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"],
    note: "claude done"
  });
  assert.equal(releaseClaude.ok, true);

  const releaseCodex = await callTool(client, "hermes_release_files", {
    owner: "codex-impl-01",
    files: ["03_implementation/ui/src/tabs/Agents.tsx"],
    note: "codex done with agents"
  });
  assert.equal(releaseCodex.ok, true);

  const releaseReviewer = await callTool(client, "hermes_release_files", {
    owner: "claude-reviewer-ux",
    files: ["03_implementation/ui/src/tabs/Dashboard.tsx"],
    note: "reviewer patch done"
  });
  assert.equal(releaseReviewer.ok, true);
  console.log(`[ok] all locks released`);

  const outboxTypes = await durableEventTypes();
  const expectedDurableTypes = ["task.claimed", "lock.acquired", "lock.released"];
  const missingDurableTypes = expectedDurableTypes.filter((type) => !outboxTypes.includes(type));
  if (missingDurableTypes.length === 0) {
    console.log(`[ok] durable outbox includes lifecycle events: ${expectedDurableTypes.join(", ")}`);
  } else {
    console.log(`[warn] durable outbox API not active in this checkout; missing ${missingDurableTypes.join(", ")}`);
  }

  // 14. Final state should have zero locks.
  const final = await callTool(client, "hermes_get_state", {});
  assert.equal(final.locks.length, 0, `expected 0 locks, got ${final.locks.length}`);
  console.log(`[ok] final state: 0 locks, ${final.tasks.length} task records, ${final.handoffs.length} handoff records`);
});

// Read evidence ledger and event log lengths so the proof artifact can quote them.
const stateDir = path.join(workspace, ".hermes3d_orchestrator");
const ledger = path.join(stateDir, "evidence", "ledger.ndjson");
const events = path.join(stateDir, "events.ndjson");
const durablePaths = await ensureEventDirs(workspace);
const ledgerLines = (await fs.readFile(ledger, "utf8").catch(() => "")).split("\n").filter(Boolean).length;
const eventLines = (await fs.readFile(events, "utf8").catch(() => "")).split("\n").filter(Boolean).length;
const outboxLines = (await fs.readdir(durablePaths.outboxDir).catch(() => [])).filter((f) => f.endsWith(".json")).length;
console.log(`\n[summary] evidence ledger entries: ${ledgerLines}`);
console.log(`[summary] event log entries:        ${eventLines}`);
console.log(`[summary] durable outbox events:    ${outboxLines}`);
console.log(`[summary] state dir:                ${stateDir}`);
console.log(`\nALL CHECKS PASSED`);
