#!/usr/bin/env node
/**
 * regenerate-provider-registry.mjs — refresh the LM-Studio local-models
 * catalog (and the count in registry.yaml) from the LIVE filesystem.
 *
 * Why this script exists
 * ----------------------
 * `policies/provider-registry/lmstudio_local_models.csv` was originally
 * extracted from a one-shot text dump and went stale: as of 2026-05-03 the
 * checked-in catalog listed 87 models, but the user's live `~/.lmstudio/models`
 * inventory had 309 model directories with 106 actually-downloaded `.gguf`
 * files. The 2026-05-03 audit (cross-confirmed by Claude × 5 + Codex × 5)
 * called this out as part of the "documentation drift" lane and is also
 * relevant to capability-dispatch routing (it picks providers from this list).
 *
 * What it does
 * ------------
 * Walks `<source>/<publisher>/<model_dir>/*.gguf`, derives the eight required
 * columns (device, arch, params, publisher, model_id, quant, size, modified),
 * and writes a deterministic CSV. Empty model directories (the model is
 * configured but the .gguf was never downloaded) are skipped — the catalog
 * reflects what is actually USABLE locally.
 *
 * Schema is identical to the existing CSV (`scripts/provider-registry-validate.mjs`
 * `LMS_REQUIRED_COLS`):
 *   device,arch,params,publisher,model_id,quant,size,modified
 *
 * The `modified` column matches the pre-existing "X days ago" / "today" format
 * for backward compatibility with downstream readers.
 *
 * Optionally updates `registry.yaml`'s `counts.lmstudio_local_models_extracted`
 * to reflect the new row count.
 *
 * Usage
 * -----
 *   node scripts/regenerate-provider-registry.mjs                     # default paths
 *   node scripts/regenerate-provider-registry.mjs --source <dir>      # override LM-Studio root
 *   node scripts/regenerate-provider-registry.mjs --output <file>     # override CSV path
 *   node scripts/regenerate-provider-registry.mjs --dry-run           # preview, don't write
 *   node scripts/regenerate-provider-registry.mjs --update-yaml-count # also bump count in registry.yaml
 *
 * Output is deterministic: rows sorted by (publisher, model_id, quant) so
 * re-running on unchanged input produces a byte-identical CSV.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DEFAULT_SOURCE = path.join(os.homedir(), ".lmstudio", "models");
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DEFAULT_CSV = path.join(REPO_ROOT, "policies", "provider-registry", "lmstudio_local_models.csv");
const DEFAULT_YAML = path.join(REPO_ROOT, "policies", "provider-registry", "registry.yaml");

const HEADER = ["device", "arch", "params", "publisher", "model_id", "quant", "size", "modified"];

// Quant patterns — most specific first; first match wins.
// `\b` is unreliable at the END because `_` is a word char in JS regex
// (so `MXFP4_MOE` would not match `\bMXFP\d+\b`). Use start-anchor only,
// plus rely on the most-specific-first order to avoid sub-match capture.
const QUANT_PATTERNS = [
  /\bIQ\d+(?:_[A-Z]+)*/i,              // IQ4_XS, IQ3_S, IQ2_XXS
  /\bQ\d+_K_[MSP]/i,                   // Q4_K_M, Q4_K_S, Q8_K_P
  /\bQ\d+_K/i,                         // Q4_K, Q6_K
  /\bQ\d+_\d+/i,                       // Q8_0, Q5_1
  /\bMXFP\d+/i,                        // MXFP4, MXFP8 (followed by _MOE etc)
  /\bQ\d+/i,                           // Q4, Q6 (least-specific Q variant, must come after _K)
  /\bBF\d{2}/i,                        // BF16
  /\b[Ff]\d{2}/,                       // F16, f16, F32
];

// Arch keywords — order matters (more specific first).
const ARCH_KEYWORDS = [
  "qwen3-vl", "qwen2-vl", "qwen3.5", "qwen3", "qwen2", "qwen",
  "llama-3.3", "llama3.1", "llama3", "llama-2", "llama",
  "glm-4.7", "glm-4.6", "glm-4.5", "glm-4", "glm",
  "gemma-3", "gemma-2", "gemma",
  "phi-3", "phi3", "phi-2", "phi",
  "deepseek-v3", "deepseek-r1", "deepseek-coder", "deepseek",
  "devstral", "ministral", "mixtral", "mistral",
  "gpt-oss",
  "mythomax",
  "dolphin",
  "command-r",
  "yi-",
  "embeddinggemma", "nomic-embed", "snowflake-arctic", "mxbai",
];

function parseArgs(argv) {
  const out = { source: DEFAULT_SOURCE, output: DEFAULT_CSV, yaml: DEFAULT_YAML, dryRun: false, updateYamlCount: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") out.source = argv[++i];
    else if (a === "--output") out.output = argv[++i];
    else if (a === "--yaml") out.yaml = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--update-yaml-count") out.updateYamlCount = true;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: node scripts/regenerate-provider-registry.mjs [--source DIR] [--output FILE] [--yaml FILE] [--dry-run] [--update-yaml-count]");
      process.exit(0);
    }
  }
  return out;
}

function extractQuant(filename) {
  for (const re of QUANT_PATTERNS) {
    const m = filename.match(re);
    if (m) return m[0].toUpperCase();
  }
  return "UNKNOWN";
}

