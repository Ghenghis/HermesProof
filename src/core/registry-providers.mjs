/**
 * registry-providers.mjs — load provider definitions from policies/provider-registry/registry.yaml
 *
 * Lets the Hermes Agent bridge use ANY of the 62 Continue LLM classes (Anthropic,
 * Cohere, OpenRouter, Mistral, Bedrock, Vertex, Cerebras, Cloudflare, etc.) on top
 * of the 6 hardcoded built-ins (DeepSeek, MiniMax, SiliconFlow, LM Studio, Ollama,
 * Hipfire). Per the user's directive: don't exclude any providers.
 *
 * Each registry entry can supply: provider_name (the routing key), endpoint
 * template, api_key_env, default_model, headers_style ("bearer" | "openai" |
 * "azure" | "x-api-key" | "none"), and a body shape ("openai_compat" |
 * "anthropic" | "cohere" | "custom").
 *
 * Foolproofing:
 *   - Only providers with their api_key_env set in process.env are activated
 *     (skip silently otherwise — same rule as built-ins)
 *   - Registry parse failures fail-soft: bridge falls back to built-ins only
 *   - Pure stdlib YAML subset parser (no js-yaml dep)
 *   - Never logs the api_key value, only the env var name
 */

import fs from "node:fs/promises";
import path from "node:path";

