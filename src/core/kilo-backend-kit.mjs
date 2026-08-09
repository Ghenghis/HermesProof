import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const KILO_PACK_SCHEMA = {
  schema: "hermesproof.capability-pack.v1",
  namespace: "io.hermesproof.kilo",
  capabilities: ["kilo.cli", "kilo.serve", "mcp.client", "backend.runtime", "backend.indexing"],
  permissions: ["workspace:read", "process:child", "loopback:http"],
  install_scope: "workspace-content-addressed",
  provenance: "pinned-source-integrity-plus-install-receipt"
};
const schemaSha256 = crypto
  .createHash("sha256")
  .update(JSON.stringify(KILO_PACK_SCHEMA))
  .digest("hex");

export const KILO_BACKEND_CAPABILITY_PACK = Object.freeze({
  id: "kilo-backend",
  namespace: KILO_PACK_SCHEMA.namespace,
  version: "7.4.20",
  source: Object.freeze({
    type: "npm",
    package: "@kilocode/cli",
    integrity: "sha512-u/9CvTuf5TkiHFqe5YDFcsglL1XWMDJ3f4Cjn6qIEMHPSrN4HBOLxog5kifrBoYjmmhhgfX73C8DyXKRwXGwxA=="
  }),
  capabilities: Object.freeze([...KILO_PACK_SCHEMA.capabilities]),
  permissions: Object.freeze([...KILO_PACK_SCHEMA.permissions]),
  executable_sha256: null,
  schema_sha256: schemaSha256,
  sbom: Object.freeze({ format: "spdx-json", generated_at_install: true }),
  health_probe: Object.freeze({ type: "command", args: ["--version"] }),
  rollback: Object.freeze({ strategy: "content-addressed-previous" }),
  locality: "local",
  cost: "zero",
  default_enabled: false
});

function component(status, { blocking = false, replacement = null, detail = null } = {}) {
  return { status, release_blocking: blocking, replacement, detail };
}

export function assessKiloBackend(input = {}) {
  const commands = input.commands || {};
  const bundled = input.bundled_kilo || {};
  const endpoints = input.endpoints || {};
  const integrations = input.integrations || {};
  const indexing = input.indexing || {};
  const blockers = [];
  const required = [];

  let kiloCli;
  if (commands.kilo?.present) {
    kiloCli = component("PROVEN", { detail: commands.kilo.version || null });
  } else if (bundled.present && bundled.path && /^[a-f0-9]{64}$/i.test(bundled.sha256 || "")) {
    kiloCli = component("REPLACED", { replacement: "bundled-rc25-cli", detail: bundled.path });
  } else {
    kiloCli = component("MISSING", { blocking: true, replacement: "kilo-backend-capability-pack" });
    blockers.push({
      id: "KILO-BACKEND-CLI",
      summary: "Neither a PATH Kilo CLI nor the verified RC25 bundled CLI is available",
      replacement: "kilo-backend"
    });
    required.push("kilo.cli");
  }

  const ollamaOk = Boolean(commands.ollama?.present && endpoints.ollama?.ok);
  const lmStudioOk = Boolean(endpoints.lm_studio?.ok);
  const components = {
    node: component(commands.node?.present ? "PROVEN" : "MISSING", { blocking: !commands.node?.present }),
    bun: component(commands.bun?.present ? "PROVEN" : "NOT_SHIPPED"),
    kilo_cli: kiloCli,
    git: component(commands.git?.present ? "PROVEN" : "MISSING", { blocking: !commands.git?.present }),
    github_cli: component(commands.gh?.present ? "PROVEN" : "NOT_SHIPPED"),
    gitlab_cli: component(commands.glab?.present ? "PROVEN" : "NOT_SHIPPED"),
    docker: component(commands.docker?.engine_ready ? "PROVEN" : "NOT_SHIPPED", {
      detail: commands.docker?.present ? "client-present-engine-unavailable" : "not-installed"
    }),
    ollama: component(ollamaOk ? "PROVEN" : "NOT_SHIPPED", {
      detail: ollamaOk ? String(endpoints.ollama.model_count || 0) + " models" : null
    }),
    lm_studio: component(lmStudioOk ? "PROVEN" : "NOT_SHIPPED", {
      blocking: false,
      detail: !lmStudioOk && ollamaOk ? "optional-local-provider-because-ollama-is-ready" : null
    }),
    vector_indexing: component(indexing.lancedb_package || indexing.qdrant_package ? "PROVEN" : "NOT_SHIPPED"),
    hermesproof: component(integrations.hermesproof ? "PROVEN" : "MISSING", { blocking: !integrations.hermesproof }),
    serena: component(integrations.serena ? "PROVEN" : "MISSING", { blocking: !integrations.serena }),
    mcp_config: component(integrations.mcp_config ? "PROVEN" : "MISSING", { blocking: !integrations.mcp_config }),
    browser_runner: component(integrations.browser_runner ? "PROVEN" : "NOT_SHIPPED")
  };

  for (const [name, value] of Object.entries(components)) {
    if (value.release_blocking && name !== "kilo_cli") {
      blockers.push({
        id: "KILO-BACKEND-" + name.toUpperCase(),
        summary: name + " is required for the governed Kilo backend path"
      });
    }
  }
  if (!ollamaOk && !lmStudioOk) required.push("backend.local-model");
  if (!indexing.lancedb_package && !indexing.qdrant_package) required.push("backend.indexing");

  return {
    schema: "hermesproof.kilo-backend-report.v1",
    release: input.extension_version || null,
    ok: blockers.length === 0,
    release_blockers: blockers,
    required_capabilities: [...new Set(required)],
    components,
    policies: {
      mcp_default_enabled: false,
      global_package_install: false,
      tool_authority: "leased",
      docker_optional_until_workload_requires_containers: true,
      local_provider_fallback: "ollama-before-lm-studio"
    }
  };
}

