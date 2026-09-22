import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// A "release pointer" is a small, separately-signed statement of the form
// "SHA <x> is blessed for OTA auto-activation on channel <y>". It exists to
// close a real gap in the git-based managed updater (src/updater/git-source.mjs
// + managed-updater.mjs): today, resolving a channel to a commit SHA and that
// commit's own tests passing is the *entire* trust basis for auto-activating
// it. Anyone who can land a commit on the tracked branch (or intercept the
// git fetch despite HTTPS) can make their commit run its own test suite from
// inside its own untrusted checkout and pass. A release pointer requires a
// signature from the SAME offline Ed25519 key already used for the packaged
// release ZIP (src/core/release-signing.mjs, config/hermesproof-release-ed25519-public.pem)
// -- a key the candidate commit's own content can never influence, because it
// is read from the *running* instance's own trusted files, never from the
// untrusted staged candidate directory.
//
// Deliberately NOT committed into the repository the pointer describes: a
// pointer that names commit X cannot be part of commit X's own tree without a
// fixed-point problem (the commit's hash would change the moment the pointer
// is added, invalidating the very pointer). Instead this is local, out-of-band
// trust configuration -- conceptually the same role as SSH's authorized_keys
// or a manually-bootstrapped TUF root: the operator (holding the offline
// private key) explicitly blesses a SHA once they've decided it's safe to
// auto-activate, and every machine's release-pointer file is that machine's
// own copy of that decision, not part of the versioned source tree.

export const POINTER_SCHEMA = "hermesproof.release-pointer.v1";
export const POINTER_ALGORITHM = "Ed25519";

const ENVELOPE_KEYS = Object.freeze([
  "schema", "algorithm", "channel", "sha", "issuedUtc", "keyFingerprint", "signature"
]);
const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CHANNEL_PATTERN = /^[a-z][a-z0-9-]*$/;
const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function ensureEd25519(key, label) {
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(label + " must be an Ed25519 " + key.type + " key");
  }
}

function publicDer(key) {
  const publicKey = key?.type === "public" ? key : crypto.createPublicKey(key);
  ensureEd25519(publicKey, "release pointer public key");
  return publicKey.export({ type: "spki", format: "der" });
}

export function pointerKeyFingerprint(publicKey) {
  return "sha256:" + crypto.createHash("sha256").update(publicDer(publicKey)).digest("hex");
}

export function canonicalPointerPayload(fields) {
  return Buffer.from([
    fields.schema,
    fields.algorithm,
    fields.channel,
    fields.sha,
    fields.issuedUtc,
    fields.keyFingerprint,
    ""
  ].join("\n"), "utf8");
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

async function requireRegularFile(file, label) {
  const resolved = path.resolve(file);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(label + " must be a regular file");
  }
  return resolved;
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

function failure(reason, detail) {
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

/**
 * Signs a statement that `sha` is blessed for OTA auto-activation on
 * `channel`. Requires the SAME offline private key already used to sign
 * packaged releases (release-signing.mjs) -- there is deliberately no code
 * path that lets a candidate mint its own pointer.
 */
export async function signReleasePointer({
  sha,
  channel,
  privateKeyFile,
  publicKeyFile,
  pointerFile,
  clock = () => new Date()
}) {
  if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) throw new Error("invalid release SHA");
  if (typeof channel !== "string" || !CHANNEL_PATTERN.test(channel)) throw new Error("invalid update channel");
  const privateFile = await requireRegularFile(privateKeyFile, "release pointer private key");
  const publicFile = await requireRegularFile(publicKeyFile, "pinned release pointer public key");
  const privateKey = crypto.createPrivateKey(await fs.readFile(privateFile));
  ensureEd25519(privateKey, "release pointer private key");
  const pinnedPublicKey = crypto.createPublicKey(await fs.readFile(publicFile));
  ensureEd25519(pinnedPublicKey, "pinned release pointer public key");
  const derivedPublicKey = crypto.createPublicKey(privateKey);
  if (!sameKey(derivedPublicKey, pinnedPublicKey)) {
    throw new Error("release pointer private key does not match pinned public key");
  }

  const keyFingerprint = pointerKeyFingerprint(pinnedPublicKey);
  const fields = {
    schema: POINTER_SCHEMA,
    algorithm: POINTER_ALGORITHM,
    channel,
    sha,
    issuedUtc: clock().toISOString(),
    keyFingerprint
  };
  const signature = crypto.sign(null, canonicalPointerPayload(fields), privateKey).toString("base64");
  const envelope = { ...fields, signature };
  const resolvedPointer = path.resolve(pointerFile);
  await atomicWrite(resolvedPointer, JSON.stringify(envelope, null, 2) + "\n");
  return { ok: true, pointerFile: resolvedPointer, ...fields };
}

/**
 * Verifies that a pointer file blesses exactly `expectedSha` on
 * `expectedChannel`, signed by the key pinned at `publicKeyFile`.
 * `publicKeyFile` must be sourced from the RUNNING instance's own trusted
 * files (e.g. its own config/ directory), never from an untrusted candidate
 * checkout -- callers are responsible for that separation.
 */
export async function verifyReleasePointer({
  pointerFile,
  publicKeyFile,
  expectedSha,
  expectedChannel
}) {
  if (typeof expectedSha !== "string" || !SHA_PATTERN.test(expectedSha)) {
    return failure("input_invalid", "expectedSha is invalid");
  }
  if (typeof expectedChannel !== "string" || !CHANNEL_PATTERN.test(expectedChannel)) {
    return failure("input_invalid", "expectedChannel is invalid");
  }

  let pointer;
  let publicFile;
  try {
    pointer = await requireRegularFile(pointerFile, "release pointer");
    publicFile = await requireRegularFile(publicKeyFile, "release pointer public key");
  } catch (error) {
    return failure("pointer_missing", error.message);
  }

  let envelope;
  try {
    envelope = JSON.parse(await fs.readFile(pointer, "utf8"));
  } catch {
    return failure("pointer_invalid");
  }
  if (!strictEnvelope(envelope)) return failure("pointer_invalid");
  if (envelope.schema !== POINTER_SCHEMA || envelope.algorithm !== POINTER_ALGORITHM) {
    return failure("pointer_invalid");
  }
  if (!SHA_PATTERN.test(envelope.sha)) return failure("pointer_invalid");
  if (envelope.channel !== expectedChannel) return failure("channel_mismatch");
  if (envelope.sha !== expectedSha) return failure("sha_not_blessed");
  if (!FINGERPRINT_PATTERN.test(envelope.keyFingerprint)) return failure("pointer_invalid");
  const signatureBytes = decodeCanonicalBase64(envelope.signature);
  if (!signatureBytes) return failure("pointer_invalid");

  let publicKey;
  try {
    publicKey = crypto.createPublicKey(await fs.readFile(publicFile));
    ensureEd25519(publicKey, "release pointer public key");
  } catch (error) {
    return failure("public_key_invalid", error.message);
  }
  const keyFingerprint = pointerKeyFingerprint(publicKey);
  if (keyFingerprint !== envelope.keyFingerprint) return failure("key_fingerprint_mismatch");
  const valid = crypto.verify(null, canonicalPointerPayload(envelope), publicKey, signatureBytes);
  if (!valid) return failure("signature_invalid");
  return {
    ok: true,
    sha: envelope.sha,
    channel: envelope.channel,
    issuedUtc: envelope.issuedUtc,
    keyFingerprint
  };
}
