import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const ARCHIVE_PLAN_SCHEMA = "hermesproof.archive-plan.v1";
const ARCHIVE_PLAN_CONTRACT_VERSION = "hermesproof.archive-plan.2026-07-10";
const MANIFEST_SCHEMA = "hermesproof.expected-diff-manifest.v2";
const CLASSES = new Set(["KEEP_DOC_TRUTH", "KEEP_TEST_PROOF", "KEEP_RECOVERY_FIX"]);

function text(value) {
  return String(value ?? "").trim();
}

function hash(value) {
  return /^[a-f0-9]{64}$/i.test(text(value));
}

function relative(value) {
  const item = text(value).replaceAll("\\", "/");
  if (!item || path.isAbsolute(item) || item.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return item;
}

function inside(value, root) {
  const file = path.resolve(value);
  const base = path.resolve(root);
  return file === base || file.startsWith(`${base}${path.sep}`);
}

function archiveId(value) {
  const item = text(value);
  return /^[a-z0-9][a-z0-9._-]{2,79}$/i.test(item) ? item : null;
}

async function digest(file) {
  const sum = createHash("sha256");
  for await (const chunk of createReadStream(file)) sum.update(chunk);
  return sum.digest("hex");
}

async function entry(source, item, id) {
  const name = relative(item?.path);
  if (!name || !hash(item?.sha256) || !CLASSES.has(text(item?.classification))) {
    return { ok: false, finding: `entry_invalid:${text(item?.path) || "unknown"}` };
  }
  const file = path.resolve(source, name);
  if (!inside(file, source)) return { ok: false, finding: `entry_outside_source:${name}` };
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return { ok: false, finding: `entry_not_file:${name}` };
    const actual = await digest(file);
    if (actual !== text(item.sha256).toLowerCase()) return { ok: false, finding: `entry_hash_mismatch:${name}` };
    return {
      ok: true,
      entry: {
        sourceRelativePath: name,
        archiveRelativePath: `${id}/${name}`,
        sha256: actual,
        bytes: stat.size,
        classification: text(item.classification),
        status: text(item.status),
      },
    };
  } catch (err) {
    return { ok: false, finding: `entry_unavailable:${name}:${err.code || "unknown"}` };
  }
}

export async function evaluateArchivePlan(input = {}) {
  const source = path.resolve(text(input.sourceRoot));
  const target = path.resolve(text(input.archiveRoot));
  const allowedSourceRoots = Array.isArray(input.allowedSourceRoots) ? input.allowedSourceRoots.map(text).filter(Boolean).map((item) => path.resolve(item)) : [];
  const allowedArchiveRoots = Array.isArray(input.allowedArchiveRoots) ? input.allowedArchiveRoots.map(text).filter(Boolean).map((item) => path.resolve(item)) : [];
  const manifest = input.manifest && typeof input.manifest === "object" ? input.manifest : {};
  const id = archiveId(input.archiveId);
  const findings = [];
  if (text(input.schema) !== ARCHIVE_PLAN_SCHEMA) findings.push("schema_invalid");
  if (text(input.contractVersion) !== ARCHIVE_PLAN_CONTRACT_VERSION) findings.push("contract_version_mismatch");
  if (!allowedSourceRoots.some((root) => inside(source, root))) findings.push("source_root_outside_allowlist");
  if (!allowedArchiveRoots.some((root) => inside(target, root))) findings.push("archive_root_outside_allowlist");
  if (source === target || inside(target, source)) findings.push("archive_root_must_be_separate");
  if (!id) findings.push("archive_id_invalid");
  if (text(manifest.schema) !== MANIFEST_SCHEMA) findings.push("manifest_schema_invalid");
  if (manifest.releaseClaimAllowed !== false) findings.push("manifest_release_claim_must_be_false");
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) findings.push("manifest_entries_missing");
  const entries = [];
  if (findings.length === 0) {
    for (const item of manifest.entries) {
      const result = await entry(source, item, id);
      if (!result.ok) {
        findings.push(result.finding);
        continue;
      }
      entries.push(result.entry);
    }
  }
  const verdict = findings.length === 0 ? "pass" : "blocked";
  return {
    ok: verdict === "pass",
    verdict,
    truth: verdict === "pass" ? "planned" : "insufficient",
    schema: ARCHIVE_PLAN_SCHEMA,
    contractVersion: ARCHIVE_PLAN_CONTRACT_VERSION,
    sourceRoot: source,
    archiveRoot: target,
    archiveId: id,
    manifestSchema: text(manifest.schema),
    entries,
    findings: [...new Set(findings)],
    execution: {
      proposed: verdict === "pass",
      movePerformed: false,
      deleteSourceAllowed: false,
      explicitHumanApprovalRequired: true,
    },
    safe_actions: [
      "No source or archive file was created, moved, copied, deleted, staged, committed, reset, cleaned, or overwritten.",
      "A later archive operator must re-verify every source hash immediately before an explicitly approved move.",
      "Source deletion is outside this contract and always requires a separate reviewed retention decision.",
    ],
    secret_values_returned: false,
  };
}

export { ARCHIVE_PLAN_CONTRACT_VERSION, ARCHIVE_PLAN_SCHEMA };