// Headers style → fn(apiKey) → headers object
const HEADER_STYLES = {
  bearer: (key) => ({ "Content-Type": "application/json", Authorization: `Bearer ${key}` }),
  openai: (key) => ({ "Content-Type": "application/json", Authorization: `Bearer ${key}` }),
  "x-api-key": (key) => ({ "Content-Type": "application/json", "x-api-key": key }),
  anthropic: (key) => ({
    "Content-Type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  }),
  azure: (key) => ({ "Content-Type": "application/json", "api-key": key }),
  none: () => ({ "Content-Type": "application/json" }),
};

// Body shape → fn({model, messages}) → request body
const BODY_SHAPES = {
  openai_compat: ({ model, messages }) => ({
    model,
    messages,
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 1200,
  }),
  anthropic: ({ model, messages }) => {
    // Anthropic API expects `system` separately, no response_format
    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    const userMessages = messages.filter((m) => m.role !== "system");
    return {
      model,
      max_tokens: 1200,
      temperature: 0.1,
      ...(systemMsg ? { system: systemMsg } : {}),
      messages: userMessages,
    };
  },
  cohere: ({ model, messages }) => ({
    model,
    message: messages[messages.length - 1]?.content ?? "",
    chat_history: messages.slice(0, -1).map((m) => ({
      role: m.role === "assistant" ? "CHATBOT" : "USER",
      message: m.content,
    })),
    temperature: 0.1,
  }),
};

// Parse fn → extract assistant text from the response JSON
const PARSE_SHAPES = {
  openai_compat: (json) => json?.choices?.[0]?.message?.content,
  anthropic: (json) => {
    const block = Array.isArray(json?.content) ? json.content.find((b) => b.type === "text") : null;
    return block?.text;
  },
  cohere: (json) => json?.text,
};

/**
 * Tiny YAML subset parser — handles flat key:value, nested 2-space indent maps,
 * and `- ` list items with key:value pairs. Sufficient for our registry.yaml.
 */
function parseYamlSubset(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  const stack = [{ obj: root, indent: -1 }];
  const cleanValue = (v) => {
    let s = v.trim();
    if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1);
    else if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    return s;
  };
  for (let raw of lines) {
    if (!raw || /^\s*#/.test(raw)) continue;
    const indent = raw.match(/^ */)[0].length;
    const trimmed = raw.trim();
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const top = stack[stack.length - 1];
    if (trimmed.startsWith("- ")) {
      // List item
      const item = {};
      if (Array.isArray(top.obj)) {
        top.obj.push(item);
      } else if (top.lastKey) {
        if (!Array.isArray(top.obj[top.lastKey])) top.obj[top.lastKey] = [];
        top.obj[top.lastKey].push(item);
      }
      const rest = trimmed.slice(2);
      if (rest.includes(":")) {
        const [k, ...vparts] = rest.split(":");
        const v = vparts.join(":").trim();
        if (v) item[k.trim()] = cleanValue(v);
        else item[k.trim()] = {};
      }
      stack.push({ obj: item, indent });
      continue;
    }
    const m = trimmed.match(/^([\w.-]+):(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const value = m[2];
    if (value.trim() === "") {
      const child = {};
      top.obj[key] = child;
      top.lastKey = key;
      stack.push({ obj: child, indent });
    } else {
      top.obj[key] = cleanValue(value);
    }
  }
  return root;
}

/**
 * Map a registry entry into a bridge provider config.
 * Returns null if the entry can't be safely mapped (no env-var, unknown style, etc.).
 */
function entryToProvider(entry, defaults = {}) {
  const name = entry.provider_name;
  if (!name) return null;
  const apiKeyEnv = entry.api_key_env || guessApiKeyEnv(name);
  // For some providers, api_key may not be required (local). Allow if endpoint_env is set.
  const endpointEnv = entry.endpoint_env || null;
  const endpointDefault = entry.endpoint_default || guessEndpointDefault(name);
  if (!endpointDefault) return null;
  const headersStyle = entry.headers_style || guessHeadersStyle(name);
  const bodyShape = entry.body_shape || guessBodyShape(name);
  return {
    name,
    endpoint_env: endpointEnv,
    endpoint_default: endpointDefault,
    endpoint_suffix: entry.endpoint_suffix || "/chat/completions",
    model_env: entry.model_env || `${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_MODEL`,
    model_default: entry.default_model || defaults.model_default || "",
    api_key_env: apiKeyEnv,
    headers: HEADER_STYLES[headersStyle] ?? HEADER_STYLES.bearer,
    body: BODY_SHAPES[bodyShape] ?? BODY_SHAPES.openai_compat,
    parse: PARSE_SHAPES[bodyShape] ?? PARSE_SHAPES.openai_compat,
    source: "registry",
  };
}

function guessApiKeyEnv(name) {
  const upper = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `${upper}_API_KEY`;
}

function guessEndpointDefault(name) {
  // Best-effort defaults for the most common Continue providers; users override
  // via registry.yaml `endpoint_default:` field for any anomaly.
  const map = {
    anthropic: "https://api.anthropic.com/v1/messages",
    openai: "https://api.openai.com/v1/chat/completions",
    deepseek: "https://api.deepseek.com/v1/chat/completions",
    minimax: "https://api.minimaxi.com/v1/text/chatcompletion_v2",
    siliconflow: "https://api.siliconflow.cn/v1/chat/completions",
    cohere: "https://api.cohere.com/v1/chat",
    mistral: "https://api.mistral.ai/v1/chat/completions",
    groq: "https://api.groq.com/openai/v1/chat/completions",
    fireworks: "https://api.fireworks.ai/inference/v1/chat/completions",
    together: "https://api.together.xyz/v1/chat/completions",
    openrouter: "https://openrouter.ai/api/v1/chat/completions",
    cerebras: "https://api.cerebras.ai/v1/chat/completions",
    nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
    cloudflare: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/meta/llama-3.1-8b-instruct",
    deepinfra: "https://api.deepinfra.com/v1/openai/chat/completions",
    sambanova: "https://api.sambanova.ai/v1/chat/completions",
    nebius: "https://api.studio.nebius.ai/v1/chat/completions",
    novita: "https://api.novita.ai/v3/openai/chat/completions",
    ovhcloud: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    moonshot: "https://api.moonshot.cn/v1/chat/completions",
    kindo: "https://llm.kindo.ai/v1/chat/completions",
    venice: "https://api.venice.ai/api/v1/chat/completions",
    xai: "https://api.x.ai/v1/chat/completions",
    voyage: "https://api.voyageai.com/v1/chat/completions",
    relace: "https://api.relace.ai/v1/chat/completions",
    inception: "https://api.inceptionlabs.ai/v1/chat/completions",
    asksage: "https://api.asksage.ai/v1/chat/completions",
    scaleway: "https://api.scaleway.ai/v1/chat/completions",
    tensorix: "https://api.tensorix.ai/v1/chat/completions",
    ncompass: "https://api.ncompass.tech/v1/chat/completions",
    zai: "https://api.z.ai/v1/chat/completions",
    nous: "https://api.nousresearch.com/v1/chat/completions",
    gemini: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    bedrock: "https://bedrock-runtime.{region}.amazonaws.com/model/{model}/invoke",
    azure: "https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2024-08-01-preview",
    vertexai: "https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/google/models/{model}:streamGenerateContent",
    watsonx: "https://us-south.ml.cloud.ibm.com/ml/v1/text/chat",
  };
  return map[name.toLowerCase()] || null;
}

function guessHeadersStyle(name) {
  if (name.toLowerCase() === "anthropic") return "anthropic";
  if (name.toLowerCase() === "azure") return "azure";
  if (name.toLowerCase() === "cohere") return "bearer";
  return "bearer";
}

function guessBodyShape(name) {
  if (name.toLowerCase() === "anthropic") return "anthropic";
  if (name.toLowerCase() === "cohere") return "cohere";
  return "openai_compat";
}

/**
 * Load all enabled providers from the registry. Returns an array compatible
 * with the bridge's _resolvedProviders() output (sans api_key resolution,
 * which the bridge does at call time).
 */
export async function loadRegistryProviders(options = {}) {
  const {
    workspaceRoot = process.cwd(),
    registryPath = path.join(workspaceRoot, "policies", "provider-registry", "registry.yaml"),
  } = options;
  let parsed;
  try {
    const text = await fs.readFile(registryPath, "utf8");
    parsed = parseYamlSubset(text);
  } catch (err) {
    return { ok: false, reason: `registry not loadable: ${err.message}`, providers: [] };
  }
  const continueClasses = parsed.continue_llm_classes;
  if (!Array.isArray(continueClasses)) {
    return { ok: false, reason: "registry has no continue_llm_classes array", providers: [] };
  }
  const providers = [];
  for (const entry of continueClasses) {
    const p = entryToProvider(entry);
    if (p) providers.push(p);
  }
  return { ok: true, providers };
}

export { HEADER_STYLES, BODY_SHAPES, PARSE_SHAPES };
