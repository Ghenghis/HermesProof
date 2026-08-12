import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const SERENA_CONTEXT_NAMES = Object.freeze([
  "devin",
  "kilocode",
  "lm-studio",
  "ollama",
  "windsurf"
]);

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function backupStamp(date) {
  return date.toISOString().replace(/[-:.]/gu, "");
}

function validateContext(name, content) {
  if (!SERENA_CONTEXT_NAMES.includes(name)) {
    throw new Error("Unrecognized Serena context: " + name);
  }
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Serena context is empty: " + name);
  }
  for (const marker of [
    "description:",
    "prompt:",
    "excluded_tools:",
    "included_optional_tools:",
    "- get_diagnostics_for_symbol",
    "tool_description_overrides:"
  ]) {
    if (!content.includes(marker)) {
      throw new Error("Serena context " + name + " is missing " + marker);
    }
  }
  if (/FIXME|PLACEHOLDER/iu.test(content)) {
    throw new Error("Serena context contains a placeholder: " + name);
  }
}

async function readIfPresent(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(file, content) {
  const temporary = file + ".tmp-" + process.pid + "-" + randomBytes(6).toString("hex");
  await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function installSerenaContexts({
  sourceDir,
  serenaHome,
  checkOnly = false,
  now = () => new Date()
} = {}) {
  if (!sourceDir) throw new TypeError("sourceDir is required");
  if (!serenaHome) throw new TypeError("serenaHome is required");
  if (typeof now !== "function") throw new TypeError("now must be a function");

  const resolvedSource = path.resolve(sourceDir);
  const resolvedHome = path.resolve(serenaHome);
  const destinationDir = path.join(resolvedHome, "contexts");
  if (!checkOnly) await fs.mkdir(destinationDir, { recursive: true });

  const installed = [];
  const repaired = [];
  const unchanged = [];
  const missing = [];
  const drifted = [];
  const contexts = [];

  for (const name of SERENA_CONTEXT_NAMES) {
    const sourceFile = path.join(resolvedSource, name + ".yml");
    const destinationFile = path.join(destinationDir, name + ".yml");
    const expected = await fs.readFile(sourceFile, "utf8");
    validateContext(name, expected);
    const expectedHash = sha256(expected);
    const current = await readIfPresent(destinationFile);
    const currentHash = current === null ? null : sha256(current);

    contexts.push({
      name,
      sha256: expectedHash,
      installed_sha256: currentHash,
      status: current === null ? "missing" : currentHash === expectedHash ? "unchanged" : "drifted"
    });

    if (currentHash === expectedHash) {
      unchanged.push(name);
      continue;
    }
    if (current === null) missing.push(name);
    else drifted.push(name);
    if (checkOnly) continue;

    if (current !== null) {
      const backup = destinationFile + ".bak-" + backupStamp(now());
      await fs.copyFile(destinationFile, backup, fs.constants.COPYFILE_EXCL);
      repaired.push(name);
    } else {
      installed.push(name);
    }
    await writeAtomic(destinationFile, expected);
  }

  return {
    ok: checkOnly ? missing.length === 0 && drifted.length === 0 : true,
    check_only: checkOnly,
    source_dir: resolvedSource,
    serena_home: resolvedHome,
    contexts,
    installed,
    repaired,
    unchanged,
    missing,
    drifted
  };
}