async function defaultCommandProbe(name) {
  const specs = {
    node: [process.execPath, ["--version"]],
    bun: ["bun", ["--version"]],
    kilo: ["kilo", ["--version"]],
    git: ["git", ["--version"]],
    gh: ["gh", ["--version"]],
    glab: ["glab", ["--version"]],
    docker: ["docker", ["--version"]],
    ollama: ["ollama", ["--version"]]
  };
  const spec = specs[name];
  if (!spec) return { present: false };
  try {
    const result = await execFileAsync(spec[0], spec[1], {
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    });
    const value = String(result.stdout || result.stderr || "").trim().split(/\r?\n/u)[0];
    if (name !== "docker") return { present: true, version: value };
    let engineReady = false;
    try {
      await execFileAsync("docker", ["info", "--format", "{{json .ServerVersion}}"], {
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 1024 * 1024
      });
      engineReady = true;
    } catch {
      engineReady = false;
    }
    return { present: true, version: value, engine_ready: engineReady };
  } catch (error) {
    return {
      present: false,
      error_code: error?.code === "ENOENT" ? "NOT_FOUND" : "PROBE_FAILED"
    };
  }
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function defaultFileProbe(file) {
  if (!file) return { present: false };
  const basename = path.basename(file).toLowerCase();
  if (basename !== "kilo.exe" && basename !== "kilo") {
    throw new TypeError("bundled Kilo path must end in kilo.exe or kilo");
  }
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return { present: false };
    let version = null;
    try {
      const result = await execFileAsync(file, ["--version"], {
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      });
      version = String(result.stdout || result.stderr || "").trim().split(/\r?\n/u)[0] || null;
    } catch {
      version = null;
    }
    return {
      present: true,
      path: path.resolve(file),
      bytes: stat.size,
      sha256: await sha256File(file),
      version
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { present: false };
    throw error;
  }
}

function assertLoopback(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new TypeError("backend doctor endpoint probes are restricted to loopback HTTP");
  }
  return parsed;
}

async function defaultEndpointProbe(name) {
  const urls = {
    ollama: "http://127.0.0.1:11434/api/tags",
    lm_studio: "http://127.0.0.1:1234/v1/models"
  };
  const url = urls[name];
  if (!url) return { ok: false };
  assertLoopback(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  timer.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status };
    const payload = await response.json();
    const models = name === "ollama"
      ? (Array.isArray(payload.models) ? payload.models : [])
      : (Array.isArray(payload.data) ? payload.data : []);
    const names = models
      .map((model) => model.name || model.model || model.id)
      .filter((value) => typeof value === "string");
    return {
      ok: true,
      model_count: names.length,
      embedding_models: names.filter((value) => /bge|embed|mxbai|nomic/iu.test(value))
    };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeKiloBackend({
  extensionVersion = null,
  platform = process.platform,
  bundledKiloPath = null,
  commandProbe = defaultCommandProbe,
  fileProbe = defaultFileProbe,
  endpointProbe = defaultEndpointProbe,
  indexing = {},
  integrations = {}
} = {}) {
  if (typeof commandProbe !== "function" || typeof fileProbe !== "function" ||
      typeof endpointProbe !== "function") {
    throw new TypeError("Kilo backend probes must be functions");
  }
  const commandNames = ["node", "bun", "kilo", "git", "gh", "glab", "docker", "ollama"];
  const commandEntries = await Promise.all(
    commandNames.map(async (name) => [name, await commandProbe(name)])
  );
  const commands = Object.fromEntries(commandEntries);
  const [bundledKilo, ollama, lmStudio] = await Promise.all([
    fileProbe(bundledKiloPath),
    endpointProbe("ollama"),
    endpointProbe("lm_studio")
  ]);
  const inventory = {
    extension_version: extensionVersion,
    platform,
    commands,
    bundled_kilo: { path: bundledKiloPath, ...bundledKilo },
    endpoints: { ollama, lm_studio: lmStudio },
    indexing: { ...indexing },
    integrations: { ...integrations }
  };
  return {
    ...assessKiloBackend(inventory),
    inventory
  };
}

export function createKiloBackendInstallPlan({ report, workspaceRoot } = {}) {
  if (!report || typeof report !== "object") throw new TypeError("report is required");
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) throw new TypeError("workspaceRoot is required");
  const packIds = [];
  if (report.required_capabilities.includes("kilo.cli")) packIds.push("kilo-backend");
  if (report.required_capabilities.includes("backend.local-model")) packIds.push("local-model-runtime");
  if (report.required_capabilities.includes("backend.indexing")) packIds.push("vector-indexing");
  return {
    schema: "hermesproof.kilo-backend-install-plan.v1",
    workspace_root: workspaceRoot,
    pack_ids: packIds,
    global_install: false,
    enable_after_install: false,
    permissions: ["workspace:read", "process:child", "loopback:http"],
    health_probes: ["kilo --version", "kilo mcp list", "ollama list", "git --version", "hermesproof doctor --deep"],
    rollback: "disable lease, restore content-addressed previous pack, quarantine drift"
  };
}
