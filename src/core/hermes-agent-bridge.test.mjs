import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HermesAgentBridge } from "./hermes-agent-bridge.mjs";
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
