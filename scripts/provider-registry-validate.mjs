#!/usr/bin/env node
/**
 * Provider-registry validator gates.
 *
 * Pure-stdlib (no new runtime deps). Exposes pure gate functions for
 * unit tests *and* a CLI entrypoint (`node scripts/provider-registry-validate.mjs`)
 * that the truth-gate harness drives. Each gate returns the canonical record
 * shape:
 *
 *   { ok: bool, evidence: object, details: string, findings?: object[] }
 *
 * Implements 4 of the 7 provider-registry gates:
 *   - provider.registry.validate
 *   - local.models.catalog.validate
 *   - continue.llm_classes.validate
 *   - kilocode.provider.mapping.validate (stub: not_applicable until mapping CSV ships)
 *
 * Health probes (lmstudio.health, ollama.health) live in
 * scripts/local-providers-health.mjs.
 *
 * The secret.scan gate is implemented inline in scripts/truth-gates.mjs so it
 * can hook the existing repo-walk plumbing.
 */
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const REGISTRY_DIR_DEFAULT = path.join(repoRoot, "policies", "provider-registry");

// ---------------------------------------------------------------------------
// Tiny YAML subset parser — sufficient for the well-formed registry pack.
// Handles:
//   - top-level scalar key: value
//   - nested mappings (2-space indent)
//   - sequences of mappings ("- key: value")
// Does NOT handle: anchors, flow style, multi-line scalars, JSON-style.
// ---------------------------------------------------------------------------
export function parseYamlSubset(src) {
  const lines = src.split(/\r?\n/);
  const root = {};
  // stack[i] = { container, indent, keyForList }
  const stack = [{ container: root, indent: -1, parentKey: null }];

  function setOnTop(key, value) {
    const top = stack[stack.length - 1];
    if (Array.isArray(top.container)) {
      const last = top.container[top.container.length - 1];
      if (last && typeof last === "object") last[key] = value;
      else top.container.push({ [key]: value });
    } else {
      top.container[key] = value;
    }
  }

  function popTo(indent) {
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
  }

  function parseScalar(raw) {
    if (raw === undefined || raw === null) return null;
    let s = raw.trim();
    if (s === "") return "";
    if (s === "null" || s === "~") return null;
    if (s === "true") return true;
    if (s === "false") return false;
    // quoted strings
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
      return s.slice(1, -1);
    }
    if (/^-?\d+$/.test(s)) return Number(s);
    if (/^-?\d+\.\d+$/.test(s)) return Number(s);
    return s;
  }

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const rawLine = lines[lineNo];
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    // strip trailing comments only when not inside quotes
    const stripped = rawLine.replace(/\s+#.*$/, "");
    const indent = stripped.match(/^ */)[0].length;
    const content = stripped.slice(indent);

    popTo(indent);
    const top = stack[stack.length - 1];

    if (content.startsWith("- ")) {
      // sequence item
      // ensure top container is a list under previous key
      if (!Array.isArray(top.container)) {
        // this should not happen if YAML is well-formed; treat parent as list
        throw new Error(`unexpected sequence item at line ${lineNo + 1}: ${rawLine}`);
      }
      const itemBody = content.slice(2);
      const colonIdx = findColon(itemBody);
      if (colonIdx === -1) {
        // plain scalar item
        top.container.push(parseScalar(itemBody));
      } else {
        const key = itemBody.slice(0, colonIdx).trim();
        const valuePart = itemBody.slice(colonIdx + 1);
        const obj = {};
        top.container.push(obj);
        if (valuePart.trim() === "") {
          // dict item with nested children (handled by subsequent lines)
          stack.push({ container: obj, indent, parentKey: null });
        } else {
          obj[key] = parseScalar(valuePart);
          stack.push({ container: obj, indent, parentKey: null });
        }
      }
    } else {
      const colonIdx = findColon(content);
      if (colonIdx === -1) {
        throw new Error(`expected mapping at line ${lineNo + 1}: ${rawLine}`);
      }
      const key = content.slice(0, colonIdx).trim();
      const valuePart = content.slice(colonIdx + 1);
      if (valuePart.trim() === "") {
        // could be a nested map or sequence; peek next non-blank line
        let nextIndent = null;
        let nextIsSeq = false;
        for (let p = lineNo + 1; p < lines.length; p++) {
          const ln = lines[p];
          if (!ln.trim() || ln.trim().startsWith("#")) continue;
          nextIndent = ln.match(/^ */)[0].length;
          nextIsSeq = ln.slice(nextIndent).startsWith("- ");
          break;
        }
        // YAML allows sequences at the same indent as the parent key
        // ("continue_llm_classes:\n- class: …"), so we accept >= indent.
        if (nextIndent !== null && nextIndent >= indent && nextIsSeq) {
          const list = [];
          setOnTop(key, list);
          // Push the list-frame at indent - 1 (parent's indent semantics) so
          // that sibling sequence items at `nextIndent` don't pop the list
          // frame; only a key/sequence at <= parent indent ends the list.
          stack.push({ container: list, indent: indent - 1, parentKey: key, _listIndent: nextIndent });
        } else {
          const child = {};
          setOnTop(key, child);
          stack.push({ container: child, indent, parentKey: key });
        }
      } else {
        setOnTop(key, parseScalar(valuePart));
      }
    }
  }

  return root;
}

