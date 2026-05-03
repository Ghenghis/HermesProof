/**
 * A2AStub — Agent-to-Agent protocol task lifecycle stub.
 *
 * Implements the A2A task state machine as MCP-accessible state rather than
 * HTTP endpoints (since HermesProof is stdio JSON-RPC, not an HTTP server).
 * Downstream consumers bridge to HTTP if needed via the A2A gateway pattern.
 *
 * A2A task lifecycle (simplified from Google A2A spec):
 *   submitted → working → (input_required |) completed | failed | canceled
 *
 * State lives at: .hermes3d_orchestrator/a2a_tasks.json
 * Schema:
 *   { schema_version: 1, tasks: { [task_id]: A2ATask } }
 *
 * A2ATask:
 *   { id, status: TaskStatus, created_ts, updated_ts, input, output?, error? }
 *
 * TaskStatus: "submitted" | "working" | "input_required" | "completed" | "failed" | "canceled"
 *
 * This is a STUB — it persists task state and enforces valid transitions but
 * does not orchestrate execution. Execution is the agent's responsibility.
 */

import { writeJsonAtomic, ensureDir, readJson } from "./fs-utils.mjs";
import path from "node:path";
import crypto from "node:crypto";

const VALID_STATUSES = ["submitted", "working", "input_required", "completed", "failed", "canceled"];
const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);

const VALID_TRANSITIONS = {
  submitted:       ["working", "canceled"],
  working:         ["input_required", "completed", "failed", "canceled"],
  input_required:  ["working", "canceled"],
  completed:       [],
  failed:          [],
  canceled:        [],
};

const TASK_TTL_MS = 24 * 60 * 60 * 1000; // 24h — auto-archive stale tasks

export class A2AStub {
  constructor({ workspaceRoot, stateDirName = ".hermes3d_orchestrator" } = {}) {
    if (!workspaceRoot) throw new Error("A2AStub requires workspaceRoot");
    this.stateDir = path.join(workspaceRoot, stateDirName);
    this.stateFile = path.join(this.stateDir, "a2a_tasks.json");
  }

  async init() {
    await ensureDir(this.stateDir);
    const existing = await readJson(this.stateFile, null);
    if (!existing) {
      await writeJsonAtomic(this.stateFile, { schema_version: 1, tasks: {} });
    }
  }

  async _read() {
    return (await readJson(this.stateFile, null)) ?? { schema_version: 1, tasks: {} };
  }

  async _write(state) {
    await writeJsonAtomic(this.stateFile, state);
  }

  /**
   * Create a new A2A task.
   *
   * @param {object} args
   * @param {string} args.agent_id   — submitting agent
   * @param {string} args.task_type  — e.g. "gate_run", "review", "build"
   * @param {object} [args.input]    — task parameters (opaque to the stub)
   * @returns {{ ok: boolean, task_id: string, status: string }}
   */
  async createTask({ agent_id, task_type, input }) {
    if (!agent_id || !task_type) throw new Error("agent_id and task_type are required");
    const state = await this._read();
    const task_id = `a2a_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    state.tasks[task_id] = {
      id: task_id,
      agent_id,
      task_type,
      status: "submitted",
      created_ts: Date.now(),
      updated_ts: Date.now(),
      input: input ?? null,
      output: null,
      error: null,
    };
    await this._write(state);
    return { ok: true, task_id, status: "submitted" };
  }

  /**
   * Get a task by ID.
   */
  async getTask(task_id) {
    const state = await this._read();
    const task = state.tasks[task_id];
    if (!task) return null;
    return { ...task };
  }

  /**
   * Transition a task to a new status.
   *
   * @param {string} task_id
   * @param {"working"|"input_required"|"completed"|"failed"|"canceled"} new_status
   * @param {object} [output]  — set for "completed"
   * @param {string} [error]   — set for "failed"
   */
  async updateTask(task_id, new_status, { output, error } = {}) {
    if (!VALID_STATUSES.includes(new_status)) {
      throw new Error(`invalid status: ${new_status}`);
    }
    const state = await this._read();
    const task = state.tasks[task_id];
    if (!task) throw new Error(`task not found: ${task_id}`);
    const allowed = VALID_TRANSITIONS[task.status];
    if (!allowed.includes(new_status)) {
      throw new Error(`invalid transition ${task.status} → ${new_status}`);
    }
    task.status = new_status;
    task.updated_ts = Date.now();
    if (output !== undefined) task.output = output;
    if (error !== undefined) task.error = error;
    await this._write(state);
    return { ok: true, task_id, status: new_status };
  }

  /**
   * List tasks, optionally filtered.
   * @param {{ agent_id?: string, status?: string, task_type?: string }} filter
   */
  async listTasks(filter = {}) {
    const state = await this._read();
    const now = Date.now();
    return Object.values(state.tasks)
      .filter((t) => {
        if (filter.agent_id && t.agent_id !== filter.agent_id) return false;
        if (filter.status && t.status !== filter.status) return false;
        if (filter.task_type && t.task_type !== filter.task_type) return false;
        // Exclude tasks older than TTL (treat as auto-archived)
        if (now - t.created_ts > TASK_TTL_MS) return false;
        return true;
      })
      .sort((a, b) => b.created_ts - a.created_ts);
  }

  /**
   * Prune tasks that have been in a terminal state for > TTL.
   */
  async pruneCompleted() {
    const state = await this._read();
    const now = Date.now();
    let pruned = 0;
    for (const [id, task] of Object.entries(state.tasks)) {
      if (TERMINAL_STATUSES.has(task.status) && now - task.updated_ts > TASK_TTL_MS) {
        delete state.tasks[id];
        pruned++;
      }
    }
    if (pruned > 0) await this._write(state);
    return { ok: true, pruned };
  }
}

export { VALID_STATUSES, TERMINAL_STATUSES, VALID_TRANSITIONS };
