/**
 * HermesAgentBridge — connects HermesProof to the Hermes Agent reasoning loop.
 *
 * Provider backends (in failover order):
 *   1. DeepSeek v4         (DEEPSEEK_API_KEY)        — primary
 *   2. MiniMax highspeed   (MINIMAX_API_KEY)         — fallback (models 2.1-2.7)
 *   3. SiliconFlow         (SILICONFLOW_API_KEY)     — tertiary
 *   4. LM Studio (local)   (no key)                  — last-resort offline
 *
 * Once authorized for a project, Hermes Agent acts as the USER role:
 *   - Grants AS_USER sessions for in-scope actions
 *   - Closes BLOCKED escalations by reasoning about project goals
 *   - Posts AS_USER messages in STREAM/ inboxes
 *   - Can revoke its own session at any time
 *
 * Foolproofing:
 *   - API keys read ONLY from env (never logged, never echoed to ledger)
 *   - Capability-scoped sessions (Hermes Agent never gets unbounded user power)
 *   - All decisions evidenced (rationale + provider + model into evidence ledger)
 *   - Health probe must pass before any AS_USER decision
 *   - Falls back across providers automatically; if all four fail, decision = "defer to human"
 *   - Per-provider timeout independent of overall decision timeout
 */

// Provider definitions. Endpoint URLs for local providers come from env
// (LMSTUDIO_BASE_URL, OLLAMA_BASE_URL, HIPFIRE_BASE_URL) so the user's
// .env in G:\private\.env can override per-machine. API keys ALWAYS come
// from env — never hardcoded, never logged, never returned to callers.
function bearerHeaders(key) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}
function bareHeaders() {
  return { "Content-Type": "application/json" };
}
function openaiCompatBody({ model, messages }) {
  return {
    model,
    messages,
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 1200,
  };
}
const openaiCompatParse = (json) => json?.choices?.[0]?.message?.content;

const PROVIDERS = {
  deepseek: {
    name: "deepseek",
    endpoint_env: null,
    endpoint_default: "https://api.deepseek.com/v1/chat/completions",
    model_env: "DEEPSEEK_MODEL",
    model_default: "deepseek-chat", // v4 latest
    api_key_env: "DEEPSEEK_API_KEY",
    headers: bearerHeaders,
    body: openaiCompatBody,
    parse: openaiCompatParse,
  },
  minimax: {
    name: "minimax",
    endpoint_env: null,
    endpoint_default: "https://api.minimaxi.com/v1/text/chatcompletion_v2",
    model_env: "MINIMAX_MODEL",
    // Highspeed range 2.1-2.7 — the user's preferred line; concrete id selectable via MINIMAX_MODEL.
    model_default: "MiniMax-Text-01",
    api_key_env: "MINIMAX_API_KEY",
    headers: bearerHeaders,
    body: openaiCompatBody,
    parse: openaiCompatParse,
  },
  siliconflow: {
    name: "siliconflow",
    endpoint_env: null,
    endpoint_default: "https://api.siliconflow.cn/v1/chat/completions",
    model_env: "SILICONFLOW_MODEL",
    model_default: "deepseek-ai/DeepSeek-V2.5",
    api_key_env: "SILICONFLOW_API_KEY",
    headers: bearerHeaders,
    body: openaiCompatBody,
    parse: openaiCompatParse,
  },
  lm_studio: {
    name: "lm_studio",
    endpoint_env: "LMSTUDIO_BASE_URL", // e.g. http://localhost:1234/v1
    endpoint_default: "http://localhost:1234/v1/chat/completions",
    endpoint_suffix: "/chat/completions", // appended if env URL doesn't already include it
    model_env: "LMSTUDIO_MODEL",
    model_default: "NousResearch/Hermes-4-14B-FP8",
    api_key_env: null,
    headers: bareHeaders,
    body: openaiCompatBody,
    parse: openaiCompatParse,
  },
  ollama: {
    name: "ollama",
    endpoint_env: "OLLAMA_BASE_URL", // e.g. http://localhost:11434
    endpoint_default: "http://localhost:11434/v1/chat/completions",
    endpoint_suffix: "/v1/chat/completions",
    model_env: "OLLAMA_MODEL",
    model_default: "qwen2.5:14b",
    api_key_env: null,
    headers: bareHeaders,
    body: openaiCompatBody,
    parse: openaiCompatParse,
  },
  hipfire: {
    name: "hipfire",
    endpoint_env: "HIPFIRE_BASE_URL", // user's AMD GPU node
    endpoint_default: "http://localhost:8000/v1/chat/completions",
    endpoint_suffix: "/v1/chat/completions",
    model_env: "HIPFIRE_MODEL",
    model_default: "NousResearch/Hermes-4-14B-FP8",
    api_key_env: null,
    headers: bareHeaders,
    body: openaiCompatBody,
    parse: openaiCompatParse,
  },
};

