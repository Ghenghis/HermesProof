/**
 * workflow-pinning gate — asserts every `uses:` line in
 * `.github/workflows/*.yml` (and `*.yaml`) is pinned to a full 40-char SHA.
 *
 * Rationale:
 *   GitHub Actions tags are mutable. CVE-2024-25638 (and the general OWASP
 *   guidance for hardening CI) call for SHA-pinning third-party actions so
 *   a compromised tag cannot silently swap in a malicious build. Pinning
 *   to a 40-char hex SHA is the only mechanism git/Actions provides that
 *   is content-addressed and immutable.
 *
 * Allowed `uses:` shapes:
 *   - `org/repo@<40-hex-sha>`           (pinned; comment with version preferred)
 *   - `./path/to/local-action`          (local workflow / composite action)
 *   - `./path/to/file.yml`              (reusable workflow, local)
 *   - `org/repo/path@<40-hex-sha>`      (sub-action with sub-path)
 *   - `docker://image@sha256:<hex>`     (docker action; sha256 digest also OK)
 *
 * Disallowed:
 *   - `org/repo@v1`, `@v4.2.2`, `@main`, `@latest`, `@<short-sha>` (anything
 *     that isn't 40 hex chars after the `@`).
 *
 * Pure-regex implementation; zero runtime deps.
 *
 * Exposed:
 *   listWorkflowFiles(repoRoot)      -> Promise<string[]>  (absolute paths)
 *   parseUsesFromWorkflow(yaml)      -> Array<{ raw, ref, lineno }>
 *   classifyUses(ref)                -> { ok, kind, reason?, fix? }
 *   runWorkflowPinningGate(opts)     -> { ok, evidence, details }
 */
import fs from "node:fs/promises";
import path from "node:path";

const SHA40_RE = /^[0-9a-f]{40}$/i;
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/i;

/**
 * Find every workflow file under `<repoRoot>/.github/workflows/`.
 * Returns absolute paths, sorted.
 */
export async function listWorkflowFiles(repoRoot) {
  const dir = path.join(repoRoot, ".github", "workflows");
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.ya?ml$/i.test(e.name)) continue;
    out.push(path.join(dir, e.name));
  }
  out.sort();
  return out;
}

/**
 * Pull every `uses:` reference out of a workflow YAML string.
 * Pure regex (we do not import a YAML parser to keep deps to zero) —
 * we deliberately accept any `uses:` line that is not in a comment.
 *
 * Returns: [{ raw: original full line trim, ref: thing-after-uses:, lineno: 1-based }]
 */
export function parseUsesFromWorkflow(yaml) {
  const lines = yaml.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(/^\s+/, "");
    if (stripped.startsWith("#")) continue;

    // Match "uses:" or "- uses:" optionally with quoting around the ref.
    // Accept ref ending at whitespace, comment marker, or end of line.
    const m = line.match(/(?:^|\s|-\s+)uses:\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/);
    if (!m) continue;
    out.push({ raw: stripped, ref: m[1], lineno: i + 1 });
  }
  return out;
}

/**
 * Classify a single `uses:` ref.
 *   - Local actions (./...) and reusable workflows are accepted as-is.
 *   - Docker actions (docker://image@sha256:...) require the sha256 digest.
 *   - GitHub-hosted actions (org/repo[/path]@ref) require ref to be 40 hex chars.
 *
 * Returns { ok, kind, reason?, fix? }.
 *   kind ∈ "local" | "docker" | "github" | "unknown"
 */
export function classifyUses(ref) {
  if (!ref || typeof ref !== "string") {
    return { ok: false, kind: "unknown", reason: "empty or non-string ref" };
  }
  if (ref.startsWith("./") || ref.startsWith("../")) {
    return { ok: true, kind: "local" };
  }
  if (ref.startsWith("docker://")) {
    const at = ref.lastIndexOf("@");
    if (at < 0) {
      return {
        ok: false,
        kind: "docker",
        reason: "docker:// ref missing @sha256:<digest>",
        fix: `${ref}@sha256:<64-hex-digest>`
      };
    }
    const digest = ref.slice(at + 1);
    if (!SHA256_DIGEST_RE.test(digest)) {
      return {
        ok: false,
        kind: "docker",
        reason: `docker digest is not a sha256:<64-hex> string (got "${digest}")`,
        fix: `${ref.slice(0, at)}@sha256:<64-hex-digest>`
      };
    }
    return { ok: true, kind: "docker" };
  }
  // GitHub-hosted: must contain @ and ref must be 40 hex chars.
  const at = ref.lastIndexOf("@");
  if (at < 0) {
    return {
      ok: false,
      kind: "github",
      reason: "missing @<sha> suffix",
      fix: `${ref}@<40-hex-sha>`
    };
  }
  const repoPart = ref.slice(0, at);
  const refPart = ref.slice(at + 1);
  if (!repoPart.includes("/")) {
    return {
      ok: false,
      kind: "unknown",
      reason: `ref "${ref}" is not a recognised local, docker, or org/repo shape`,
      fix: `<org>/<repo>@<40-hex-sha>`
    };
  }
  if (!SHA40_RE.test(refPart)) {
    return {
      ok: false,
      kind: "github",
      reason: `pinned to "${refPart}" instead of a 40-char hex SHA`,
      fix: `${repoPart}@<40-hex-sha>  # was ${refPart}`
    };
  }
  return { ok: true, kind: "github" };
}

/**
 * Run the gate over a repo root. Returns an evidence-shaped object:
 *   {
 *     ok,
 *     evidence: {
 *       workflow_count,
 *       uses_count,
 *       violations: [{ file, lineno, ref, reason, fix }],
 *       per_file: { <relpath>: { uses: n, violations: m } }
 *     },
 *     details
 *   }
 */
export async function runWorkflowPinningGate({ repoRoot }) {
  const files = await listWorkflowFiles(repoRoot);
  const violations = [];
  const perFile = {};
  let totalUses = 0;
  for (const abs of files) {
    const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
    const yaml = await fs.readFile(abs, "utf8");
    const uses = parseUsesFromWorkflow(yaml);
    let fileViolations = 0;
    for (const u of uses) {
      const verdict = classifyUses(u.ref);
      if (!verdict.ok) {
        fileViolations++;
        violations.push({
          file: rel,
          lineno: u.lineno,
          ref: u.ref,
          kind: verdict.kind,
          reason: verdict.reason,
          fix: verdict.fix
        });
      }
    }
    perFile[rel] = { uses: uses.length, violations: fileViolations };
    totalUses += uses.length;
  }

  const ok = violations.length === 0;
  const details = ok
    ? `${files.length} workflow(s), ${totalUses} uses-ref(s), all SHA-pinned`
    : `${violations.length} unpinned uses across ${
        Object.values(perFile).filter((s) => s.violations > 0).length
      } file(s)`;
  return {
    ok,
    evidence: {
      workflow_count: files.length,
      uses_count: totalUses,
      violations,
      per_file: perFile
    },
    details
  };
}
