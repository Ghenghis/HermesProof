import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SCHEMA = "hermesproof.client-config-snapshot.v1";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalAbsolute(value, field) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(field + " must be absolute");
  return path.resolve(value);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

async function readMaybe(file) {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp-" + crypto.randomUUID();
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  await fs.rename(temporary, file);
}

export async function createClientConfigSnapshot({
  files,
  backupRoot,
  now = new Date()
} = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("files must be a non-empty array");
  const root = canonicalAbsolute(backupRoot, "backupRoot");
  const canonicalFiles = [...new Set(files.map((file) => canonicalAbsolute(file, "file")))];
  const id = now.toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomUUID().slice(0, 8);
  const directory = path.join(root, id);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(directory, { recursive: false });
  const entries = [];
  for (let index = 0; index < canonicalFiles.length; index += 1) {
    const file = canonicalFiles[index];
    const before = await readMaybe(file);
    const backupFile = before ? path.join(directory, String(index).padStart(3, "0") + "-" + path.basename(file)) : null;
    if (before) await fs.writeFile(backupFile, before, { flag: "wx" });
    entries.push({
      file,
      existedBefore: Boolean(before),
      beforeSha256: before ? sha256(before) : null,
      backupFile,
      afterSha256: null
    });
  }
  const manifestFile = path.join(directory, "manifest.json");
  const manifest = {
    schema: SCHEMA,
    id,
    createdUtc: now.toISOString(),
    finalized: false,
    entries
  };
  await writeJsonAtomic(manifestFile, manifest);
  return { ok: true, id, directory, manifestFile, entries };
}

async function readManifest(manifestFile, expectedSha256 = null) {
  const file = canonicalAbsolute(manifestFile, "manifestFile");
  const raw = await fs.readFile(file);
  if (expectedSha256 !== null && (!/^[a-f0-9]{64}$/i.test(expectedSha256) || sha256(raw) !== expectedSha256)) {
    throw new Error("snapshot manifest hash mismatch");
  }
  const manifest = JSON.parse(raw.toString("utf8"));
  if (manifest?.schema !== SCHEMA || !Array.isArray(manifest.entries)) throw new Error("snapshot manifest is invalid");
  const directory = path.dirname(file);
  for (const entry of manifest.entries) {
    canonicalAbsolute(entry.file, "manifest entry file");
    if (entry.backupFile && !isInside(directory, path.resolve(entry.backupFile))) {
      throw new Error("snapshot backup escapes its directory");
    }
  }
  return { file, manifest };
}

export async function finalizeClientConfigSnapshot({ manifestFile } = {}) {
  const { file, manifest } = await readManifest(manifestFile);
  for (const entry of manifest.entries) {
    const after = await readMaybe(entry.file);
    entry.afterSha256 = after ? sha256(after) : null;
  }
  manifest.finalized = true;
  manifest.finalizedUtc = new Date().toISOString();
  await writeJsonAtomic(file, manifest);
  return { ok: true, manifestFile: file, manifestSha256: sha256(await fs.readFile(file)), entries: manifest.entries };
}

export async function restoreClientConfigSnapshot({
  manifestFile,
  manifestSha256,
  allowedFiles,
  force = false
} = {}) {
  if (!/^[a-f0-9]{64}$/i.test(manifestSha256 || "")) throw new Error("snapshot manifest SHA-256 is required");
  const { file, manifest } = await readManifest(manifestFile, manifestSha256);
  if (!manifest.finalized) throw new Error("snapshot must be finalized before restore");
  const allow = new Set((allowedFiles || []).map((value) => canonicalAbsolute(value, "allowed file")));
  for (const entry of manifest.entries) {
    if (!allow.has(path.resolve(entry.file))) throw new Error(entry.file + " is not explicitly allowed");
    const current = await readMaybe(entry.file);
    const currentSha = current ? sha256(current) : null;
    if (!force && currentSha !== entry.afterSha256) {
      throw new Error(entry.file + " changed after installation; refusing rollback");
    }
  }
  for (const entry of manifest.entries) {
    if (entry.existedBefore) {
      const backup = await fs.readFile(entry.backupFile);
      if (sha256(backup) !== entry.beforeSha256) throw new Error("snapshot backup hash mismatch");
      await fs.mkdir(path.dirname(entry.file), { recursive: true });
      const temporary = entry.file + ".restore-" + crypto.randomUUID();
      await fs.writeFile(temporary, backup, { flag: "wx" });
      await fs.rename(temporary, entry.file);
    } else {
      await fs.rm(entry.file, { force: true });
    }
  }
  manifest.restoredUtc = new Date().toISOString();
  await writeJsonAtomic(file, manifest);
  return { ok: true, manifestFile: file, restored: manifest.entries.map((entry) => entry.file) };
}
