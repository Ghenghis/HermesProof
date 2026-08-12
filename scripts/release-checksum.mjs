#!/usr/bin/env node
/**
 * release-checksum — gate `release.checksums_present` (cryptographic).
 *
 * Walks the release directories (`dist/`, `release/`) and asserts that
 * every "release artifact" has BOTH a `.sha256` sidecar and a signature
 * sidecar in the same directory.
 *
 * Definition of "release artifact":
 *   - Regular file (not a sidecar itself; not hidden; not `.gitkeep`).
 *   - Extension is in the artifact set: .tar, .tgz, .gz, .zip, .tar.gz,
 *     .tar.xz, .whl, .jar, .deb, .rpm, .exe, .msi, .dmg, .AppImage, .nupkg.
 *
 * Definition of valid signature:
 *   - Sidecar file `<artifact>.sig` (raw signature) OR
 *   - `<artifact>.cosign.bundle` (cosign keyless / Sigstore bundle) OR
 *   - `<artifact>.asc` (OpenPGP detached signature).
 *
 * Detached Ed25519 signatures are verified against the pinned HermesProof
 * public key. The gate emits ok:true when no release artifacts exist so it
 * remains dormant during development.
 *
 * Output: structured evidence; CLI emits one PASS/FAIL line.
 *
 * Usage:
 *   node scripts/release-checksum.mjs
 *   node scripts/release-checksum.mjs --dirs dist,release,build
 *   node scripts/release-checksum.mjs --json
 */

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import crypto from "node:crypto";
import { verifyReleaseArtifact } from "../src/core/release-signing.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// ---------------------------------------------------------------------------
// Argv
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dirs") out.dirs = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--root") out.root = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--verify-sha256") out.verifySha256 = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/release-checksum.mjs [options]

