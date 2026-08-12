/**
 * ProviderPerformanceTracker — rolling model-provider performance ledger.
 *
 * This is separate from agent reputation: one agent can call many model
 * providers, and the right provider for "live controller" may be wrong for
 * "reverse engineering research" or "critic". The ledger records outcomes by
 * provider + task_type so HermesProof can route help to the model that has
 * actually been succeeding recently.
 *
 * State lives at: .hermes3d_orchestrator/provider_performance.json
 */

import path from "node:path";
import { ensureDir, readJson, writeJsonAtomic } from "./fs-utils.mjs";
import { makeMutex } from "./mutex.mjs";

const WINDOW_SIZE = 80;

const OUTCOME_REWARDS = Object.freeze({
  verified: 1.0,
  completed: 1.0,
  partial: 0.35,
  needs_proof: 0.0,
  failed: -1.0,
  timeout: -0.5,
  rejected: -1.0,
});

const TERMINAL_BAD = new Set(["failed", "timeout", "rejected"]);
const TERMINAL_GOOD = new Set(["verified", "completed"]);

function normalizeProviderId(providerId) {
  return String(providerId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clampReward(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(-1, Math.min(1, n));
}

function cleanTaskType(taskType) {
  return String(taskType || "general")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "general";
}

function trimText(value, max = 300) {
  const s = String(value || "").trim();
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

function summarizeEvents(events) {
  const count = events.length;
  if (count === 0) {
    return {
      count: 0,
      verified: 0,
      completed: 0,
      partial: 0,
      needs_proof: 0,
      failed: 0,
      timeout: 0,
      rejected: 0,
      success_rate: 0,
      failure_rate: 0,
      avg_reward: 0,
      avg_latency_ms: null,
      score: 1.0,
      recommendation: "baseline",
    };
  }

  const byOutcome = {
    verified: 0,
    completed: 0,
    partial: 0,
    needs_proof: 0,
    failed: 0,
    timeout: 0,
    rejected: 0,
  };
  let rewardTotal = 0;
  let latencyTotal = 0;
  let latencyCount = 0;
  for (const event of events) {
    byOutcome[event.outcome] = (byOutcome[event.outcome] ?? 0) + 1;
    rewardTotal += Number(event.reward || 0);
    if (Number.isFinite(event.latency_ms) && event.latency_ms >= 0) {
      latencyTotal += event.latency_ms;
      latencyCount += 1;
    }
  }
  const successes = events.filter((e) => TERMINAL_GOOD.has(e.outcome)).length;
  const failures = events.filter((e) => TERMINAL_BAD.has(e.outcome)).length;
  const successRate = successes / count;
  const failureRate = failures / count;
  const avgReward = rewardTotal / count;
  const avgLatencyMs = latencyCount ? latencyTotal / latencyCount : null;
  const latencyPenalty = avgLatencyMs === null ? 0 : Math.min(0.25, avgLatencyMs / 120000);
  const score = Math.max(0, 1.0 + avgReward + successRate - failureRate - latencyPenalty);

  let recommendation = "use";
  if (count >= 3 && failureRate >= 0.6) recommendation = "avoid";
  else if (count >= 3 && failureRate >= 0.4) recommendation = "watch";
  else if (count >= 3 && successRate >= 0.7) recommendation = "prefer";

  return {
    count,
    ...byOutcome,
    success_rate: Number(successRate.toFixed(4)),
    failure_rate: Number(failureRate.toFixed(4)),
    avg_reward: Number(avgReward.toFixed(4)),
    avg_latency_ms: avgLatencyMs === null ? null : Math.round(avgLatencyMs),
    score: Number(score.toFixed(4)),
    recommendation,
  };
}

export class ProviderPerformanceTracker {
  constructor({ workspaceRoot, stateDirName = ".hermes3d_orchestrator" } = {}) {
    if (!workspaceRoot) throw new Error("ProviderPerformanceTracker requires workspaceRoot");
    this.stateDir = path.join(workspaceRoot, stateDirName);
    this.stateFile = path.join(this.stateDir, "provider_performance.json");
    this._mutex = makeMutex();
  }

  async init() {
    await ensureDir(this.stateDir);
    const existing = await readJson(this.stateFile, null);
    if (!existing) {
      await writeJsonAtomic(this.stateFile, { schema_version: 1, providers: {} });
    }
  }

  async _read() {
    return (await readJson(this.stateFile, null)) ?? { schema_version: 1, providers: {} };
  }

  async _write(state) {
    await writeJsonAtomic(this.stateFile, state);
  }

  async recordOutcome({
    provider_id,
    model_name = "",
    task_type = "general",
    outcome,
    reward = null,
    latency_ms = null,
    context = "",
    evidence = "",
  } = {}) {
    const providerId = normalizeProviderId(provider_id);
    if (!providerId) throw new Error("provider_id is required");
    if (!(outcome in OUTCOME_REWARDS)) {
      throw new Error(`unknown provider outcome: ${outcome}. Valid: ${Object.keys(OUTCOME_REWARDS).join(", ")}`);
    }
    const taskType = cleanTaskType(task_type);
    const eventReward = clampReward(reward) ?? OUTCOME_REWARDS[outcome];
    const latency = Number.isFinite(Number(latency_ms)) ? Math.max(0, Math.round(Number(latency_ms))) : null;

    return this._mutex(async () => {
      const state = await this._read();
      if (!state.providers[providerId]) {
        state.providers[providerId] = { events: [], total_outcomes: 0 };
      }
      const rec = state.providers[providerId];
      const event = {
        ts: Date.now(),
        task_type: taskType,
        outcome,
        reward: eventReward,
        model_name: trimText(model_name, 160),
        latency_ms: latency,
        context: trimText(context, 300),
        evidence: trimText(evidence, 300),
      };
      rec.events.push(event);
      if (rec.events.length > WINDOW_SIZE) rec.events = rec.events.slice(-WINDOW_SIZE);
      rec.total_outcomes = (rec.total_outcomes ?? 0) + 1;
      rec.summary = summarizeEvents(rec.events);
      await this._write(state);
      return {
        ok: true,
        provider_id: providerId,
        task_type: taskType,
        outcome,
        reward: eventReward,
        score: rec.summary.score,
        recommendation: rec.summary.recommendation,
      };
    });
  }

  async stats({ provider_id = "", task_type = "", include_history = false } = {}) {
    const state = await this._read();
    const providerFilter = provider_id ? normalizeProviderId(provider_id) : "";
    const taskFilter = task_type ? cleanTaskType(task_type) : "";
    const providers = Object.entries(state.providers || {})
      .filter(([id]) => !providerFilter || id === providerFilter)
      .map(([id, rec]) => {
        const events = (rec.events || []).filter((event) => !taskFilter || event.task_type === taskFilter);
        const summary = summarizeEvents(events);
        const out = {
          provider_id: id,
          total_outcomes: rec.total_outcomes ?? events.length,
          task_type: taskFilter || null,
          ...summary,
        };
        if (include_history) out.recent_events = events.slice(-10);
        return out;
      })
      .sort((a, b) => b.score - a.score || a.provider_id.localeCompare(b.provider_id));
    return { ok: true, providers, count: providers.length };
  }

  async rankProviders({ task_type = "general", candidates = [], min_score = 0 } = {}) {
    const taskType = cleanTaskType(task_type);
    const candidateIds = [...new Set((candidates || []).map(normalizeProviderId).filter(Boolean))];
    const state = await this._read();
    const baseIds = candidateIds.length ? candidateIds : Object.keys(state.providers || {});
    const ranked = baseIds
      .map((providerId, index) => {
        const events = (state.providers?.[providerId]?.events || []).filter((event) => event.task_type === taskType);
        const summary = summarizeEvents(events);
        return { provider_id: providerId, task_type: taskType, input_order: index, ...summary };
      })
      .filter((entry) => entry.score >= min_score)
      .sort((a, b) => b.score - a.score || a.input_order - b.input_order || a.provider_id.localeCompare(b.provider_id))
      .map(({ input_order, ...entry }) => entry);
    return { ok: true, task_type: taskType, providers: ranked, count: ranked.length };
  }
}

export {
  OUTCOME_REWARDS,
  WINDOW_SIZE,
  cleanTaskType,
  normalizeProviderId,
  summarizeEvents,
};