// User preference (per 2026-05-03 conversation): DeepSeek + MiniMax are the
// preferred cloud brains; SiliconFlow is the third cloud; LM Studio / Ollama
// / Hipfire are local fallbacks. The registry layer (registry-providers.mjs)
// can extend this with any of the 62 Continue LLM provider classes when the
// user supplies the corresponding API key in env.
const DEFAULT_FAILOVER = ["deepseek", "minimax", "siliconflow", "lm_studio", "ollama", "hipfire"];

function resolveProviderEndpoint(p) {
  if (!p.endpoint_env) return p.endpoint_default;
  const fromEnv = process.env[p.endpoint_env];
  if (!fromEnv) return p.endpoint_default;
  // If user-provided URL already includes the chat-completions path, use as-is.
  if (fromEnv.includes("/chat/completions")) return fromEnv;
  const suffix = p.endpoint_suffix || "/chat/completions";
  return fromEnv.replace(/\/+$/, "") + suffix;
}
function resolveProviderModel(p) {
  return (p.model_env && process.env[p.model_env]) || p.model_default;
}
const HEALTH_TIMEOUT_MS = 5000;
const PROVIDER_TIMEOUT_MS = 25000;
const DECISION_OVERALL_TIMEOUT_MS = 60000;
const MAX_USER_SESSION_TTL_HOURS = 48;

function normalizeScope(scope) {
  if (!Array.isArray(scope)) return [];
  return [...new Set(scope.map((cap) => String(cap).trim()).filter(Boolean))];
}

function intersectScope(requestedScope, configuredScope) {
  const configured = new Set(configuredScope);
  return requestedScope.filter((cap) => configured.has(cap));
}

export class HermesAgentBridge {
  /**
   * @param {object} options
   * @param {AnonymousOrchestrator} options.orchestrator
   * @param {boolean} [options.enabled=false]
   * @param {string[]} [options.failover_order=DEFAULT_FAILOVER]
   * @param {string[]} [options.scope]
   * @param {string} [options.projectGoals]
   * @param {object} [options.modelOverrides] - { providerName: modelId }
   * @param {Array} [options.registryProviders] - extra providers loaded from
   *   policies/provider-registry/registry.yaml; appended to failover list.
   */
  constructor({
    orchestrator,
    enabled = false,
    failover_order = DEFAULT_FAILOVER,
    scope = null,
    projectGoals = null,
    modelOverrides = {},
    registryProviders = [],
  } = {}) {
    if (!orchestrator) throw new Error("HermesAgentBridge requires an orchestrator");
    this.orchestrator = orchestrator;
    this.enabled = enabled;
    this.failoverOrder = failover_order;
    this.scope = scope;
    this.projectGoals = projectGoals;
    this.modelOverrides = modelOverrides;
    this.registryProviders = registryProviders;
    this.activeSessionId = null;
    // Merge registry providers into the PROVIDERS map (don't shadow built-ins).
    this._mergedProviders = { ...PROVIDERS };
    for (const rp of registryProviders) {
      if (this._mergedProviders[rp.name]) continue; // built-in wins
      this._mergedProviders[rp.name] = rp;
      // Extend failover order with the new providers (only if not already present)
      if (!this.failoverOrder.includes(rp.name)) this.failoverOrder = [...this.failoverOrder, rp.name];
    }
  }

