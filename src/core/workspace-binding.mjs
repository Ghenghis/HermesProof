import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TOKEN_SCHEMA = "hermesproof.workspace-binding/v1";
const SECRET_BYTES = 32;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeText(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    throw new WorkspaceBindingError("INVALID_INPUT", field + " must be a string");
  }
  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0) {
    throw new WorkspaceBindingError("INVALID_INPUT", field + " must not be empty");
  }
  return normalized;
}

function safeEqualText(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left)).digest();
  const rightDigest = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

async function gitValue(workspaceRoot, args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", workspaceRoot, ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim();
  } catch (error) {
    if (allowFailure) {
      return "";
    }
    throw new WorkspaceBindingError(
      "WORKSPACE_FINGERPRINT_FAILED",
      "Unable to fingerprint Git workspace",
      { cause: error?.message ?? String(error) }
    );
  }
}

export class WorkspaceBindingError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "WorkspaceBindingError";
    this.code = code;
    this.details = details;
  }
}

export async function fingerprintWorkspace(workspaceRoot) {
  const canonicalRoot = await realpath(path.resolve(normalizeText(workspaceRoot, "workspaceRoot")));
  const insideWorkTree = await gitValue(canonicalRoot, ["rev-parse", "--is-inside-work-tree"], {
    allowFailure: true
  });

  if (insideWorkTree !== "true") {
    return {
      canonical_root: canonicalRoot,
      workspace_root_hash: sha256(canonicalRoot),
      git_common_dir_hash: null,
      branch: null,
      head: null,
      remotes_digest: sha256("")
    };
  }

  const [gitCommonDir, branch, head, remotes] = await Promise.all([
    gitValue(canonicalRoot, ["rev-parse", "--git-common-dir"]),
    gitValue(canonicalRoot, ["branch", "--show-current"], { allowFailure: true }),
    gitValue(canonicalRoot, ["rev-parse", "HEAD"]),
    gitValue(canonicalRoot, ["remote", "-v"], { allowFailure: true })
  ]);
  const resolvedGitCommonDir = path.resolve(canonicalRoot, gitCommonDir);

  return {
    canonical_root: canonicalRoot,
    workspace_root_hash: sha256(canonicalRoot),
    git_common_dir_hash: sha256(resolvedGitCommonDir),
    branch: branch || null,
    head,
    remotes_digest: sha256(
      remotes
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .sort()
        .join("\n")
    )
  };
}

