/**
 * ReputationTracker — rolling per-agent reputation score.
 *
 * Scoring:
 *   +1.0  merge          — PR merged, gate passed, task accepted
 *   +0.5  lgtm           — LGTM review, soft approval
 *   -0.25 timeout        — agent failed to complete within TTL
 *   -1.0  reject         — PR rejected, gate fail attributed to agent, task reverted
 *
 * Score is windowed to the last WINDOW_SIZE events so stale history doesn't
 * permanently penalize an agent. Min score is 0.0 (never negative).
 *
 * State lives at: .hermes3d_orchestrator/reputation.json
 * Schema:
 *   { schema_version: 1, actors: { [actor_id]: ActorReputation } }
 *
 * ActorReputation:
 *   { score: number, events: Event[], total_outcomes: number }
 *
 * Event:
 *   { ts: number, outcome: string, delta: number, context?: string }
 */

import { writeJsonAtomic, ensureDir, readJson } from "./fs-utils.mjs";
import { makeMutex } from "./mutex.mjs";
import path from "node:path";

const WINDOW_SIZE = 30; // rolling window of last 30 events

const OUTCOME_DELTAS = Object.freeze({
  merge:   +1.0,
  lgtm:    +0.5,
  timeout: -0.25,
  reject:  -1.0,
});

export class ReputationTracker {
  constructor({ workspaceRoot, stateDirName = ".hermes3d_orchestrator" } = {}) {
    if (!workspaceRoot) throw new Error("ReputationTracker requires workspaceRoot");
    this.stateDir = path.join(workspaceRoot, stateDirName);
    this.stateFile = path.join(this.stateDir, "reputation.json");
    // Serialize concurrent recordOutcome calls — pre-fix, parallel CI
    // recordings could race on read-modify-write and drop events.
    // Cross-confirmed by 2026-05-03 audit (5/5 lanes flagged).
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
   * Record an outcome for actor_id and recompute their rolling score.
   *
   * @param {string} actor_id
   * @param {"merge"|"lgtm"|"timeout"|"reject"} outcome
   * @param {string} [context] — optional free-text annotation (PR number, gate name, etc.)
   * @returns {{ ok: boolean, actor_id: string, outcome: string, delta: number, new_score: number }}
   */
  async recordOutcome(actor_id, outcome, context) {
    if (!actor_id) {
      throw new Error("actor_id is required");
    }
    if (!(outcome in OUTCOME_DELTAS)) {
      throw new Error(`unknown outcome: ${outcome}. Valid: ${Object.keys(OUTCOME_DELTAS).join(", ")}`);
    }
    return this._mutex(async () => {
      const state = await this._read();
      if (!state.actors[actor_id]) {
        state.actors[actor_id] = { score: 1.0, events: [], total_outcomes: 0 };
      }
      const rec = state.actors[actor_id];
      const delta = OUTCOME_DELTAS[outcome];
      const event = { ts: Date.now(), outcome, delta, context: context ?? null };
      rec.events.push(event);
      if (rec.events.length > WINDOW_SIZE) rec.events = rec.events.slice(-WINDOW_SIZE);
      rec.total_outcomes = (rec.total_outcomes ?? 0) + 1;
      // Recompute from rolling window (start at 1.0 as baseline)
      rec.score = Math.max(
        0,
        1.0 + rec.events.reduce((sum, e) => sum + e.delta, 0)
      );
      await this._write(state);
      return { ok: true, actor_id, outcome, delta, new_score: rec.score };
    });
  }

  /**
   * Get reputation for a specific actor. Returns null if unknown.
   */
  async getScore(actor_id) {
    const state = await this._read();
    const rec = state.actors[actor_id];
    if (!rec) return null;
    return { actor_id, score: rec.score, total_outcomes: rec.total_outcomes, recent_events: rec.events.slice(-5) };
  }

  /**
   * List all actors sorted by score descending (highest reputation first).
   */
  async leaderboard() {
    const state = await this._read();
    return Object.entries(state.actors)
      .map(([actor_id, rec]) => ({ actor_id, score: rec.score, total_outcomes: rec.total_outcomes }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Get actors ordered best-to-worst for task assignment.
   * Filters out actors below min_score threshold (default 0.25).
   */
  async rankedActors({ min_score = 0.25 } = {}) {
    const board = await this.leaderboard();
    return board.filter((a) => a.score >= min_score);
  }
}

export { OUTCOME_DELTAS, WINDOW_SIZE };
