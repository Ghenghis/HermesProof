#!/usr/bin/env node
/**
 * Hand-rolled CycloneDX SBOM emitter.
 *
 * Walks `node_modules/*` and `node_modules/@scope/*` looking for installed
 * packages, then emits a minimal CycloneDX 1.5 JSON document at
 * `PROOF/sbom.json`. Pure node stdlib; zero new runtime deps. Designed to
 * be fixture-injectable for unit tests:
 *
 *   - generateSbom({ root, pkg, components, now, serialNumber }) -> string
 *     Pure: builds the SBOM JSON from explicit inputs (no fs).
 *
 *   - collectInstalledComponents(repoRoot) -> Promise<Component[]>
 *     Live adapter: walks `node_modules/` and harvests
 *     `{ name, version, license }` from each package.json found.
 *
 *   - writeSbomToProof(repoRoot) -> Promise<{ ok, path, components, sha256 }>
 *     End-to-end: collect + generate + atomic write to PROOF/sbom.json.
 *
 * Output schema follows CycloneDX 1.5 (https://cyclonedx.org/docs/1.5/json/).
 * Each component carries:
 *   { type: "library", name, version, purl, scope, licenses?, hashes? }
 *
 * Hash discipline: components include a sha256 of the package's package.json
 * (not the whole tarball — we don't have the tarball locally). This is enough
 * to detect post-install tampering of declared metadata, which is the
 * realistic threat model on a checked-out CI runner.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const SBOM_SPEC_VERSION = "1.5";
const TOOL_NAME = "hermesproof-sbom-generator";
const TOOL_VERSION = "1.0.0";

/**
 * Build a CycloneDX 1.5 JSON SBOM string from explicit inputs (pure).
 *
 * @param {object} args
 * @param {object} args.pkg          parsed root package.json (name + version)
 * @param {Array}  args.components   harvested components
 * @param {Date}   [args.now]        timestamp (default new Date())
 * @param {string} [args.serialNumber] override (default: random urn:uuid)
 * @returns {string} JSON-stringified SBOM (pretty-printed for diff stability)
 */
export function generateSbom({ pkg, components, now = new Date(), serialNumber }) {
  const sn = serialNumber || `urn:uuid:${crypto.randomUUID()}`;
  const rootPurl = pkg?.name && pkg?.version
    ? `pkg:npm/${encodeURIComponent(pkg.name)}@${encodeURIComponent(pkg.version)}`
    : undefined;

  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: SBOM_SPEC_VERSION,
    serialNumber: sn,
    version: 1,
    metadata: {
      timestamp: now.toISOString(),
      tools: [
        {
          vendor: "HermesProof",
          name: TOOL_NAME,
          version: TOOL_VERSION
        }
      ],
      component: rootPurl
        ? {
            type: "application",
            name: pkg.name,
            version: pkg.version,
            purl: rootPurl
          }
        : { type: "application", name: pkg?.name || "unknown" }
    },
    components: components
      .slice()
      .sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version))
      .map((c) => buildComponent(c))
  };

  // Pretty-printed for stable diffs across runs.
  return JSON.stringify(sbom, null, 2) + "\n";
}