export async function loadOrCreateWorkspaceBindingSecret(stateDir) {
  const normalizedStateDir = path.resolve(normalizeText(stateDir, "stateDir"));
  const secretsDir = path.join(normalizedStateDir, "secrets");
  const secretFile = path.join(secretsDir, "workspace-binding.key");
  await mkdir(secretsDir, { recursive: true });

  async function readSecret() {
    const encoded = (await readFile(secretFile, "utf8")).trim();
    const secret = Buffer.from(encoded, "base64url");
    if (secret.length !== SECRET_BYTES) {
      throw new WorkspaceBindingError(
        "INVALID_SECRET",
        "Persisted workspace binding secret has an invalid length"
      );
    }
    return secret;
  }

  try {
    return await readSecret();
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const generated = crypto.randomBytes(SECRET_BYTES);
  let handle;
  try {
    handle = await open(secretFile, "wx", 0o600);
    await handle.writeFile(generated.toString("base64url") + "\n", "utf8");
    await handle.sync();
    return generated;
  } catch (error) {
    if (error?.code === "EEXIST") {
      return readSecret();
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export class WorkspaceBindingManager {
  constructor({
    secret,
    now = Date.now,
    nonceFactory = crypto.randomUUID,
    fingerprintWorkspace: fingerprint = fingerprintWorkspace
  } = {}) {
    const normalizedSecret = Buffer.isBuffer(secret) ? Buffer.from(secret) : Buffer.from(secret ?? "");
    if (normalizedSecret.length < SECRET_BYTES) {
      throw new WorkspaceBindingError(
        "INVALID_SECRET",
        "Workspace binding secret must contain at least 32 bytes"
      );
    }
    if (typeof now !== "function" || typeof nonceFactory !== "function" || typeof fingerprint !== "function") {
      throw new WorkspaceBindingError("INVALID_INPUT", "Binding manager dependencies must be functions");
    }
    this.secret = normalizedSecret;
    this.now = now;
    this.nonceFactory = nonceFactory;
    this.fingerprintWorkspace = fingerprint;
  }

  async bind({ workspaceRoot, principal, policyDigest = "", ttlMs = 5 * 60 * 1000 } = {}) {
    const normalizedPrincipal = normalizeText(principal, "principal");
    const normalizedPolicyDigest = normalizeText(policyDigest, "policyDigest", { allowEmpty: true });
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
      throw new WorkspaceBindingError(
        "INVALID_TTL",
        "ttlMs must be a positive integer no greater than 24 hours"
      );
    }

    const fingerprint = await this.fingerprintWorkspace(workspaceRoot);
    const issuedAtMs = this.now();
    const payload = {
      schema: TOKEN_SCHEMA,
      handle_id: normalizeText(this.nonceFactory(), "handle_id"),
      workspace_root_hash: fingerprint.workspace_root_hash,
      git_common_dir_hash: fingerprint.git_common_dir_hash,
      branch: fingerprint.branch,
      head: fingerprint.head,
      remotes_digest: fingerprint.remotes_digest,
      principal: normalizedPrincipal,
      policy_digest: normalizedPolicyDigest,
      issued_at_ms: issuedAtMs,
      expires_at_ms: issuedAtMs + ttlMs
    };
    const encodedPayload = encodeJson(payload);
    const signature = crypto
      .createHmac("sha256", this.secret)
      .update(encodedPayload)
      .digest("base64url");

    return {
      token: encodedPayload + "." + signature,
      handle_id: payload.handle_id,
      workspace_root: fingerprint.canonical_root,
      issued_at_ms: payload.issued_at_ms,
      expires_at_ms: payload.expires_at_ms
    };
  }

  async verify({ token, workspaceRoot, principal, policyDigest = "" } = {}) {
    if (typeof token !== "string") {
      throw new WorkspaceBindingError("MALFORMED_TOKEN", "Workspace binding token must be a string");
    }
    const segments = token.split(".");
    if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
      throw new WorkspaceBindingError("MALFORMED_TOKEN", "Workspace binding token is malformed");
    }

    const [encodedPayload, encodedSignature] = segments;
    const expectedSignature = crypto
      .createHmac("sha256", this.secret)
      .update(encodedPayload)
      .digest();
    let suppliedSignature;
    try {
      suppliedSignature = Buffer.from(encodedSignature, "base64url");
    } catch {
      throw new WorkspaceBindingError("INVALID_SIGNATURE", "Workspace binding signature is invalid");
    }
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      throw new WorkspaceBindingError("INVALID_SIGNATURE", "Workspace binding signature is invalid");
    }

    let payload;
    try {
      payload = decodeJson(encodedPayload);
    } catch {
      throw new WorkspaceBindingError("MALFORMED_TOKEN", "Workspace binding payload is invalid");
    }
    if (payload?.schema !== TOKEN_SCHEMA) {
      throw new WorkspaceBindingError("MALFORMED_TOKEN", "Workspace binding schema is unsupported");
    }
    if (!Number.isSafeInteger(payload.expires_at_ms) || this.now() >= payload.expires_at_ms) {
      throw new WorkspaceBindingError("EXPIRED_TOKEN", "Workspace binding token has expired");
    }

    const expectedPrincipal = normalizeText(principal, "principal");
    if (!safeEqualText(payload.principal, expectedPrincipal)) {
      throw new WorkspaceBindingError("PRINCIPAL_MISMATCH", "Workspace binding principal does not match");
    }
    const expectedPolicyDigest = normalizeText(policyDigest, "policyDigest", { allowEmpty: true });
    if (!safeEqualText(payload.policy_digest, expectedPolicyDigest)) {
      throw new WorkspaceBindingError("POLICY_MISMATCH", "Workspace binding policy does not match");
    }

    const fingerprint = await this.fingerprintWorkspace(workspaceRoot);
    if (!safeEqualText(payload.workspace_root_hash, fingerprint.workspace_root_hash)) {
      throw new WorkspaceBindingError("WORKSPACE_MISMATCH", "Workspace binding targets another workspace");
    }
    const driftFields = [
      "git_common_dir_hash",
      "branch",
      "head",
      "remotes_digest"
    ];
    const drifted = driftFields.filter((field) => !safeEqualText(payload[field], fingerprint[field]));
    if (drifted.length > 0) {
      throw new WorkspaceBindingError(
        "WORKSPACE_DRIFT",
        "Workspace identity changed after the binding was issued",
        { fields: drifted }
      );
    }

    return {
      handle_id: payload.handle_id,
      workspace_root: fingerprint.canonical_root,
      principal: payload.principal,
      policy_digest: payload.policy_digest,
      issued_at_ms: payload.issued_at_ms,
      expires_at_ms: payload.expires_at_ms,
      fingerprint: {
        workspace_root_hash: payload.workspace_root_hash,
        git_common_dir_hash: payload.git_common_dir_hash,
        branch: payload.branch,
        head: payload.head,
        remotes_digest: payload.remotes_digest
      }
    };
  }
}
