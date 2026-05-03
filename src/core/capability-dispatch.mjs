/**
 * CapabilityDispatch — reputation-aware + skill-balanced task routing.
 *
 * Given a task type and a set of candidate actors (from the anonymous orchestrator's
 * active_roles), picks the best actor to assign the task to by combining:
 *   1. Reputation score (higher is better — from ReputationTracker)
 *   2. Skill balance   (prefer actors who have done this task type less — from SkillRotation)
 *   3. Role availability (only actors holding the relevant role are eligible)
 *
 * Dispatch result is advisory: the orchestrator emits it as a recommendation, not
 * a hard lock. Agents remain free to self-assign; the recommendation is surfaced
 * via hermes_list_agents so agents can voluntarily follow it.
 *
 * Scoring formula:
 *   composite = reputation_score * WEIGHT_REP + recency_bonus * WEIGHT_FRESH
 *               - load_penalty * WEIGHT_LOAD
 *
 * Where:
 *   reputation_score  = from ReputationTracker (1.0 baseline)
 *   recency_bonus     = 1.0 if actor was active in last 10 min, else 0.5
 *   load_penalty      = task_type_count / max_count_for_type (0..1)
 */

import { ReputationTracker } from "./reputation.mjs";
import { SkillRotation } from "./skill-rotation.mjs";

const WEIGHT_REP   = 0.5;
const WEIGHT_FRESH = 0.3;
const WEIGHT_LOAD  = 0.2;
const RECENCY_WINDOW_MS = 10 * 60 * 1000; // 10 min

export class CapabilityDispatch {
  /**
   * @param {object} opts
   * @param {string} opts.workspaceRoot
   * @param {string} [opts.stateDirName]
   */
  constructor({ workspaceRoot, stateDirName = ".hermes3d_orchestrator" } = {}) {
    if (!workspaceRoot) throw new Error("CapabilityDispatch requires workspaceRoot");
    this.reputation = new ReputationTracker({ workspaceRoot, stateDirName });
    this.skills = new SkillRotation({ workspaceRoot, stateDirName });
  }

  async init() {
    await this.reputation.init();
    await this.skills.init();
  }

  /**
   * Score every candidate actor against the FULL candidate set, so the
   * load-penalty normalization is consistent across all consumers (recommend,
   * rankActors). Returns an array of `{ actor_id, composite, repScore, recency,
   * load }` entries, NOT sorted.
   *
   * Centralizing scoring here is important: previously rankActors() called
   * recommend() once per actor with a singleton candidate list, which made
   * each call's `maxLoad` normalize against itself (always 1.0). Result:
   * hermes_list_agents could disagree with hermes_dispatch_recommend on the
   * same inputs.
   */
  async _scoreActors(task_type, candidate_actors) {
    const [repBoard, skillActors] = await Promise.all([
      this.reputation.leaderboard(),
      this.skills.listActors(),
    ]);
    const repMap = Object.fromEntries(repBoard.map((a) => [a.actor_id, a.score]));
    const now = Date.now();

    // Max task_type count across the FULL candidate set, for load normalization.
    let maxLoad = 1;
    for (const id of candidate_actors) {
      const load = skillActors[id]?.task_counts?.[task_type] ?? 0;
      if (load > maxLoad) maxLoad = load;
    }

    return candidate_actors.map((actor_id) => {
      const repScore   = repMap[actor_id] ?? 1.0;
      const lastActive = skillActors[actor_id]?.last_active_ts ?? 0;
      const recency    = (now - lastActive) < RECENCY_WINDOW_MS ? 1.0 : 0.5;
      const load       = (skillActors[actor_id]?.task_counts?.[task_type] ?? 0) / maxLoad;
      const composite  = repScore * WEIGHT_REP + recency * WEIGHT_FRESH - load * WEIGHT_LOAD;
      return { actor_id, composite, repScore, recency, load };
    });
  }

  /**
   * Pick the best actor from candidates for the given task_type.
   *
   * @param {string}   task_type         — e.g. "gate", "review", "build"
   * @param {string[]} candidate_actors  — actor_ids eligible for this task
   * @returns {{ actor_id: string|null, score: number, reasoning: string }}
   */
  async recommend(task_type, candidate_actors) {
    if (!candidate_actors || candidate_actors.length === 0) {
      return { actor_id: null, score: 0, reasoning: "no candidates" };
    }
    const scored = await this._scoreActors(task_type, candidate_actors);
    scored.sort((a, b) => b.composite - a.composite);
    const best = scored[0];
    return {
      actor_id: best.actor_id,
      score: parseFloat(best.composite.toFixed(4)),
      reasoning: `rep=${best.repScore.toFixed(2)} fresh=${best.recency} load=${best.load.toFixed(2)}`,
    };
  }

  /**
   * Enrich a list of agents with dispatch scores for a given task_type.
   * Useful for hermes_list_agents to surface routing hints.
   *
   * Scores are computed against the full `actor_ids` set (single _scoreActors
   * call), guaranteeing rankActors() and recommend() agree on the ordering.
   */
  async rankActors(task_type, actor_ids) {
    if (!actor_ids || actor_ids.length === 0) return [];
    const scored = await this._scoreActors(task_type, actor_ids);
    return scored
      .map((s) => ({ actor_id: s.actor_id, dispatch_score: parseFloat(s.composite.toFixed(4)) }))
      .sort((a, b) => b.dispatch_score - a.dispatch_score);
  }
}