function extractArch(pathSegment) {
  const lower = pathSegment.toLowerCase();
  for (const kw of ARCH_KEYWORDS) {
    if (lower.includes(kw)) {
      // Normalize: drop dashes and dots to get a stable arch token.
      return kw.replace(/[-.]/g, "");
    }
  }
  return "UNKNOWN";
}

function extractParams(pathSegment) {
  // Drop trailing \b — `_` is a word char so "0.8B_Abliterated" wouldn't match.
  // Require the suffix to be "B" or "M" followed by a non-letter (or end).
  const bMatch = pathSegment.match(/(\d+(?:\.\d+)?)[Bb](?=[^A-Za-z]|$)/);
  if (bMatch) return `${bMatch[1]}B`;
  const mMatch = pathSegment.match(/(\d+(?:\.\d+)?)[Mm](?=[^A-Za-z]|$)/);
  if (mMatch) return `${mMatch[1]}M`;
  return "UNKNOWN";
}

function formatSize(bytes) {
  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(0)} MB`;
  return `${bytes} B`;
}

function formatModified(mtimeMs, nowMs = Date.now()) {
  const ageMs = nowMs - mtimeMs;
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

async function* walkGgufFiles(sourceDir) {
  let publishers;
  try {
    publishers = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`source dir unreadable: ${sourceDir} (${err.code})`);
  }
  for (const pub of publishers) {
    if (!pub.isDirectory()) continue;
    const pubName = pub.name;
    const pubPath = path.join(sourceDir, pubName);
    let modelDirs;
    try {
      modelDirs = await fs.readdir(pubPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const md of modelDirs) {
      if (!md.isDirectory()) continue;
      const modelName = md.name;
      const modelPath = path.join(pubPath, modelName);
      let entries;
      try {
        entries = await fs.readdir(modelPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        if (!ent.name.endsWith(".gguf")) continue;
        // Skip mmproj-only sidecars; they accompany VL models but aren't
        // standalone routable models on their own.
        if (/^mmproj/i.test(ent.name)) continue;
        const filePath = path.join(modelPath, ent.name);
        const stat = await fs.stat(filePath);
        yield {
          publisher: pubName,
          modelDir: modelName,
          filename: ent.name,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      }
    }
  }
}

function rowFromFile(f) {
  const compositeContext = `${f.publisher}/${f.modelDir}/${f.filename}`;
  return {
    device: "LM Studio",
    arch: extractArch(compositeContext),
    params: extractParams(compositeContext),
    publisher: f.publisher,
    model_id: `${f.publisher}/${f.modelDir}`,
    quant: extractQuant(f.filename),
    size: formatSize(f.size),
    modified: formatModified(f.mtimeMs),
  };
}

function rowToCsv(row) {
  // No embedded commas in any of our fields; simple join is safe.
  // Validation: assert no commas snuck in (defensive — would corrupt the CSV).
  for (const col of HEADER) {
    if (typeof row[col] !== "string") throw new Error(`row missing/non-string ${col}: ${JSON.stringify(row)}`);
    if (row[col].includes(",")) throw new Error(`comma in field ${col}: ${row[col]}`);
    if (row[col].includes("\n")) throw new Error(`newline in field ${col}: ${row[col]}`);
  }
  return HEADER.map((c) => row[c]).join(",");
}

async function regenerate({ source, output, yaml, dryRun, updateYamlCount }) {
  const rows = [];
  for await (const file of walkGgufFiles(source)) {
    rows.push(rowFromFile(file));
  }

  // Deterministic order — re-running on unchanged input produces byte-identical output.
  rows.sort((a, b) => {
    if (a.publisher !== b.publisher) return a.publisher.localeCompare(b.publisher);
    if (a.model_id !== b.model_id) return a.model_id.localeCompare(b.model_id);
    return a.quant.localeCompare(b.quant);
  });

  const csv = [HEADER.join(","), ...rows.map(rowToCsv)].join("\n") + "\n";

  console.log(`source: ${source}`);
  console.log(`rows:   ${rows.length} (vs current CSV row count — see diff)`);
  console.log(`output: ${output}`);

  if (dryRun) {
    console.log("--- preview (first 5 rows) ---");
    console.log([HEADER.join(","), ...rows.slice(0, 5).map(rowToCsv)].join("\n"));
    console.log("--- (dry-run; no files written) ---");
    return { rowCount: rows.length };
  }

  await fs.writeFile(output, csv);
  console.log(`wrote ${output}`);

  if (updateYamlCount) {
    const yamlText = await fs.readFile(yaml, "utf8");
    const updated = yamlText.replace(
      /(lmstudio_local_models_extracted:\s*)\d+/,
      `$1${rows.length}`
    );
    if (updated === yamlText) {
      console.log(`(no change to ${yaml} — counts.lmstudio_local_models_extracted not found)`);
    } else {
      await fs.writeFile(yaml, updated);
      console.log(`updated ${yaml} count to ${rows.length}`);
    }
  }

  return { rowCount: rows.length };
}

// Allow import for testing without running.
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("regenerate-provider-registry.mjs")) {
  const args = parseArgs(process.argv.slice(2));
  regenerate(args).catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}

export { regenerate, rowFromFile, extractQuant, extractArch, extractParams, formatSize, formatModified, HEADER };