Options:
  --dirs <list>         Comma-separated relative dirs to scan (default: dist,release)
  --root <path>         Repo root override (default: parent of scripts/)
  --verify-sha256       Recompute SHA-256 explicitly (Ed25519 verification is always enabled)
  --json                JSON only output
  --help                Show this help`);
  process.exit(0);
}

const ROOT = args.root ? path.resolve(args.root) : repoRoot;
const SCAN_DIRS = args.dirs && args.dirs.length ? args.dirs : ["dist", "release"];

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------
export const ARTIFACT_EXTENSIONS = Object.freeze([
  ".tar.gz", ".tar.xz", ".tar", ".tgz", ".gz",
  ".zip", ".whl", ".jar", ".deb", ".rpm",
  ".exe", ".msi", ".dmg", ".AppImage", ".nupkg"
]);

const SIDECAR_EXTENSIONS = Object.freeze([
  ".sha256", ".sha256sum", ".sig", ".asc",
  ".cosign.bundle", ".cosign.sig", ".pem", ".cert"
]);

export function isArtifactName(name) {
  if (!name || name.startsWith(".")) return false;
  if (name === ".gitkeep" || name === ".gitignore") return false;
  // sidecar?
  for (const ext of SIDECAR_EXTENSIONS) {
    if (name.toLowerCase().endsWith(ext.toLowerCase())) return false;
  }
  // matches at least one artifact ext?
  return ARTIFACT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase()));
}

export function classifyArtifact({ name, files }) {
  // `files` is a Set of names in the same directory (string match).
  const checksumNames = [`${name}.sha256`, `${name}.sha256sum`];
  const signatureNames = [
    `${name}.sig`, `${name}.asc`,
    `${name}.cosign.bundle`, `${name}.cosign.sig`
  ];
  const checksumSidecar = checksumNames.find((n) => files.has(n)) || null;
  const signatureSidecar = signatureNames.find((n) => files.has(n)) || null;
  const missing = [];
  if (!checksumSidecar) missing.push("sha256");
  if (!signatureSidecar) missing.push("signature");
  return {
    name,
    checksum_sidecar: checksumSidecar,
    signature_sidecar: signatureSidecar,
    ok: missing.length === 0,
    missing
  };
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------
async function dirExists(p) {
  try { const s = await fs.stat(p); return s.isDirectory(); } catch { return false; }
}

async function listFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch { return []; }
}

async function sha256OfFile(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function readShaSidecar(filePath) {
  // Sidecars are typically `<hex64>  <name>` or just `<hex64>`.
  const raw = (await fs.readFile(filePath, "utf8")).trim();
  const m = raw.match(/^([0-9a-fA-F]{64})/);
  return m ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Gate runner
// ---------------------------------------------------------------------------
export async function runReleaseChecksumGate({
  root = ROOT,
  scanDirs = SCAN_DIRS,
  verifySha256 = false,
  verifySignatures = true,
  publicKeyFile = path.join(root, "config", "hermesproof-release-ed25519-public.pem")
} = {}) {
  const scanned = [];
  const artifacts = [];
  const sha_mismatches = [];
  const signature_mismatches = [];

  for (const rel of scanDirs) {
    const abs = path.join(root, rel);
    if (!(await dirExists(abs))) {
      scanned.push({ dir: rel, exists: false, artifact_count: 0 });
      continue;
    }
    const files = await listFiles(abs);
    const fileSet = new Set(files);
    let count = 0;
    for (const name of files) {
      if (!isArtifactName(name)) continue;
      count++;
      const verdict = classifyArtifact({ name, files: fileSet });
      verdict.dir = rel;
      verdict.path = path.join(rel, name).replace(/\\/g, "/");
      artifacts.push(verdict);
      if (verifySha256 && verdict.checksum_sidecar) {
        const expected = await readShaSidecar(path.join(abs, verdict.checksum_sidecar));
        const actual = await sha256OfFile(path.join(abs, name));
        if (!expected) {
          sha_mismatches.push({ path: verdict.path, expected: null, actual, reason: "checksum_invalid" });
        } else if (expected !== actual) {
          sha_mismatches.push({ path: verdict.path, expected, actual, reason: "checksum_mismatch" });
        }
        verdict.sha256_match = expected === actual;
      }
      if (verifySignatures && verdict.signature_sidecar) {
        if (!verdict.signature_sidecar.endsWith(".sig")) {
          verdict.signature_verified = false;
          verdict.signature_reason = "unsupported_signature_format";
          signature_mismatches.push({
            path: verdict.path,
            signature: verdict.signature_sidecar,
            reason: verdict.signature_reason
          });
        } else {
          const verification = await verifyReleaseArtifact({
            artifactFile: path.join(abs, name),
            checksumFile: verdict.checksum_sidecar
              ? path.join(abs, verdict.checksum_sidecar)
              : path.join(abs, name + ".sha256"),
            signatureFile: path.join(abs, verdict.signature_sidecar),
            publicKeyFile
          });
          verdict.signature_verified = verification.ok === true;
          if (verification.ok) {
            verdict.key_fingerprint = verification.keyFingerprint;
            verdict.verified_sha256 = verification.sha256;
          } else {
            verdict.signature_reason = verification.reason;
            signature_mismatches.push({
              path: verdict.path,
              signature: verdict.signature_sidecar,
              reason: verification.reason
            });
          }
        }
      }
    }
    scanned.push({ dir: rel, exists: true, artifact_count: count });
  }

  const noArtifacts = artifacts.length === 0;
  const failing = artifacts.filter((a) => !a.ok);
  const ok = noArtifacts || (
    failing.length === 0 &&
    sha_mismatches.length === 0 &&
    signature_mismatches.length === 0
  );

  let details;
  if (noArtifacts) {
    details = `no release artifacts in ${scanDirs.join(",")}; gate dormant`;
  } else if (failing.length || sha_mismatches.length || signature_mismatches.length) {
    details =
      `${artifacts.length} artifact(s); ` +
      `missing_sidecar=${failing.length}, sha_mismatch=${sha_mismatches.length}, ` +
      `signature_mismatch=${signature_mismatches.length}`;
  } else {
    details = verifySignatures
      ? `${artifacts.length} artifact(s) have verified sha256+Ed25519 signatures`
      : `${artifacts.length} artifact(s) all have sha256+signature sidecars`;
  }

  return {
    ok,
    evidence: {
      root,
      scanned,
      verify_sha256: verifySha256,
      verify_signatures: verifySignatures,
      artifact_extensions: ARTIFACT_EXTENSIONS,
      artifacts,
      failing,
      sha_mismatches,
      signature_mismatches
    },
    details
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && url.pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const result = await runReleaseChecksumGate({
    root: ROOT,
    scanDirs: SCAN_DIRS,
    verifySha256: !!args.verifySha256
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
  } else {
    console.log(`[${result.ok ? "PASS" : "FAIL"}] release.checksums_present -- ${result.details}`);
    if (!result.ok) {
      for (const f of result.evidence.failing) {
        console.log(`  - ${f.path}: missing ${f.missing.join(",")}`);
      }
      for (const m of result.evidence.sha_mismatches) {
        const expected = m.expected ? m.expected.slice(0, 12) + ".." : "invalid";
        console.log(`  - sha256 mismatch: ${m.path} expected=${expected} actual=${m.actual.slice(0, 12)}.. reason=${m.reason}`);
      }
      for (const m of result.evidence.signature_mismatches) {
        console.log(`  - signature mismatch: ${m.path} reason=${m.reason}`);
      }
    }
  }
  process.exit(result.ok ? 0 : 1);
}
