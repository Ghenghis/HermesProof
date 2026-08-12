import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_FAILOVER, HermesAgentBridge, PROVIDERS } from "./hermes-agent-bridge.mjs";
import { AnonymousOrchestrator } from "./anonymous-orchestrator.mjs";
import { verifyChainedLog } from "./fs-utils.mjs";

class TestBridge extends HermesAgentBridge {
  constructor(options = {}) {
    super({
      orchestrator: options.orchestrator ?? makeOrchestrator(),
      enabled: true,
      projectGoals: "ship hardening safely",
      ...options,
    });
    this.healthCalls = 0;
    this.askCalls = [];
  }

  async healthCheck() {
    this.healthCalls += 1;
    return { ok: true, healthy_provider: "test-provider", model: "test-model" };
  }

  async _askAgent(payload) {
    this.askCalls.push(payload);
    return {
      ok: true,
      verdict: "approve",
      rationale: "in scope",
      provider_used: "test-provider",
      model_used: "test-model",
    };
  }
}

function makeOrchestrator() {
  return {
    grants: [],
    evidence: [],
    async grantUserSession(grant) {
      this.grants.push(grant);
      return { ok: true, session: { ...grant } };
    },
    async _appendEvidence(entry) {
      this.evidence.push(entry);
    },
    async checkUserAuthorization() {
      return { allowed: true };
    },
  };
}

