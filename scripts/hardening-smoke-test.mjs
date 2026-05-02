import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HermesLockManager } from "../src/core/lock-manager.mjs";
import { GateRunner } from "../src/core/gate-runner.mjs";

async function makeTempWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes3d-mcp-hardening-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/index.ts"), "// index\n");
  return root;
}

test("path escape attempts are rejected with workspace-relative error", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();

  // Absolute path outside workspace.
  await assert.rejects(
    m.lockFiles({ owner: "test-owner", files: ["/etc/passwd"], reason: "evil" }),
    /escapes workspace/
  );

  // Relative traversal.
  await assert.rejects(
    m.lockFiles({ owner: "test-owner", files: ["../../../etc/passwd"], reason: "evil" }),
    /escapes workspace/
  );

  // Workspace root itself.
  await assert.rejects(
    m.lockFiles({ owner: "test-owner", files: ["."], reason: "evil" }),
    /workspace root itself cannot be locked/
  );
});

test("owner can refresh its own existing lock without conflict", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();

  const first = await m.lockFiles({
    owner: "windsurf-cascade",
    files: ["src/index.ts"],
    reason: "first acquire"
  });
  assert.equal(first.ok, true);

  const second = await m.lockFiles({
    owner: "windsurf-cascade",
    files: ["src/index.ts"],
    reason: "refresh same lock"
  });
  assert.equal(second.ok, true);
  assert.equal(second.locks[0].refreshed, true);
});

test("releaseFiles by wrong owner is blocked, not silently allowed", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();

  await m.lockFiles({ owner: "codex-impl-01", files: ["src/index.ts"], reason: "lock" });
  const release = await m.releaseFiles({
    owner: "claude-lead",
    files: ["src/index.ts"],
    note: "wrong owner"
  });
  assert.equal(release.ok, false);
  assert.equal(release.status, "partial");
  assert.equal(release.blocked[0].current_owner, "codex-impl-01");
});

test("heartbeat extends expiry of held locks", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();

  const acquired = await m.lockFiles({
    owner: "codex-impl-01",
    files: ["src/index.ts"],
    reason: "long task",
    ttlMinutes: 5
  });
  assert.equal(acquired.ok, true);

  const before = (await m.listLocks()).locks[0];
  await new Promise((r) => setTimeout(r, 5));
  const beat = await m.heartbeat({ owner: "codex-impl-01" });
  assert.equal(beat.ok, true);
  assert.ok(beat.touched.includes("src/index.ts"));
  const after = (await m.listLocks()).locks[0];
  assert.ok(
    new Date(after.heartbeat_utc).getTime() >= new Date(before.heartbeat_utc).getTime(),
    "heartbeat should not move backwards"
  );
});

test("stale lock recovery archives metadata and clears the lock", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();

  await m.lockFiles({
    owner: "codex-impl-01",
    files: ["src/index.ts"],
    reason: "soon-to-be-stale",
    ttlMinutes: 5
  });

  // Force expiry by rewriting metadata to the past.
  const locks = await m.listLocks();
  const lock = locks.locks.find((l) => l.file === "src/index.ts");
  const metadataFile = path.join(
    workspaceRoot,
    ".hermes3d_orchestrator",
    "locks",
    `${lock.lock_id}.lockdir`,
    "metadata.json"
  );
  const raw = JSON.parse(await fs.readFile(metadataFile, "utf8"));
  raw.expires_utc = new Date(Date.now() - 60_000).toISOString();
  await fs.writeFile(metadataFile, JSON.stringify(raw, null, 2), "utf8");

  const recovered = await m.recoverStaleLocks({
    owner: "windsurf-cascade",
    note: "TTL exceeded; reclaiming"
  });
  assert.equal(recovered.ok, true);
  assert.deepEqual(recovered.recovered, ["src/index.ts"]);

  const after = await m.listLocks();
  assert.equal(after.count, 0);
});

test("gate runner rejects unknown gateId without spawning anything", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const gates = new GateRunner({ workspaceRoot });
  const result = await gates.runGate({ owner: "test-owner", gateId: "rm-rf-slash" });
  assert.equal(result.ok, false);
  assert.equal(result.status, "rejected");
  assert.ok(Array.isArray(result.allowed_gates));
  assert.ok(result.allowed_gates.includes("git-status"));
});

test("gate runner rejects cwd that escapes the workspace", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const gates = new GateRunner({ workspaceRoot });
  await assert.rejects(
    gates.runGate({ owner: "test-owner", gateId: "git-status", cwd: "../.." }),
    /escapes workspace/
  );
});

test("doctor() reports errors when workspace_root does not exist", async () => {
  const fakeRoot = path.join(os.tmpdir(), `does-not-exist-${Date.now()}`);
  const m = new HermesLockManager({ workspaceRoot: fakeRoot });
  // init() will create dirs even for non-existent parent because mkdir recursive,
  // so test doctor on a path we expect to be valid but never had .git etc.
  // For "missing" semantics, point at a file instead.
  const file = path.join(os.tmpdir(), `not-a-dir-${Date.now()}`);
  await fs.writeFile(file, "x");
  const m2 = new HermesLockManager({ workspaceRoot: file });
  const report = await m2.doctor();
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.check === "workspace_is_dir" && f.level === "error"));
  await fs.rm(file, { force: true });
});

test("getPolicy exposes env-var resolution and stable policy fields", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();
  const policy = m.getPolicy();
  assert.equal(policy.ok, true);
  assert.equal(policy.workspace_root, workspaceRoot);
  assert.equal(policy.policy.atomic_lock_acquisition, true);
  assert.equal(policy.policy.path_escape_protection, true);
  assert.ok("MCP_LOCK_WORKSPACE" in policy.env_vars_used);
  assert.ok("HERMES3D_WORKSPACE" in policy.env_vars_used);
});

test("custom state dir name is honored end-to-end", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot, stateDirName: ".my_locks" });
  await m.init();
  const stat = await fs.stat(path.join(workspaceRoot, ".my_locks"));
  assert.equal(stat.isDirectory(), true);
  // Default dir should NOT have been created.
  await assert.rejects(fs.stat(path.join(workspaceRoot, ".hermes3d_orchestrator")));
});

test("MCP_LOCK_STATE_DIR with a slash is rejected", async () => {
  const workspaceRoot = await makeTempWorkspace();
  assert.throws(
    () => new HermesLockManager({ workspaceRoot, stateDirName: "../escape" }),
    /MCP_LOCK_STATE_DIR must be a single directory name/
  );
});
