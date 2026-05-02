import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HermesLockManager } from "../src/core/lock-manager.mjs";

async function makeTempWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes3d-mcp-lock-test-"));
  await fs.mkdir(path.join(root, "src/tabs"), { recursive: true });
  await fs.mkdir(path.join(root, "contracts"), { recursive: true });
  await fs.writeFile(path.join(root, "src/tabs/Dashboard.tsx"), "// dashboard\n");
  await fs.writeFile(path.join(root, "src/tabs/Agents.tsx"), "// agents\n");
  await fs.writeFile(path.join(root, "contracts/CP-UX-A_SCOPE_LOCK.md"), "# Scope\n");
  await fs.writeFile(path.join(root, "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"), "# Codex\n");
  return root;
}

test("Claude and Codex cannot edit the same file without handoff approval", async () => {
  const workspaceRoot = await makeTempWorkspace();
  const m = new HermesLockManager({ workspaceRoot });
  await m.init();

  const claudeTask = await m.claimTask({
    owner: "claude-lead",
    role: "architect",
    taskId: "CP-UX-A-ARCHITECT",
    title: "Create scope lock and implementation prompts",
    files: ["contracts/CP-UX-A_SCOPE_LOCK.md", "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"],
    reason: "Claude owns the docs and Codex prompt."
  });
  assert.equal(claudeTask.ok, true);

  const claudeDocsLock = await m.lockFiles({
    owner: "claude-lead",
    role: "architect",
    taskId: "CP-UX-A-ARCHITECT",
    files: ["contracts/CP-UX-A_SCOPE_LOCK.md", "contracts/CP-UX-A_CODEX_IMPLEMENTATION.md"],
    reason: "Draft locked CP docs."
  });
  assert.equal(claudeDocsLock.ok, true);

  const codexTask = await m.claimTask({
    owner: "codex-impl-01",
    role: "implementation",
    taskId: "CP-UX-A-CODEX",
    title: "Implement UX-A UI honesty pass",
    files: ["src/tabs/Dashboard.tsx", "src/tabs/Agents.tsx"],
    reason: "Codex owns scoped code changes."
  });
  assert.equal(codexTask.ok, true);

  const codexCodeLock = await m.lockFiles({
    owner: "codex-impl-01",
    role: "implementation",
    taskId: "CP-UX-A-CODEX",
    files: ["src/tabs/Dashboard.tsx", "src/tabs/Agents.tsx"],
    reason: "Implement UI gap fixes."
  });
  assert.equal(codexCodeLock.ok, true);

  const blocked = await m.lockFiles({
    owner: "claude-reviewer-01",
    role: "reviewer",
    taskId: "CP-UX-A-REVIEW",
    files: ["src/tabs/Dashboard.tsx"],
    reason: "Reviewer wants to patch code directly."
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.conflicts[0].current_owner, "codex-impl-01");
  assert.equal(blocked.next_tool, "hermes_request_handoff");

  const handoff = await m.requestHandoff({
    requester: "claude-reviewer-01",
    currentOwner: "codex-impl-01",
    taskId: "CP-UX-A-REVIEW",
    files: ["src/tabs/Dashboard.tsx"],
    reason: "Reviewer found one exact fix and needs ownership first."
  });
  assert.equal(handoff.ok, true);

  const approval = await m.approveHandoff({
    owner: "codex-impl-01",
    requestId: handoff.handoff.id,
    decision: "approve",
    note: "Codex completed Dashboard edits and transfers ownership for review patch."
  });
  assert.equal(approval.ok, true);
  assert.equal(approval.status, "approved");

  const locks = await m.listLocks();
  const dashboard = locks.locks.find((l) => l.file === "src/tabs/Dashboard.tsx");
  const agents = locks.locks.find((l) => l.file === "src/tabs/Agents.tsx");
  assert.equal(dashboard.owner, "claude-reviewer-01");
  assert.equal(agents.owner, "codex-impl-01");

  const codexRelockDashboard = await m.lockFiles({
    owner: "codex-impl-01",
    role: "implementation",
    taskId: "CP-UX-A-CODEX",
    files: ["src/tabs/Dashboard.tsx"],
    reason: "Codex tries to resume without asking."
  });
  assert.equal(codexRelockDashboard.ok, false);
  assert.equal(codexRelockDashboard.conflicts[0].current_owner, "claude-reviewer-01");

  const evidence = await m.appendEvidence({
    owner: "claude-reviewer-01",
    taskId: "CP-UX-A-REVIEW",
    kind: "handoff-test",
    summary: "Verified lock conflict, handoff approval, and ownership transfer.",
    data: { workspaceRoot }
  });
  assert.equal(evidence.ok, true);
});