function buildComponent({ name, version, license, sha256 }) {
  const out = {
    type: "library",
    name,
    version: version || "",
    purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version || "")}`,
    scope: "required"
  };
  if (license) {
    // CycloneDX licenses can be { id } (SPDX) or { name } (free-form).
    // We try SPDX-id-shape first; consumers can re-validate downstream.
    out.licenses = Array.isArray(license)
      ? license.map((l) => normalizeLicense(l))
      : [normalizeLicense(license)];
  }
  if (sha256) {
    out.hashes = [{ alg: "SHA-256", content: sha256 }];
  }
  return out;
}

function normalizeLicense(raw) {
  if (!raw) return { license: { name: "UNKNOWN" } };
  if (typeof raw === "string") {
    // Heuristic: SPDX ids are token-ish (no spaces), longer free-form
    // text comes through as `name`.
    if (/^[A-Za-z0-9._+\-()/ ]{1,80}$/.test(raw) && !/\s{2,}/.test(raw)) {
      return { license: { id: raw } };
    }
    return { license: { name: raw } };
  }
  if (typeof raw === "object" && raw.type) {
    return { license: { id: String(raw.type) } };
  }
  return { license: { name: String(raw) } };
}

/**
 * Walk `node_modules/` and harvest installed components.
 *
 * Handles both flat (`node_modules/<pkg>`) and scoped
 * (`node_modules/@scope/<pkg>`) layouts. Skips hidden dirs (.bin, .package-lock.json).
 * Tolerates missing/malformed package.json by skipping the entry rather than
 * failing the whole walk.
 *
 * @param {string} repoRoot
 * @returns {Promise<Array<{ name: string, version: string, license?: string, sha256?: string }>>}
 */
export async function collectInstalledComponents(repoRoot) {
  const nm = path.join(repoRoot, "node_modules");
  const components = [];
  let topEntries;
  try {
    topEntries = await fs.readdir(nm, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  for (const e of topEntries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    if (e.name.startsWith("@")) {
      // Scoped: read inner dir
      let inner;
      try {
        inner = await fs.readdir(path.join(nm, e.name), { withFileTypes: true });
      } catch { continue; }
      for (const i of inner) {
        if (!i.isDirectory() || i.name.startsWith(".")) continue;
        const c = await readPackageDir(path.join(nm, e.name, i.name));
        if (c) components.push(c);
      }
    } else {
      const c = await readPackageDir(path.join(nm, e.name));
      if (c) components.push(c);
    }
  }
  return components;
}

async function readPackageDir(dir) {
  const pjPath = path.join(dir, "package.json");
  let raw;
  try {
    raw = await fs.readFile(pjPath, "utf8");
  } catch { return null; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return null; }
  if (!parsed.name || typeof parsed.name !== "string") return null;
  const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
  return {
    name: parsed.name,
    version: parsed.version || "",
    license: parsed.license || (parsed.licenses ? parsed.licenses : undefined),
    sha256
  };
}

/**
 * Live entry-point used by the truth-gate harness. Generates an SBOM and
 * writes it atomically to `<repoRoot>/PROOF/sbom.json`. Returns a small
 * receipt suitable for embedding in PROOF/latest.json.
 *
 * @param {string} repoRoot
 * @returns {Promise<{ ok: boolean, path: string, components: number,
 *                     sha256: string, serialNumber: string,
 *                     reason?: string }>}
 */
export async function writeSbomToProof(repoRoot, { now } = {}) {
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  } catch (err) {
    return { ok: false, reason: `cannot read root package.json: ${err.message}` };
  }
  let components;
  try {
    components = await collectInstalledComponents(repoRoot);
  } catch (err) {
    return { ok: false, reason: `node_modules walk failed: ${err.message}` };
  }
  const sbomText = generateSbom({ pkg, components, now: now || new Date() });
  const proofDir = path.join(repoRoot, "PROOF");
  await fs.mkdir(proofDir, { recursive: true });
  const target = path.join(proofDir, "sbom.json");
  // Atomic write: stage a tmp file then rename.
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, sbomText, "utf8");
  await fs.rename(tmp, target);
  const sha256 = crypto.createHash("sha256").update(sbomText).digest("hex");
  // Pull the serialNumber back out so the gate evidence can pin it.
  let serialNumber = "";
  try { serialNumber = JSON.parse(sbomText).serialNumber; } catch {}
  return {
    ok: true,
    path: target.replace(/\\/g, "/"),
    components: components.length,
    sha256,
    serialNumber
  };
}

// CLI entry: `node scripts/sbom-generator.mjs [--root <path>]`
import url from "node:url";
const isCli = (() => {
  try { return import.meta.url === url.pathToFileURL(process.argv[1]).href; }
  catch { return false; }
})();
if (isCli) {
  const argv = process.argv.slice(2);
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--root" || argv[i] === "-r") && argv[i + 1]) root = path.resolve(argv[++i]);
  }
  const out = await writeSbomToProof(root);
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  process.exit(out.ok ? 0 : 1);
}
