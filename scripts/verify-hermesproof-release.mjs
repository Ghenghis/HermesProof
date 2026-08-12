#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = "hermesproof.release-signature.v1";
const ALGORITHM = "Ed25519";
const ENVELOPE_KEYS = Object.freeze([
  "schema", "algorithm", "artifact", "sha256", "keyFingerprint", "signature"
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function fail(reason, detail) {
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

async function regularFile(file, label) {
  const resolved = path.resolve(file);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(label + " must be a regular file");
  return resolved;
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(file, "r");
  try {
    for await (const chunk of handle.readableWebStream()) hash.update(Buffer.from(chunk));
  } finally {
    await handle.close().catch(() => {});
  }
  return hash.digest("hex");
}

function fingerprint(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return "sha256:" + crypto.createHash("sha256").update(der).digest("hex");
}

function payload(envelope) {
  return Buffer.from([
    envelope.schema,
    envelope.algorithm,
    envelope.artifact,
    envelope.sha256,
    envelope.keyFingerprint,
    ""
  ].join("\n"), "utf8");
}

function strictEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === ENVELOPE_KEYS.length && ENVELOPE_KEYS.every((key) => keys.includes(key));
}

function canonicalBase64(value) {
  if (typeof value !== "string" || !value || !BASE64_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

export async function verifyDownloadedRelease({
  artifactFile,
  checksumFile,
  signatureFile,
  publicKeyFile
}) {
  let artifact;
  let checksum;
  let signature;
  let publicFile;
  try {
    artifact = await regularFile(artifactFile, "release artifact");
    checksum = await regularFile(checksumFile || artifactFile + ".sha256", "release checksum");
    signature = await regularFile(signatureFile || artifactFile + ".sig", "release signature");
    publicFile = await regularFile(publicKeyFile, "release public key");
  } catch (error) {
    return fail("input_invalid", error.message);
  }

  const checksumText = await fs.readFile(checksum, "utf8").catch(() => null);
  const checksumMatch = checksumText?.match(/^([0-9a-f]{64}) {2}([^\r\n]+)\r?\n$/);
  if (!checksumMatch) return fail("checksum_invalid");
  if (checksumMatch[2] !== path.basename(artifact)) return fail("checksum_artifact_mismatch");
  const actualDigest = await sha256File(artifact);
  if (actualDigest !== checksumMatch[1]) return fail("artifact_digest_mismatch");

  let envelope;
  try {
    envelope = JSON.parse(await fs.readFile(signature, "utf8"));
  } catch {
    return fail("signature_envelope_invalid");
  }
  if (!strictEnvelope(envelope)) return fail("signature_envelope_invalid");
  if (envelope.schema !== SCHEMA || envelope.algorithm !== ALGORITHM) {
    return fail("signature_envelope_invalid");
  }
  if (envelope.artifact !== path.basename(artifact)) return fail("signature_artifact_mismatch");
  if (!SHA256_PATTERN.test(envelope.sha256) || envelope.sha256 !== actualDigest) {
    return fail("signature_digest_mismatch");
  }
  if (!FINGERPRINT_PATTERN.test(envelope.keyFingerprint)) return fail("signature_envelope_invalid");
  const signatureBytes = canonicalBase64(envelope.signature);
  if (!signatureBytes) return fail("signature_envelope_invalid");

  let publicKey;
  try {
    publicKey = crypto.createPublicKey(await fs.readFile(publicFile));
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("release public key must be Ed25519");
  } catch (error) {
    return fail("public_key_invalid", error.message);
  }
  const keyFingerprint = fingerprint(publicKey);
  if (keyFingerprint !== envelope.keyFingerprint) return fail("key_fingerprint_mismatch");
  if (!crypto.verify(null, payload(envelope), publicKey, signatureBytes)) {
    return fail("signature_invalid");
  }
  return {
    ok: true,
    artifactFile: artifact,
    checksumFile: checksum,
    signatureFile: signature,
    sha256: actualDigest,
    keyFingerprint,
    schema: SCHEMA,
    algorithm: ALGORITHM
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--artifact") options.artifactFile = argv[++index];
    else if (arg === "--checksum") options.checksumFile = argv[++index];
    else if (arg === "--signature") options.signatureFile = argv[++index];
    else if (arg === "--public-key") options.publicKeyFile = argv[++index];
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("unknown option: " + arg);
  }
  return options;
}

async function resolveCliDefaults(options) {
  const verifierDirectory = path.dirname(fileURLToPath(import.meta.url));
  if (!options.artifactFile) {
    const candidateDirectories = [
      verifierDirectory,
      path.resolve(verifierDirectory, "..", "dist")
    ];
    const artifacts = new Set();
    for (const directory of candidateDirectories) {
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (
          entry.isFile() &&
          /^HermesProof-.+-windows-x64\.zip$/i.test(entry.name) &&
          !entry.name.includes("UNSIGNED-DEVELOPMENT")
        ) {
          artifacts.add(path.resolve(directory, entry.name));
        }
      }
    }
    if (artifacts.size !== 1) {
      throw new Error(`expected exactly one signed HermesProof Windows ZIP, found ${artifacts.size}`);
    }
    options.artifactFile = [...artifacts][0];
  }

  if (!options.publicKeyFile) {
    const candidates = [
      path.join(verifierDirectory, "hermesproof-release-ed25519-public.pem"),
      path.resolve(verifierDirectory, "..", "config", "hermesproof-release-ed25519-public.pem")
    ];
    for (const candidate of candidates) {
      const stat = await fs.lstat(candidate).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink()) {
        options.publicKeyFile = candidate;
        break;
      }
    }
    if (!options.publicKeyFile) throw new Error("release public key was not found beside the verifier or in config");
  }
  return options;
}

function usage() {
  return [
    "Usage: node verify-hermesproof-release.mjs [--artifact <zip>] [options]",
    "",
    "Options:",
    "  --artifact <zip>     Default: exactly one signed HermesProof Windows ZIP beside the verifier or in ../dist",
    "  --checksum <file>    Default: <artifact>.sha256",
    "  --signature <file>   Default: <artifact>.sig",
    "  --public-key <file>  Default: hermesproof-release-ed25519-public.pem beside verifier",
    "  --json               Emit machine-readable JSON",
    "  --help               Show this help"
  ].join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(usage() + "\n");
    } else {
      await resolveCliDefaults(args);
      const result = await verifyDownloadedRelease(args);
      if (args.json) {
        process.stdout.write(JSON.stringify(result) + "\n");
      } else if (result.ok) {
        process.stdout.write("[PASS] HermesProof release verified\n");
        process.stdout.write("SHA-256: " + result.sha256 + "\n");
        process.stdout.write("Key: " + result.keyFingerprint + "\n");
      } else {
        process.stderr.write("[FAIL] HermesProof release rejected: " + result.reason + "\n");
      }
      if (!result.ok) process.exitCode = 1;
    }
  } catch (error) {
    const result = fail("usage_error", error.message);
    if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(result) + "\n");
    else process.stderr.write("[FAIL] " + error.message + "\n");
    process.exitCode = 1;
  }
}
