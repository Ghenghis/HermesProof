#!/usr/bin/env node
/**
 * Health-probe gates for LM Studio + Ollama (local providers).
 *
 * Both probes are WARN-on-offline: the gate level is "warn", so a missing
 * local server does not fail CI. This is intentional — local providers are
 * developer-machine-only, so they cannot be required to be up everywhere.
 *
 * Env overrides:
 *   LMSTUDIO_BASE_URL  default: http://localhost:1234/v1/models
 *   OLLAMA_BASE_URL    default: http://localhost:11434/api/tags
 *   PROVIDER_HEALTH_TIMEOUT_MS  default: 5000
 */
import http from "node:http";
import https from "node:https";
import url from "node:url";

export const LMSTUDIO_DEFAULT = "http://localhost:1234/v1/models";
export const OLLAMA_DEFAULT = "http://localhost:11434/api/tags";

function getTimeoutMs() {
  const n = Number(process.env.PROVIDER_HEALTH_TIMEOUT_MS || "5000");
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

export function probeUrl(target, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new url.URL(target);
    } catch (err) {
      resolve({ ok: false, status: 0, error: `bad_url: ${err.message}`, target });
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method: "GET",
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs
      },
      (res) => {
        // drain the body but bound it
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 * 64) res.destroy();
        });
        res.on("end", () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            target,
            bytes_read: bytes
          });
        });
        res.on("error", (err) => resolve({ ok: false, status: 0, error: err.message, target }));
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => {
      resolve({ ok: false, status: 0, error: err.code || err.message, target });
    });
    req.end();
  });
}

/** Returns gate-record for lmstudio.health.  WARN on offline. */
export async function runLmstudioHealth({
  baseUrl = process.env.LMSTUDIO_BASE_URL || LMSTUDIO_DEFAULT,
  timeoutMs = getTimeoutMs()
} = {}) {
  const probe = await probeUrl(baseUrl, { timeoutMs });
  return {
    ok: probe.ok,
    level: probe.ok ? "warn" : "warn", // always warn-level — failing is not blocking
    evidence: { base_url: baseUrl, ...probe, timeout_ms: timeoutMs },
    details: probe.ok
      ? `LM Studio reachable (${probe.status})`
      : `LM Studio offline: ${probe.error || `HTTP ${probe.status}`}`
  };
}

/** Returns gate-record for ollama.health.  WARN on offline. */
export async function runOllamaHealth({
  baseUrl = process.env.OLLAMA_BASE_URL || OLLAMA_DEFAULT,
  timeoutMs = getTimeoutMs()
} = {}) {
  const probe = await probeUrl(baseUrl, { timeoutMs });
  return {
    ok: probe.ok,
    level: probe.ok ? "warn" : "warn",
    evidence: { base_url: baseUrl, ...probe, timeout_ms: timeoutMs },
    details: probe.ok
      ? `Ollama reachable (${probe.status})`
      : `Ollama offline: ${probe.error || `HTTP ${probe.status}`}`
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const which = process.argv[2] || "both";
  const out = {};
  if (which === "both" || which === "lmstudio") {
    out["lmstudio.health"] = await runLmstudioHealth();
  }
  if (which === "both" || which === "ollama") {
    out["ollama.health"] = await runOllamaHealth();
  }
  console.log(JSON.stringify(out, null, 2));
  // Health probes never fail the process; they always exit 0.
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("local-providers-health.mjs")) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(2);
  });
}