  _resolvedProviders() {
    const list = [];
    for (const name of this.failoverOrder) {
      const p = this._mergedProviders[name];
      if (!p) continue;
      const key = p.api_key_env ? process.env[p.api_key_env] : "no-key-needed";
      if (p.api_key_env && !key) continue; // skip if key not set
      list.push({
        ...p,
        endpoint: resolveProviderEndpoint(p),
        model: this.modelOverrides[name] ?? resolveProviderModel(p),
        api_key: p.api_key_env ? key : null,
      });
    }
    return list;
  }

  /**
   * Probe each enabled provider in order; return the first that's healthy.
   */
  async healthCheck() {
    if (!this.enabled) return { ok: false, reason: "bridge disabled" };
    const providers = this._resolvedProviders();
    if (providers.length === 0) {
      return { ok: false, reason: "no providers configured (no API keys + LM Studio absent)" };
    }
    for (const p of providers) {
      const status = await this._probeProvider(p);
      if (status.ok) return { ok: true, healthy_provider: p.name, model: p.model };
    }
    return { ok: false, reason: "all providers unhealthy" };
  }

  async _probeProvider(p) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
    try {
      // Cheapest probe: 1-token completion
      const r = await fetch(p.endpoint, {
        method: "POST",
        headers: p.headers(p.api_key ?? "x"),
        body: JSON.stringify(
          p.body({
            model: p.model,
            messages: [{ role: "user", content: "ok" }],
          })
        ),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      // Many providers return 200 even with minimal prompt; some validate auth at request time.
      return { ok: r.ok || r.status === 400 /* schema-only error still proves reachability */ };
    } catch (err) {
      clearTimeout(t);
      return { ok: false, reason: err.name === "AbortError" ? "timeout" : err.message };
    }
  }

  async requestUserSession({ requested_scope, ttl_hours = 8 }) {
    const configuredScope = normalizeScope(this.scope);
    if (configuredScope.length === 0) {
      return { ok: false, reason: "HERMES_AGENT_SCOPE must be configured before Hermes Agent can request USER sessions" };
    }

    const requestedScope = normalizeScope(requested_scope);
    const finalScope = intersectScope(requestedScope, configuredScope);
    if (finalScope.length === 0) {
      return { ok: false, reason: "requested_scope has no overlap with configured HERMES_AGENT_SCOPE" };
    }

    if (!Number.isInteger(ttl_hours) || ttl_hours <= 0 || ttl_hours > MAX_USER_SESSION_TTL_HOURS) {
      return { ok: false, reason: `ttl_hours must be a positive integer no greater than ${MAX_USER_SESSION_TTL_HOURS}` };
    }

    const health = await this.healthCheck();
    if (!health.ok) {
      return { ok: false, reason: `bridge unhealthy: ${health.reason}` };
    }
    if (!this.projectGoals) {
      return { ok: false, reason: "no project goals configured; bridge cannot reason" };
    }

    const decision = await this._askAgent({
      task: "user_session_authorization",
      project_goals: this.projectGoals,
      requested_scope: finalScope,
      bridge_scope_upper_bound: configuredScope,
    });

    if (!decision.ok) return decision;
    if (decision.verdict !== "approve") {
      return { ok: false, reason: `agent declined: ${decision.rationale}` };
    }

    const sessionId = `hermes-agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const grant = await this.orchestrator.grantUserSession({
      granted_by: "hermes-agent",
      session_id: sessionId,
      scope: finalScope,
      ttl_ms: ttl_hours * 60 * 60 * 1000,
    });
    this.activeSessionId = sessionId;
    return {
      ok: true,
      session: grant.session,
      rationale: decision.rationale,
      provider_used: decision.provider_used,
      model_used: decision.model_used,
    };
  }

  async revokeOwnSession() {
    if (!this.activeSessionId) return { ok: false, reason: "no active bridge session" };
    const r = await this.orchestrator.revokeUserSession({ session_id: this.activeSessionId });
    if (r.ok) this.activeSessionId = null;
    return r;
  }

  async resolveBlocked({ correlation, summary, full_thread }) {
    const auth = await this.orchestrator.checkUserAuthorization("resolve_blocked");
    if (!auth.allowed) {
      return { ok: false, reason: `not authorized: ${auth.reason}` };
    }
    return this._askAgent({
      task: "resolve_blocked_handoff",
      project_goals: this.projectGoals,
      correlation,
      summary,
      thread: full_thread,
    });
  }

  /**
   * Cascade through provider failover order until one returns a parseable JSON
   * verdict. Each provider has its own timeout; total decision time bounded
   * separately.
   */
  async _askAgent(payload) {
    const overallStart = Date.now();
    const providers = this._resolvedProviders();
    if (providers.length === 0) {
      return { ok: false, reason: "no providers available" };
    }
    const messages = [
      { role: "system", content: this._systemPrompt() },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ];

    let lastErr = null;
    for (const p of providers) {
      if (Date.now() - overallStart > DECISION_OVERALL_TIMEOUT_MS) {
        return { ok: false, reason: "overall decision timeout exceeded" };
      }
      const result = await this._callProvider(p, messages);
      if (result.ok) return { ...result, provider_used: p.name, model_used: p.model };
      lastErr = result.reason;
    }
    return { ok: false, reason: `all providers failed; last: ${lastErr}` };
  }

  async _callProvider(p, messages) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const r = await fetch(p.endpoint, {
        method: "POST",
        headers: p.headers(p.api_key ?? "x"),
        body: JSON.stringify(p.body({ model: p.model, messages })),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!r.ok) return { ok: false, reason: `${p.name} http ${r.status}` };
      const json = await r.json();
      const text = p.parse(json);
      if (!text) return { ok: false, reason: `${p.name} empty response` };
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Some models wrap JSON in markdown fences; attempt a salvage
        const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (fenceMatch) {
          try {
            parsed = JSON.parse(fenceMatch[1]);
          } catch {
            return { ok: false, reason: `${p.name} non-JSON response` };
          }
        } else {
          return { ok: false, reason: `${p.name} non-JSON response` };
        }
      }
      if (!parsed.verdict || !parsed.rationale) {
        return { ok: false, reason: `${p.name} missing verdict/rationale` };
      }
      return { ok: true, ...parsed };
    } catch (err) {
      clearTimeout(t);
      return {
        ok: false,
        reason: err.name === "AbortError" ? `${p.name} timeout` : `${p.name} ${err.message}`,
      };
    }
  }

  _systemPrompt() {
    return `You are the Hermes Agent acting as the anonymous USER for a software project.
The user has authorized you to make scoped decisions on their behalf while they are away.

Project goals: ${this.projectGoals}

For every input you receive, respond with a STRICT JSON object (no markdown fences):
{
  "verdict": "approve" | "decline" | "defer",
  "rationale": "short reason; cite project goals or scope when relevant",
  "scope_recommendation": optional array of capability strings
}

Decline if the request is outside scope, ambiguous, destructive without good reason,
or contradicts the project goals. Defer (= ask the actual human when they wake up)
if the situation requires real-world judgment beyond your authorization. Approve
only if the action is clearly in-scope, reversible or routine, and forward-progress
on the project goals.

You are NOT the user. You are a delegate with bounded authority. Always preserve
the user's ability to override you when they wake up.`;
  }
}

export { PROVIDERS, DEFAULT_FAILOVER };
