import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const SIGNATURE_SCHEMA = "hermesproof.release-signature.v1";
export const SIGNATURE_ALGORITHM = "Ed25519";

const ENVELOPE_KEYS = Object.freeze([
  "schema", "algorithm", "artifact", "sha256", "keyFingerprint", "signature"
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function asPublicKey(key) {
  if (key?.type === "public") return key;
  return crypto.createPublicKey(key);
}

function ensureEd25519(key, label) {
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(label + " must be an Ed25519 " + key.type + " key");
  }
}

function publicDer(key) {
  const publicKey = asPublicKey(key);
  ensureEd25519(publicKey, "release public key");
  return publicKey.export({ type: "spki", format: "der" });
}

export function publicKeyFingerprint(publicKey) {
  return "sha256:" + crypto.createHash("sha256").update(publicDer(publicKey)).digest("hex");
}

export function canonicalSignaturePayload(fields) {
  return Buffer.from([
    fields.schema,
    fields.algorithm,
    fields.artifact,
    fields.sha256,
    fields.keyFingerprint,
    ""
  ].join("\n"), "utf8");
}

async function requireRegularFile(file, label) {
  const resolved = path.resolve(file);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(label + " must be a regular file");
  }
  return resolved;
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(file, "r");
  try {
    for await (const chunk of handle.readableWebStream()) {
      hash.update(Buffer.from(chunk));
    }
  } finally {
    await handle.close().catch(() => {});
  }
  return hash.digest("hex");
}

async function atomicWrite(file, content) {
  const resolved = path.resolve(file);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const temporary = resolved + "." + process.pid + "." + crypto.randomUUID() + ".tmp";
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, resolved);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function sameKey(left, right) {
  const leftDer = publicDer(left);
  const rightDer = publicDer(right);
  return leftDer.length === rightDer.length && crypto.timingSafeEqual(leftDer, rightDer);
}

function strictEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === ENVELOPE_KEYS.length && ENVELOPE_KEYS.every((key) => keys.includes(key));
}

function decodeCanonicalBase64(value) {
  if (typeof value !== "string" || value.length === 0 || !BASE64_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

function failure(reason, detail) {
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

export async function signReleaseArtifact({
  artifactFile,
  checksumFile,
  signatureFile,
  privateKeyFile,
  publicKeyFile
}) {
  const artifact = await requireRegularFile(artifactFile, "release artifact");
  const privateFile = await requireRegularFile(privateKeyFile, "release private key");
  const publicFile = await requireRegularFile(publicKeyFile, "pinned release public key");
  const privateKey = crypto.createPrivateKey(await fs.readFile(privateFile));
  ensureEd25519(privateKey, "release private key");
  const pinnedPublicKey = crypto.createPublicKey(await fs.readFile(publicFile));
  ensureEd25519(pinnedPublicKey, "pinned release public key");
  const derivedPublicKey = crypto.createPublicKey(privateKey);
  if (!sameKey(derivedPublicKey, pinnedPublicKey)) {
    throw new Error("release private key does not match pinned public key");
  }

  const sha256 = await sha256File(artifact);
  const artifactName = path.basename(artifact);
  const keyFingerprint = publicKeyFingerprint(pinnedPublicKey);
  const fields = {
    schema: SIGNATURE_SCHEMA,
    algorithm: SIGNATURE_ALGORITHM,
    artifact: artifactName,
    sha256,
    keyFingerprint
  };
  const signature = crypto.sign(null, canonicalSignaturePayload(fields), privateKey).toString("base64");
  const envelope = { ...fields, signature };
  const resolvedChecksum = path.resolve(checksumFile || artifactFile + ".sha256");
  const resolvedSignature = path.resolve(signatureFile || artifactFile + ".sig");
  await atomicWrite(resolvedChecksum, sha256 + "  " + artifactName + "\n");
  await atomicWrite(resolvedSignature, JSON.stringify(envelope, null, 2) + "\n");
  return {
    ok: true,
    artifactFile: artifact,
    checksumFile: resolvedChecksum,
    signatureFile: resolvedSignature,
    sha256,
    keyFingerprint
  };
}

export async function verifyReleaseArtifact({
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
    artifact = await requireRegularFile(artifactFile, "release artifact");
    checksum = await requireRegularFile(checksumFile || artifactFile + ".sha256", "release checksum");
    signature = await requireRegularFile(signatureFile || artifactFile + ".sig", "release signature");
    publicFile = await requireRegularFile(publicKeyFile, "release public key");
  } catch (error) {
    return failure("input_invalid", error.message);
  }

  let checksumText;
  try {
    checksumText = await fs.readFile(checksum, "utf8");
  } catch (error) {
    return failure("checksum_invalid", error.message);
  }
  const checksumMatch = checksumText.match(/^([0-9a-f]{64}) {2}([^\r\n]+)\r?\n$/);
  if (!checksumMatch) return failure("checksum_invalid");
  const expectedDigest = checksumMatch[1];
  const expectedName = checksumMatch[2];
  if (expectedName !== path.basename(artifact)) return failure("checksum_artifact_mismatch");
  const actualDigest = await sha256File(artifact);
  if (actualDigest !== expectedDigest) return failure("artifact_digest_mismatch");

  let envelope;
  try {
    envelope = JSON.parse(await fs.readFile(signature, "utf8"));
  } catch {
    return failure("signature_envelope_invalid");
  }
  if (!strictEnvelope(envelope)) return failure("signature_envelope_invalid");
  if (envelope.schema !== SIGNATURE_SCHEMA || envelope.algorithm !== SIGNATURE_ALGORITHM) {
    return failure("signature_envelope_invalid");
  }
  if (envelope.artifact !== path.basename(artifact)) return failure("signature_artifact_mismatch");
  if (!SHA256_PATTERN.test(envelope.sha256) || envelope.sha256 !== actualDigest) {
    return failure("signature_digest_mismatch");
  }
  if (!FINGERPRINT_PATTERN.test(envelope.keyFingerprint)) return failure("signature_envelope_invalid");
  const signatureBytes = decodeCanonicalBase64(envelope.signature);
  if (!signatureBytes) return failure("signature_envelope_invalid");

  let publicKey;
  try {
    publicKey = crypto.createPublicKey(await fs.readFile(publicFile));
    ensureEd25519(publicKey, "release public key");
  } catch (error) {
    return failure("public_key_invalid", error.message);
  }
  const keyFingerprint = publicKeyFingerprint(publicKey);
  if (keyFingerprint !== envelope.keyFingerprint) return failure("key_fingerprint_mismatch");
  const valid = crypto.verify(null, canonicalSignaturePayload(envelope), publicKey, signatureBytes);
  if (!valid) return failure("signature_invalid");
  return {
    ok: true,
    artifactFile: artifact,
    checksumFile: checksum,
    signatureFile: signature,
    sha256: actualDigest,
    keyFingerprint,
    schema: SIGNATURE_SCHEMA,
    algorithm: SIGNATURE_ALGORITHM
  };
}
