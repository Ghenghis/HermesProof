import fs from "node:fs/promises";
import path from "node:path";

const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REF_RE = /^refs\/(?:heads|tags)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MANAGED_CHILDREN = ["state", "releases", "staging", "quarantine", "evidence", "backups", "logs"];

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isSameOrInside(candidate, parent) {
  const child = normalized(candidate);
  const base = normalized(parent);
  return child === base || child.startsWith(base + path.sep);
}

export function validateReleaseSha(value) {
  if (typeof value !== "string" || !SHA_RE.test(value)) {
    throw new Error("invalid release SHA");
  }
  return value;
}

export function validateGitRef(value) {
  if (
    typeof value !== "string" ||
    !REF_RE.test(value) ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.endsWith(".lock")
  ) {
    throw new Error("invalid Git ref");
  }
  return value;
}

async function rejectExistingLinks(managedRoot) {
  for (const candidate of [managedRoot, ...MANAGED_CHILDREN.map((name) => path.join(managedRoot, name))]) {
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) throw new Error("unsafe managed root contains a link or junction");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
}

export async function createUpdaterPathPolicy({
  managedRoot,
  homeDirectory,
  repositoryRoot
} = {}) {
  if (typeof managedRoot !== "string" || !path.isAbsolute(managedRoot)) {
    throw new Error("unsafe managed root: an absolute dedicated directory is required");
  }
  const root = path.resolve(managedRoot);
  const filesystemRoot = path.parse(root).root;
  const unsafe =
    normalized(root) === normalized(filesystemRoot) ||
    (homeDirectory && normalized(root) === normalized(homeDirectory)) ||
    (repositoryRoot && isSameOrInside(root, repositoryRoot));
  if (unsafe) throw new Error("unsafe managed root");

  await rejectExistingLinks(root);

  const assertContained = (candidate) => {
    const resolved = path.resolve(candidate);
    if (!isSameOrInside(resolved, root)) throw new Error("path is outside managed root");
    return resolved;
  };

  return Object.freeze({
    managedRoot: root,
    assertContained,
    releaseDirectory(sha) {
      return assertContained(path.join(root, "releases", validateReleaseSha(sha)));
    },
    stagingDirectory(name) {
      if (typeof name !== "string" || !/^[0-9a-f-]+$/.test(name)) throw new Error("invalid staging name");
      return assertContained(path.join(root, "staging", name));
    },
    quarantineDirectory(name) {
      if (typeof name !== "string" || !/^[0-9a-fT-Z-]+$/.test(name)) throw new Error("invalid quarantine name");
      return assertContained(path.join(root, "quarantine", name));
    }
  });
}