function findColon(text) {
  // Returns index of first ":" outside single/double quotes, or -1.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === ":" && !inSingle && !inDouble) {
      // require space or EOL after colon for mapping syntax
      if (i + 1 >= text.length || text[i + 1] === " " || text[i + 1] === "\t") return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Tiny CSV parser — first row is header, no embedded commas in quoted fields
// per pack discipline. Embedded-comma rows are *skipped with a finding* rather
// than crashing the parse.
// ---------------------------------------------------------------------------
export function parseCsv(src) {
  const lines = src.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { header: [], rows: [], skipped: [] };
  const header = lines[0].split(",").map((s) => s.trim());
  const rows = [];
  const skipped = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Strip a single quoted field that contains commas? Per pack discipline,
    // skip rows that contain quotes (we don't promise full CSV semantics).
    if (line.includes('"')) {
      skipped.push({ line_no: i + 1, reason: "quoted field present", raw: line });
      continue;
    }
    const cells = line.split(",");
    if (cells.length !== header.length) {
      skipped.push({
        line_no: i + 1,
        reason: `column count ${cells.length} != header ${header.length}`,
        raw: line
      });
      continue;
    }
    const row = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = cells[c];
    rows.push(row);
  }
  return { header, rows, skipped };
}

// ---------------------------------------------------------------------------
// Gate: provider.registry.validate
// ---------------------------------------------------------------------------
export async function runProviderRegistryValidate({ registryDir = REGISTRY_DIR_DEFAULT } = {}) {
  const findings = [];
  const evidence = { registry_path: path.join(registryDir, "registry.yaml") };
  let raw;
  try {
    raw = await fs.readFile(evidence.registry_path, "utf8");
  } catch (err) {
    return {
      ok: false,
      evidence: { ...evidence, error: err.code || err.message },
      details: `registry.yaml not readable: ${err.message}`,
      findings: [{ kind: "missing", path: evidence.registry_path }]
    };
  }
  evidence.registry_bytes = Buffer.byteLength(raw, "utf8");

  let parsed;
  try {
    parsed = parseYamlSubset(raw);
  } catch (err) {
    return {
      ok: false,
      evidence,
      details: `YAML parse failure: ${err.message}`,
      findings: [{ kind: "parse_error", message: err.message }]
    };
  }

  if (parsed.schema !== "hermes.provider_completeness.v1") {
    findings.push({ kind: "schema_mismatch", got: parsed.schema, want: "hermes.provider_completeness.v1" });
  }

  const classes = Array.isArray(parsed.continue_llm_classes) ? parsed.continue_llm_classes : [];
  evidence.class_count = classes.length;

  const seen = new Map();
  for (let i = 0; i < classes.length; i++) {
    const e = classes[i] || {};
    for (const required of ["class", "provider_name", "source_path"]) {
      if (!e[required] || (typeof e[required] === "string" && e[required].trim() === "")) {
        findings.push({
          kind: "missing_field",
          index: i,
          field: required,
          entry: e
        });
      }
    }
    const pn = e.provider_name;
    if (typeof pn === "string" && pn.length > 0) {
      if (seen.has(pn)) {
        findings.push({
          kind: "duplicate_provider_name",
          provider_name: pn,
          first_index: seen.get(pn),
          duplicate_index: i
        });
      } else {
        seen.set(pn, i);
      }
    }
  }

  evidence.unique_provider_names = seen.size;
  const ok = findings.length === 0;
  return {
    ok,
    evidence,
    details: ok
      ? `${classes.length} entries, ${seen.size} unique provider_names`
      : `${findings.length} finding(s)`,
    findings
  };
}