async function withAnonymousOrchestrator(fn) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-agent-bridge-"));
  const orchestrator = new AnonymousOrchestrator({ workspaceRoot });
  await orchestrator.init();
  try {
    await fn(orchestrator);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function readEvidenceEntries(orchestrator) {
  const raw = await fs.readFile(orchestrator.evidenceFile, "utf8");
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("HermesAgentBridge USER session hardening", () => {
  it("defaults to MiniMax M3 with DeepSeek fallback (paid-cloud-first then local)", () => {
    // Defaults put paid cloud providers (minimax, deepinfra, deepseek, siliconflow)
    // before local fallbacks (lm_studio, ollama). The historic 2-name failover
    // ["minimax","deepseek"] is a strict prefix of the new explicit ordering.
    assert.ok(DEFAULT_FAILOVER[0] === "minimax", "minimax must be the primary default");
    assert.ok(DEFAULT_FAILOVER.includes("deepseek"), "deepseek must remain reachable");
    assert.deepEqual(
      DEFAULT_FAILOVER.slice(0, 4),
      ["minimax", "deepinfra", "deepseek", "siliconflow"],
      "paid-cloud-first ordering"
    );
    assert.deepEqual(
      DEFAULT_FAILOVER.slice(4),
      ["lm_studio", "ollama"],
      "local-fallback ordering"
    );
    assert.equal(PROVIDERS.minimax.endpoint_default, "https://api.minimax.io/v1/chat/completions");
    assert.equal(PROVIDERS.minimax.model_default, "MiniMax-M3");
    assert.equal(PROVIDERS.deepinfra.endpoint_default, "https://api.deepinfra.com/v1/openai/chat/completions");
    assert.equal(PROVIDERS.deepseek.model_default, "deepseek-v4-flash");
    assert.equal(PROVIDERS.siliconflow.model_default, "deepseek-ai/DeepSeek-V4-Flash");
  });

  it("resolves alternate private env names without exposing key values", () => {
    const old = {
      MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
      DEEPINFRA_API_KEY: process.env.DEEPINFRA_API_KEY,
      DEEPINFRA_TOKEN: process.env.DEEPINFRA_TOKEN,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      SILICONFLOW_API_KEY: process.env.SILICONFLOW_API_KEY,
      SILICON_FLOW_API_KEY: process.env.SILICON_FLOW_API_KEY,
      LMSTUDIO_BASE_URL: process.env.LMSTUDIO_BASE_URL,
      LM_STUDIO_BASE_URL: process.env.LM_STUDIO_BASE_URL,
      LM_STUDIO_MODEL: process.env.LM_STUDIO_MODEL,
    };
    try {
      process.env.MINIMAX_API_KEY = "test-minimax-key";
      delete process.env.DEEPINFRA_API_KEY;
      process.env.DEEPINFRA_TOKEN = "test-deepinfra-token";
      process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
      delete process.env.SILICONFLOW_API_KEY;
      process.env.SILICON_FLOW_API_KEY = "test-siliconflow-key";
      delete process.env.LMSTUDIO_BASE_URL;
      process.env.LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
      process.env.LM_STUDIO_MODEL = "local-test-model";

      const bridge = new HermesAgentBridge({
        orchestrator: makeOrchestrator(),
        enabled: true,
        failover_order: ["minimax", "deepseek", "lm_studio"],
      });
      const providers = bridge._resolvedProviders();

      assert.deepEqual(providers.map((provider) => provider.name), ["minimax", "deepseek", "lm_studio"]);
      assert.equal(providers.find((provider) => provider.name === "lm_studio")?.endpoint, "http://127.0.0.1:1234/v1/chat/completions");
      assert.equal(providers.find((provider) => provider.name === "lm_studio")?.model, "local-test-model");
    } finally {
      for (const [key, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("rejects missing configured scope before provider call", async () => {
    const orchestrator = makeOrchestrator();
    const bridge = new TestBridge({ orchestrator, scope: null });

    const result = await bridge.requestUserSession({ requested_scope: ["resolve_blocked"] });

    assert.equal(result.ok, false);
    assert.match(result.reason, /HERMES_AGENT_SCOPE must be configured/);
    assert.equal(bridge.healthCalls, 0);
    assert.equal(bridge.askCalls.length, 0);
    assert.equal(orchestrator.grants.length, 0);
  });

  it("intersects requested scope before asking agent and granting session", async () => {
    const orchestrator = makeOrchestrator();
    const bridge = new TestBridge({
      orchestrator,
      scope: ["resolve_blocked", "post_stream_message"],
    });

    const result = await bridge.requestUserSession({
      requested_scope: ["resolve_blocked", "recover_stale_locks"],
      ttl_hours: 4,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(bridge.askCalls[0].requested_scope, ["resolve_blocked"]);
    assert.deepEqual(bridge.askCalls[0].bridge_scope_upper_bound, ["resolve_blocked", "post_stream_message"]);
    assert.deepEqual(orchestrator.grants[0].scope, ["resolve_blocked"]);
    assert.equal(orchestrator.grants[0].ttl_ms, 4 * 60 * 60 * 1000);
    assert.equal(orchestrator.evidence[0].kind, "hermes_agent_decision");
    assert.deepEqual(orchestrator.evidence[0].requested_scope, ["resolve_blocked", "recover_stale_locks"]);
    assert.deepEqual(orchestrator.evidence[0].final_scope, ["resolve_blocked"]);
  });

  it("rejects empty scope intersection before provider call or grant", async () => {
    const orchestrator = makeOrchestrator();
    const bridge = new TestBridge({
      orchestrator,
      scope: ["resolve_blocked"],
    });

    const result = await bridge.requestUserSession({
      requested_scope: ["recover_stale_locks"],
    });

    assert.equal(result.ok, false);
    assert.match(result.reason, /no overlap/);
    assert.equal(bridge.healthCalls, 0);
    assert.equal(bridge.askCalls.length, 0);
    assert.equal(orchestrator.grants.length, 0);
  });

  it("rejects invalid ttl before provider call or grant", async () => {
    for (const ttl_hours of [0, -1, 49, 1.5, Number.NaN]) {
      const orchestrator = makeOrchestrator();
      const bridge = new TestBridge({
        orchestrator,
        scope: ["resolve_blocked"],
      });

      const result = await bridge.requestUserSession({
        requested_scope: ["resolve_blocked"],
        ttl_hours,
      });

      assert.equal(result.ok, false);
      assert.match(result.reason, /ttl_hours must be a positive integer no greater than 48/);
      assert.equal(bridge.healthCalls, 0);
      assert.equal(bridge.askCalls.length, 0);
      assert.equal(orchestrator.grants.length, 0);
    }
  });

  it("resolves registry providers from merged providers in failover order", () => {
    const bridge = new HermesAgentBridge({
      orchestrator: makeOrchestrator(),
      enabled: true,
      failover_order: ["synthetic_registry"],
      registryProviders: [
        {
          name: "synthetic_registry",
          endpoint_env: null,
          endpoint_default: "http://localhost:9999/v1/chat/completions",
          model_env: null,
          model_default: "synthetic-model",
          api_key_env: null,
          headers: () => ({ "Content-Type": "application/json" }),
          body: ({ model, messages }) => ({ model, messages }),
          parse: (json) => json.text,
        },
      ],
    });

    const providers = bridge._resolvedProviders();

    assert.equal(providers.length, 1);
    assert.equal(providers[0].name, "synthetic_registry");
    assert.equal(providers[0].endpoint, "http://localhost:9999/v1/chat/completions");
    assert.equal(providers[0].model, "synthetic-model");
  });

  it("keeps the configured provider order despite performance scores", async () => {
    const providerPerformance = {
      async rankProviders({ task_type, candidates }) {
        assert.equal(task_type, "aice_live_controller");
        assert.deepEqual(candidates, ["provider-a", "provider-b"]);
        return {
          ok: true,
          providers: [
            { provider_id: "provider-b", score: 2.25 },
            { provider_id: "provider-a", score: 0.5 },
          ],
        };
      },
    };
    const bridge = new HermesAgentBridge({
      orchestrator: makeOrchestrator(),
      enabled: true,
      failover_order: ["provider-a", "provider-b"],
      providerPerformance,
      registryProviders: [
        {
          name: "provider-a",
          endpoint_env: null,
          endpoint_default: "http://localhost:9998/v1/chat/completions",
          model_env: null,
          model_default: "model-a",
          api_key_env: null,
          headers: () => ({ "Content-Type": "application/json" }),
          body: ({ model, messages }) => ({ model, messages }),
          parse: (json) => json.text,
        },
        {
          name: "provider-b",
          endpoint_env: null,
          endpoint_default: "http://localhost:9999/v1/chat/completions",
          model_env: null,
          model_default: "model-b",
          api_key_env: null,
          headers: () => ({ "Content-Type": "application/json" }),
          body: ({ model, messages }) => ({ model, messages }),
          parse: (json) => json.text,
        },
      ],
    });

    assert.deepEqual(bridge._resolvedProviders().map((p) => p.name), ["provider-a", "provider-b"]);
    assert.deepEqual((await bridge._providersForTask("aice_live_controller")).map((p) => p.name), ["provider-a", "provider-b"]);
  });

  it("records provider success and failure from Hermes Agent decisions", async () => {
    const recorded = [];
    const providerPerformance = {
      async rankProviders({ candidates }) {
        return {
          ok: true,
          providers: candidates.map((provider_id) => ({ provider_id, score: 1.0 })),
        };
      },
      async recordOutcome(event) {
        recorded.push(event);
        return { ok: true };
      },
    };
    class RecordingBridge extends HermesAgentBridge {
      async _callProvider(provider) {
        if (provider.name === "provider-a") {
          return { ok: false, reason: "provider-a timeout" };
        }
        return { ok: true, verdict: "approve", rationale: "json ok" };
      }
    }
    const bridge = new RecordingBridge({
      orchestrator: makeOrchestrator(),
      enabled: true,
      failover_order: ["provider-a", "provider-b"],
      providerPerformance,
      registryProviders: [
        {
          name: "provider-a",
          endpoint_env: null,
          endpoint_default: "http://localhost:9998/v1/chat/completions",
          model_env: null,
          model_default: "model-a",
          api_key_env: null,
          headers: () => ({ "Content-Type": "application/json" }),
          body: ({ model, messages }) => ({ model, messages }),
          parse: (json) => json.text,
        },
        {
          name: "provider-b",
          endpoint_env: null,
          endpoint_default: "http://localhost:9999/v1/chat/completions",
          model_env: null,
          model_default: "model-b",
          api_key_env: null,
          headers: () => ({ "Content-Type": "application/json" }),
          body: ({ model, messages }) => ({ model, messages }),
          parse: (json) => json.text,
        },
      ],
    });

    const decision = await bridge._askAgent({ task: "unit_test_decision" });

    assert.equal(decision.ok, true);
    assert.equal(decision.provider_used, "provider-b");
    assert.deepEqual(recorded.map((event) => [event.provider_id, event.outcome, event.task_type]), [
      ["provider-a", "timeout", "hermes_agent:unit_test_decision"],
      ["provider-b", "completed", "hermes_agent:unit_test_decision"],
    ]);
  });

  it("writes USER-session decisions to the chained evidence ledger", async () => {
    await withAnonymousOrchestrator(async (orchestrator) => {
      const bridge = new TestBridge({
        orchestrator,
        scope: ["resolve_blocked", "post_stream_message"],
      });

      const result = await bridge.requestUserSession({
        requested_scope: ["resolve_blocked", "recover_stale_locks"],
        ttl_hours: 2,
      });

      assert.equal(result.ok, true);
      const entries = await readEvidenceEntries(orchestrator);
      const decision = entries.find((entry) => entry.kind === "hermes_agent_decision");
      assert.ok(decision, "Hermes Agent decision evidence should be written");
      assert.equal(decision.task, "user_session_authorization");
      assert.deepEqual(decision.requested_scope, ["resolve_blocked", "recover_stale_locks"]);
      assert.deepEqual(decision.final_scope, ["resolve_blocked"]);
      assert.equal(decision.verdict, "approve");
      assert.equal(decision.provider_used, "test-provider");
      assert.equal(decision.model_used, "test-model");

      const verified = await verifyChainedLog(orchestrator.evidenceFile);
      assert.equal(verified.ok, true);
      assert.equal(verified.unchained, 0);
    });
  });

  it("writes blocked-resolution decisions to the chained evidence ledger", async () => {
    await withAnonymousOrchestrator(async (orchestrator) => {
      await orchestrator.grantUserSession({
        granted_by: "hermes-agent",
        session_id: "session-resolve-blocked",
        scope: ["resolve_blocked"],
        ttl_ms: 60_000,
      });
      const bridge = new TestBridge({
        orchestrator,
        scope: ["resolve_blocked"],
      });

      const result = await bridge.resolveBlocked({
        correlation: "handoff_123",
        summary: "A short blocked handoff summary",
        full_thread: "full thread is sent to provider but not persisted",
      });

      assert.equal(result.ok, true);
      const entries = await readEvidenceEntries(orchestrator);
      const decision = entries.find((entry) => entry.kind === "hermes_agent_blocked_resolution");
      assert.ok(decision, "blocked resolution evidence should be written");
      assert.equal(decision.correlation, "handoff_123");
      assert.equal(decision.summary_hash.length, 16);
      assert.equal(decision.verdict, "approve");
      assert.equal(decision.thread, undefined);

      const verified = await verifyChainedLog(orchestrator.evidenceFile);
      assert.equal(verified.ok, true);
      assert.equal(verified.unchained, 0);
    });
  });
});
