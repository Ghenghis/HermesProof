import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { A2AStub } from "./a2a-stub.mjs";

let tmpDir;
let a2a;

describe("A2AStub", () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-a2a-test-"));
    a2a = new A2AStub({ workspaceRoot: tmpDir });
    await a2a.init();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a task in submitted state", async () => {
    const r = await a2a.createTask({ agent_id: "claude-01", task_type: "gate_run", input: { gate: "mcp-scan" } });
    assert.equal(r.ok, true);
    assert.equal(r.status, "submitted");
    assert.ok(r.task_id.startsWith("a2a_"));
  });

  it("transitions submitted→working", async () => {
    const { task_id } = await a2a.createTask({ agent_id: "codex-01", task_type: "review" });
    const r = await a2a.updateTask(task_id, "working");
    assert.equal(r.ok, true);
    assert.equal(r.status, "working");
  });

  it("transitions working→completed with output", async () => {
    const { task_id } = await a2a.createTask({ agent_id: "codex-01", task_type: "gate_run" });
    await a2a.updateTask(task_id, "working");
    const r = await a2a.updateTask(task_id, "completed", { output: { result: "pass" } });
    assert.equal(r.status, "completed");
    const task = await a2a.getTask(task_id);
    assert.deepEqual(task.output, { result: "pass" });
  });

  it("transitions working→failed with error", async () => {
    const { task_id } = await a2a.createTask({ agent_id: "codex-01", task_type: "build" });
    await a2a.updateTask(task_id, "working");
    await a2a.updateTask(task_id, "failed", { error: "timeout after 60s" });
    const task = await a2a.getTask(task_id);
    assert.equal(task.status, "failed");
    assert.equal(task.error, "timeout after 60s");
  });

  it("rejects invalid transition from terminal state", async () => {
    const { task_id } = await a2a.createTask({ agent_id: "agent", task_type: "test" });
    await a2a.updateTask(task_id, "working");
    await a2a.updateTask(task_id, "completed");
    await assert.rejects(
      () => a2a.updateTask(task_id, "working"),
      /invalid transition/
    );
  });

  it("rejects direct submitted→completed (must go through working)", async () => {
    const { task_id } = await a2a.createTask({ agent_id: "agent", task_type: "test" });
    await assert.rejects(
      () => a2a.updateTask(task_id, "completed"),
      /invalid transition/
    );
  });

  it("lists tasks with status filter", async () => {
    const { task_id } = await a2a.createTask({ agent_id: "list-agent", task_type: "infra" });
    const tasks = await a2a.listTasks({ status: "submitted" });
    assert.ok(tasks.some((t) => t.id === task_id));
  });

  it("lists tasks with agent_id filter", async () => {
    await a2a.createTask({ agent_id: "unique-agent-xyz", task_type: "docs" });
    const tasks = await a2a.listTasks({ agent_id: "unique-agent-xyz" });
    assert.ok(tasks.length >= 1);
    assert.ok(tasks.every((t) => t.agent_id === "unique-agent-xyz"));
  });

  it("getTask returns null for unknown id", async () => {
    const t = await a2a.getTask("a2a_nonexistent_0000");
    assert.equal(t, null);
  });

  it("pruneCompleted removes old terminal tasks", async () => {
    const state = a2a.stateFile;
    // Manually create an old completed task
    const raw = JSON.parse(await fs.readFile(state, "utf8"));
    const old_ts = Date.now() - 25 * 60 * 60 * 1000;
    raw.tasks["a2a_old_test"] = { id: "a2a_old_test", agent_id: "x", task_type: "x", status: "completed", created_ts: old_ts, updated_ts: old_ts, input: null, output: null, error: null };
    await fs.writeFile(state, JSON.stringify(raw), "utf8");
    const r = await a2a.pruneCompleted();
    assert.ok(r.pruned >= 1);
    const gone = await a2a.getTask("a2a_old_test");
    assert.equal(gone, null);
  });
});