// ---------------------------------------------------------------------------
// Gate: local.models.catalog.validate
// ---------------------------------------------------------------------------
const LMS_REQUIRED_COLS = ["device", "arch", "params", "publisher", "model_id", "quant", "size", "modified"];

export async function runLocalModelsCatalogValidate({ registryDir = REGISTRY_DIR_DEFAULT } = {}) {
  const csvPath = path.join(registryDir, "lmstudio_local_models.csv");
  const evidence = { csv_path: csvPath };
  let raw;
  try {
    raw = await fs.readFile(csvPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      evidence: { ...evidence, error: err.code || err.message },
      details: `lmstudio_local_models.csv not readable: ${err.message}`,
      findings: [{ kind: "missing" }]
    };
  }
  evidence.csv_bytes = Buffer.byteLength(raw, "utf8");

  const parsed = parseCsv(raw);
  const findings = [];

  for (const col of LMS_REQUIRED_COLS) {
    if (!parsed.header.includes(col)) {
      findings.push({ kind: "missing_column", column: col });
    }
  }

  evidence.row_count = parsed.rows.length;
  evidence.skipped_rows = parsed.skipped.length;
  for (const sk of parsed.skipped) {
    findings.push({ kind: "skipped_row", ...sk });
  }

  // Basic per-row hygiene: model_id must be non-empty.
  let invalid = 0;
  for (let i = 0; i < parsed.rows.length; i++) {
    const r = parsed.rows[i];
    if (!r.model_id || r.model_id.trim() === "") {
      findings.push({ kind: "empty_model_id", row_no: i + 2 });
      invalid++;
    }
  }
  evidence.invalid_row_count = invalid;

  const headerOk = LMS_REQUIRED_COLS.every((c) => parsed.header.includes(c));
  // Skipped rows + empty model_ids are warnings within the gate, but the
  // gate fails only when the header itself is wrong (schema breakage).
  const ok = headerOk;
  return {
    ok,
    evidence,
    details: ok
      ? `header ok; ${parsed.rows.length} valid rows, ${parsed.skipped.length} skipped`
      : `header missing required columns`,
    findings
  };
}

// ---------------------------------------------------------------------------
// Gate: continue.llm_classes.validate
//
// The 62 known provider names from the pack at v0.1. Future additions are
// fine; this gate fails only if any of these names disappear.
// ---------------------------------------------------------------------------
export const EXPECTED_CONTINUE_PROVIDER_NAMES = Object.freeze([
  "anthropic", "cohere", "cometapi", "function-network", "gemini",
  "llamafile", "moonshot", "ollama", "replicate", "text-gen-webui",
  "together", "novita", "huggingface-tgi", "huggingface-tei",
  "huggingface-inference-api", "kindo", "llama.cpp", "openai", "ovhcloud",
  "lemonade", "lmstudio", "mistral", "mimo", "minimax", "bedrock",
  "bedrockimport", "sagemaker", "deepinfra", "flowise", "groq", "fireworks",
  "ncompass", "continue-proxy", "cloudflare", "deepseek", "docker", "msty",
  "azure", "watsonx", "openrouter", "clawrouter", "nvidia", "vllm",
  "sambanova", "mock", "test", "cerebras", "askSage", "nebius", "nous",
  "venice", "vertexai", "xAI", "siliconflow", "tensorix", "scaleway",
  "relace", "inception", "voyage", "llamastack", "tars", "zAI"
]);

