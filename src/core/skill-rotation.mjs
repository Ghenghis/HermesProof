/**
 * SkillRotation — per-agent task-type histogram.
 *
 * Records what each actor has been doing and provides skill-balance data
 * to capability-dispatch so tasks are spread across agents fairly.
 *
 * State lives at: .hermes3d_orchestrator/skill_rotation.json
 * Schema:
 *   { schema_version: 1, actors: { [actor_id]: ActorRecord } }
 *
 * ActorRecord:
 *   { task_counts: { [task_type]: number }, last_active_ts: number, total_tasks: number }
 */

import { writeJsonAtomic, ensureDir, readJson } from "./fs-utils.mjs";
import { makeMutex } from "./mutex.mjs";
import path from "node:path";

const KNOWN_TASK_TYPES = ["gate", "lock", "review", "handoff", "build", "docs", "test", "infra"];
const TRIM_AFTER = 1000; // prune actors idle > 24h when total actor count exceeds this

export class SkillRotation {
  constructor({ workspaceRoot, stateDirName = ".hermes3d_orchestrator" } = {}) {
    if (!workspaceRoot) throw new Error("SkillRotation requires workspaceRoot");
    this.stateDir = path.join(workspaceRoot, stateDirName);
    this.stateFile = path.join(this.stateDir, "skill_rotation.json");
    // Serialize concurrent recordTask calls — pre-fix, parallel callers
    // could race on read-modify-write and drop count increments. The
    // 2026-05-03 audit cross-confirmed this gap (5/5 lanes).
    this._mutex = makeMutex();
  }

  async init() {
    await ensureDir(this.stateDir);
    const existing = await readJson(this.stateFile, null);
    if (!existing) {
      await writeJsonAtomic(this.stateFile, { schema_version: 1, actors: {} });
    }
  }

  async _read() {
    return (await readJson(this.stateFile, null)) ?? { schema_version: 1, actors: {} };
  }

  async _write(state) {
    await writeJsonAtomic(this.stateFile, state);
  }

  /**
   * Record that actor_id performed a task of the given type.
   * @param {string} actor_id
   * @param {string} task_type — one of KNOWN_TASK_TYPES or any custom string
   */
  async recordTask(actor_id, task_type) {
    if (!actor_id || !task_type) {
      throw new Error("actor_id and task_type are required");
    }
    return this._mutex(async () => {
      const state = await this._read();
      const now = Date.now();
      if (!state.actors[actor_id]) {
        state.actors[actor_id] = { task_counts: {}, last_active_ts: now, total_tasks: 0 };
      }
      const rec = state.actors[actor_id];
      rec.task_counts[task_type] = (rec.task_counts[task_type] ?? 0) + 1;
      rec.last_active_ts = now;
      rec.total_tasks = (rec.total_tasks ?? 0) + 1;

      // Prune stale actors if roster is large
      const actorIds = Object.keys(state.actors);
      if (actorIds.length > TRIM_AFTER) {
        const cutoff = now - 24 * 60 * 60 * 1000;
        for (const id of actorIds) {
          if (state.actors[id].last_active_ts < cutoff) delete state.actors[id];
        }
      }

      await this._write(state);
      return { ok: true, actor_id, task_type, total_tasks: rec.total_tasks };
    });
  }

  /**
   * Get the skill histogram for a specific actor.
   * Returns null if actor has no recorded history.
   */
  async getActor(actor_id) {
    const state = await this._read();
    return state.actors[actor_id] ?? null;
  }

  /**
   * Get all actors and their histograms.
   */
  async listActors() {
    const state = await this._read();
    return state.actors;
  }

  /**
   * Get the count of a specific task type across all actors (used for load-balance routing).
   * Returns a sorted list: [{ actor_id, count }] ascending so the least-loaded actor is first.
   */
  async leastLoadedForType(task_type) {
    const state = await this._read();
    return Object.entries(state.actors)
      .map(([actor_id, rec]) => ({ actor_id, count: rec.task_counts[task_type] ?? 0 }))
      .sort((a, b) => a.count - b.count);
  }

  /**
   * Recommended next task type for actor_id — returns the type least represented
   * in their histogram among the known task types.
   */
  async recommendNextType(actor_id) {
    const state = await this._read();
    const rec = state.actors[actor_id];
    if (!rec) return KNOWN_TASK_TYPES[0];
    let minType = KNOWN_TASK_TYPES[0];
    let minCount = Infinity;
    for (const t of KNOWN_TASK_TYPES) {
      const c = rec.task_counts[t] ?? 0;
      if (c < minCount) { minCount = c; minType = t; }
    }
    return minType;
  }
}

export { KNOWN_TASK_TYPES };