export async function runContinueLlmClassesValidate({ registryDir = REGISTRY_DIR_DEFAULT } = {}) {
  const csvPath = path.join(registryDir, "continue_llm_classes.csv");
  const evidence = { csv_path: csvPath, expected_count: EXPECTED_CONTINUE_PROVIDER_NAMES.length };
  let raw;
  try {
    raw = await fs.readFile(csvPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      evidence: { ...evidence, error: err.code || err.message },
      details: `continue_llm_classes.csv not readable: ${err.message}`,
      findings: [{ kind: "missing" }]
    };
  }
  evidence.csv_bytes = Buffer.byteLength(raw, "utf8");

  const parsed = parseCsv(raw);
  const got = new Set(parsed.rows.map((r) => r.provider_name).filter(Boolean));
  const missing = EXPECTED_CONTINUE_PROVIDER_NAMES.filter((n) => !got.has(n));
  evidence.row_count = parsed.rows.length;
  evidence.unique_provider_names = got.size;
  evidence.missing = missing;

  const findings = missing.map((n) => ({ kind: "missing_expected_provider", provider_name: n }));
  for (const sk of parsed.skipped) {
    findings.push({ kind: "skipped_row", ...sk });
  }

  const ok = missing.length === 0;
  return {
    ok,
    evidence,
    details: ok
      ? `all ${EXPECTED_CONTINUE_PROVIDER_NAMES.length} expected provider names present (${got.size} total)`
      : `missing ${missing.length}: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "..." : ""}`,
    findings
  };
}

// ---------------------------------------------------------------------------
// Gate: kilocode.provider.mapping.validate
// Stub — returns status: not_applicable until kilocode_mapping.csv ships.
// ---------------------------------------------------------------------------
export async function runKilocodeProviderMappingValidate({ registryDir = REGISTRY_DIR_DEFAULT } = {}) {
  const csvPath = path.join(registryDir, "kilocode_mapping.csv");
  let exists = false;
  try {
    await fs.access(csvPath);
    exists = true;
  } catch { /* expected */ }
  return {
    ok: true,
    status: "not_applicable",
    evidence: { csv_path: csvPath, present: exists, schema: "hermes.kilocode_mapping.v1" },
    details: exists
      ? "kilocode_mapping.csv present (validation logic stub)"
      : "kilocode_mapping.csv not in pack — gate stub running as not_applicable",
    findings: []
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const which = args[0] || "all";
  const registryDir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : REGISTRY_DIR_DEFAULT;
  const out = {};
  if (which === "all" || which === "registry") {
    out["provider.registry.validate"] = await runProviderRegistryValidate({ registryDir });
  }
  if (which === "all" || which === "models") {
    out["local.models.catalog.validate"] = await runLocalModelsCatalogValidate({ registryDir });
  }
  if (which === "all" || which === "classes") {
    out["continue.llm_classes.validate"] = await runContinueLlmClassesValidate({ registryDir });
  }
  if (which === "all" || which === "kilocode") {
    out["kilocode.provider.mapping.validate"] = await runKilocodeProviderMappingValidate({ registryDir });
  }
  console.log(JSON.stringify(out, null, 2));
  const failed = Object.values(out).filter((r) => r.ok === false);
  process.exit(failed.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("provider-registry-validate.mjs")) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(2);
  });
}
