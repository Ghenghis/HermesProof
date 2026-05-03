#!/usr/bin/env node
/**
 * License + dependency-freshness truth gates.
 *
 * Two pure-stdlib gate functions, each accepting injected I/O so they can be
 * unit-tested with fixtures (no real npm registry, no real license-checker).
 *
 *   - runLicensesScanGate({ packageList })          -> required
 *   - runDependencyFreshGate({ pkgJson, fetchLatest, now }) -> advisory (warn)
 *
 * Both also provide a thin "live" wrapper that the truth-gate harness uses:
 *
 *   - collectInstalledLicensesViaCheck(repoRoot)
 *   - fetchLatestFromNpm(name) (uses node:https; no new runtime deps)
 *
 * Hard rules respected:
 *   - No new runtime deps (everything is node stdlib + optional `npx --yes
 *     license-checker` invoked via spawn).
 *   - Denylist is conservative (GPL/AGPL/LGPL/SSPL/EUPL/BUSL only).
 *   - Unit tests must inject fixtures; never hit the real network.
 */

import { spawnSync } from "node:child_process";
import https from "node:https";
import path from "node:path";
import fs from "node:fs/promises";

// ---------------------------------------------------------------------------
// Allowlist / denylist (frozen — single source of truth)
// ---------------------------------------------------------------------------
export const LICENSE_ALLOWLIST = Object.freeze([
  "MIT",
  "Apache-2.0",
  "BSD-3-Clause",
  "BSD-2-Clause",
  "ISC",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "Python-2.0",
  "MPL-2.0"
]);

export const LICENSE_DENYLIST = Object.freeze([
  "GPL-2.0",
  "GPL-3.0",
  "AGPL-3.0",
  "LGPL-2.0",
  "LGPL-3.0",
  "SSPL-1.0",
  "EUPL-1.2",
  "BUSL-1.1"
]);

// Allowed-with-review (warn; not a denylist hit, but explicitly flagged).
export const LICENSE_REVIEW = Object.freeze([
  "WTFPL",
  "Public Domain",
  "UNLICENSED"
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeLicenseField(raw) {
  // license-checker reports licenses as either a string ("MIT") or
  // disjunction ("(MIT OR Apache-2.0)"). We keep the raw string for evidence
  // but extract a list of SPDX-ish tokens for matching.
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.flatMap(normalizeLicenseField);
  const s = String(raw).trim();
  // strip SPDX expression parens, split on " OR " / " AND " / "/", ","
  const cleaned = s.replace(/^\(/, "").replace(/\)$/, "");
  return cleaned
    .split(/\s+(?:OR|AND)\s+|\s*[/,]\s*/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function classifyLicenseTokens(tokens) {
  // A license entry passes if ANY token is on the allowlist.
  // It denies if ANY token is on the denylist (denylist wins on contact).
  // It warns if not allowed and any token is in the review list.
  // Otherwise it is unknown (warn).
  const allow = LICENSE_ALLOWLIST;
  const deny = LICENSE_DENYLIST;
  const review = LICENSE_REVIEW;
  const denied = tokens.filter((t) => deny.includes(t));
  if (denied.length) return { status: "denied", denied };
  const allowed = tokens.filter((t) => allow.includes(t));
  if (allowed.length) return { status: "allowed", allowed };
  const reviewed = tokens.filter((t) => review.includes(t));
  if (reviewed.length) return { status: "review", reviewed };
  return { status: "unknown" };
}

// ---------------------------------------------------------------------------
// Gate 1: licenses.scan (required)
//
// Input:  packageList — array of { name, version, licenses } records, exactly
//         the shape `license-checker --json` produces (after key flattening).
// Output: { ok, evidence: { licenses_by_package, denylisted_packages,
//                            unknown_packages }, details }
// ---------------------------------------------------------------------------
export function runLicensesScanGate({ packageList }) {
  const licenses_by_package = {};
  const denylisted_packages = [];
  const unknown_packages = [];
  const review_packages = [];

  for (const pkg of packageList) {
    const tokens = normalizeLicenseField(pkg.licenses);
    const verdict = classifyLicenseTokens(tokens);
    licenses_by_package[pkg.name] = {
      version: pkg.version || null,
      licenses_raw: pkg.licenses ?? null,
      tokens,
      status: verdict.status
    };
    if (verdict.status === "denied") {
      denylisted_packages.push({
        name: pkg.name,
        version: pkg.version || null,
        licenses_raw: pkg.licenses ?? null,
        denied: verdict.denied
      });
    } else if (verdict.status === "unknown") {
      unknown_packages.push({ name: pkg.name, version: pkg.version || null, licenses_raw: pkg.licenses ?? null });
    } else if (verdict.status === "review") {
      review_packages.push({ name: pkg.name, version: pkg.version || null, licenses_raw: pkg.licenses ?? null });
    }
  }

  const ok = denylisted_packages.length === 0;
  const evidence = {
    package_count: packageList.length,
    allowlist: LICENSE_ALLOWLIST,
    denylist: LICENSE_DENYLIST,
    review_list: LICENSE_REVIEW,
    licenses_by_package,
    denylisted_packages,
    unknown_packages,
    review_packages
  };
  let details;
  if (!ok) {
    details = `denied=${denylisted_packages.length}: ${denylisted_packages.map((p) => `${p.name}@${p.version}(${p.denied.join("|")})`).join(", ")}`;
  } else if (unknown_packages.length || review_packages.length) {
    details = `${packageList.length} packages scanned; unknown=${unknown_packages.length}, review=${review_packages.length}`;
  } else {
    details = `${packageList.length} packages scanned; all on allowlist`;
  }
  return { ok, evidence, details };
}

// ---------------------------------------------------------------------------
// Gate 2: dependency.fresh (advisory / warn)
//
// Input:
//   - pkgJson: parsed package.json content (we only read .dependencies)
//   - fetchLatest: async (name) => { latestVersion, publishedAt: ISO string }
//                  or throws with .code === "ENETWORK" if offline
//   - now: Date (defaults to new Date())
//   - freshMonths: number, default 18 (FAIL threshold)
//   - warnMonths: number, default 12 (WARN threshold)
//
// Output: { ok, level, skip, evidence: { direct_deps_count, stale_count,
//          warn_count, details }, details }
//
// Semantics:
//   - PASS  if all direct deps published within `warnMonths`.
//   - WARN  if any direct dep published > warnMonths but <= freshMonths.
//   - FAIL  if any direct dep published > freshMonths months ago.
//   - SKIP  if `fetchLatest` reports ENETWORK on the first attempt
//           (we don't half-evaluate; CI without net should not flap).
//
// The gate is registered as advisory (level=warn) in the harness, so a FAIL
// result still records ok:false but does not break the run; it's still loud.
// ---------------------------------------------------------------------------
export async function runDependencyFreshGate({
  pkgJson,
  fetchLatest,
  now = new Date(),
  freshMonths = Number(process.env.HERMES3D_DEP_FRESH_MONTHS) || 18,
  warnMonths = Number(process.env.HERMES3D_DEP_WARN_MONTHS) || 12
}) {
  const direct = pkgJson?.dependencies && typeof pkgJson.dependencies === "object"
    ? Object.keys(pkgJson.dependencies)
    : [];

  if (direct.length === 0) {
    return {
      ok: true,
      skip: false,
      evidence: {
        direct_deps_count: 0,
        stale_count: 0,
        warn_count: 0,
        fresh_months: freshMonths,
        warn_months: warnMonths,
        details: []
      },
      details: "no direct dependencies"
    };
  }

  const details = [];
  let networkSkip = null;

  for (const name of direct) {
    try {
      const { latestVersion, publishedAt } = await fetchLatest(name);
      const ts = new Date(publishedAt);
      if (Number.isNaN(ts.getTime())) {
        details.push({ name, status: "unknown", reason: "unparseable publishedAt", latestVersion, publishedAt });
        continue;
      }
      const ageMonths = (now.getTime() - ts.getTime()) / (1000 * 60 * 60 * 24 * 30);
      let status;
      if (ageMonths > freshMonths) status = "stale";
      else if (ageMonths > warnMonths) status = "warn";
      else status = "fresh";
      details.push({
        name,
        status,
        latestVersion,
        publishedAt: ts.toISOString(),
        ageMonths: Number(ageMonths.toFixed(2))
      });
    } catch (err) {
      if (err && (err.code === "ENETWORK" || err.code === "ENOTFOUND" || err.code === "ECONNREFUSED")) {
        networkSkip = { reason: "no network", code: err.code, name };
        break;
      }
      details.push({ name, status: "error", error: err?.message || String(err) });
    }
  }

  if (networkSkip) {
    return {
      ok: true,
      skip: true,
      evidence: {
        direct_deps_count: direct.length,
        stale_count: 0,
        warn_count: 0,
        fresh_months: freshMonths,
        warn_months: warnMonths,
        details: [],
        skip_reason: networkSkip
      },
      details: `skipped: ${networkSkip.reason} (${networkSkip.code})`
    };
  }

  const stale = details.filter((d) => d.status === "stale");
  const warned = details.filter((d) => d.status === "warn");
  const ok = stale.length === 0;
  const evidence = {
    direct_deps_count: direct.length,
    stale_count: stale.length,
    warn_count: warned.length,
    fresh_months: freshMonths,
    warn_months: warnMonths,
    details
  };
  let summary;
  if (stale.length) {
    summary = `${stale.length} stale (>${freshMonths}mo): ${stale.map((d) => `${d.name}@${d.latestVersion}(${d.ageMonths}mo)`).join(", ")}`;
  } else if (warned.length) {
    summary = `${warned.length} aging (${warnMonths}-${freshMonths}mo): ${warned.map((d) => `${d.name}(${d.ageMonths}mo)`).join(", ")}`;
  } else {
    summary = `${direct.length}/${direct.length} direct deps within ${warnMonths}mo`;
  }
  return { ok, skip: false, evidence, details: summary };
}

// ---------------------------------------------------------------------------
// Live adapter: invoke `npx --yes license-checker --production --json` and
// flatten the result to [{ name, version, licenses }].
//
// Returns { ok: false, reason } if license-checker is unavailable, so the
// harness can degrade to "skip with reason" instead of crashing.
// ---------------------------------------------------------------------------
export async function collectInstalledLicensesViaCheck(repoRoot) {
  // Invoke `npx --yes license-checker --production --json` in a read-only
  // mode that never writes to the project tree.
  //
  // Windows requires `shell: true` to execute `.cmd`/`.bat` shims after the
  // Node 20.x `spawnSync` security tightening (CVE-2024-27980); on POSIX we
  // keep `shell: false` for argv-array safety. On Windows we pass `npx`
  // (without the .cmd extension) and let the shell resolve it on PATH.
  const isWindows = process.platform === "win32";
  // On Windows shell-mode we manually quote any arg that contains characters
  // the shell would otherwise interpret (spaces, &, |, <, >, ^, etc.). This
  // keeps DEP0190 (Node 20+ shell-arg-escape deprecation) from biting paths
  // with spaces while still letting `.cmd` shims resolve.
  function shellQuoteWin(s) {
    if (!/[ \t&|<>^"]/.test(s)) return s;
    return `"${String(s).replace(/"/g, '\\"')}"`;
  }
  const startArg = isWindows ? shellQuoteWin(repoRoot) : repoRoot;
  const candidates = [
    {
      cmd: "npx",
      args: ["--yes", "license-checker", "--production", "--json", "--start", startArg],
      shell: isWindows
    }
  ];
  for (const c of candidates) {
    const r = spawnSync(c.cmd, c.args, {
      cwd: repoRoot,
      encoding: "utf8",
      shell: c.shell,
      timeout: 120_000
    });
    if (r.error && r.error.code === "ENOENT") continue;
    if (r.error) {
      return { ok: false, reason: `license-checker spawn error: ${r.error.code || ""} ${r.error.message || r.error}`.slice(0, 200) };
    }
    if (r.status !== 0) {
      return { ok: false, reason: `license-checker exit=${r.status}: ${(r.stderr || "").slice(0, 200)}` };
    }
    let parsed;
    try { parsed = JSON.parse(r.stdout); }
    catch (err) { return { ok: false, reason: `license-checker JSON parse failed: ${err.message}` }; }
    const list = [];
    for (const [key, val] of Object.entries(parsed)) {
      // license-checker keys are "name@version"; split on the LAST "@"
      const at = key.lastIndexOf("@");
      const name = at > 0 ? key.slice(0, at) : key;
      const version = at > 0 ? key.slice(at + 1) : null;
      list.push({ name, version, licenses: val.licenses });
    }
    return { ok: true, packageList: list };
  }
  return { ok: false, reason: "npx not on PATH" };
}

// ---------------------------------------------------------------------------
// Live adapter: fetch latest version + first-published time from npm registry.
//
// Uses node:https — no new runtime deps. Never invoked from unit tests
// (tests inject a fake `fetchLatest`). Throws { code: "ENETWORK" } on DNS or
// connect failure so the gate cleanly downgrades to "skip" in CI.
// ---------------------------------------------------------------------------
export async function fetchLatestFromNpm(name, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace(/%40/, "@")}`;
    const req = https.get(url, { headers: { accept: "application/json" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        const err = new Error(`npm registry status=${res.statusCode} for ${name}`);
        err.code = "EHTTP";
        return reject(err);
      }
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { buf += c; });
      res.on("end", () => {
        try {
          const j = JSON.parse(buf);
          const latest = j["dist-tags"]?.latest;
          if (!latest) return reject(new Error(`no dist-tags.latest for ${name}`));
          const publishedAt = j.time?.[latest];
          if (!publishedAt) return reject(new Error(`no time[${latest}] for ${name}`));
          resolve({ latestVersion: latest, publishedAt });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error("timeout"), { code: "ENETWORK" }));
    });
    req.on("error", (err) => {
      // Map common offline errors to ENETWORK for the gate's skip path.
      if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED" || err.code === "EAI_AGAIN") {
        err.code = "ENETWORK";
      }
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Convenience: read the repo's package.json (used by the live harness path).
// ---------------------------------------------------------------------------
export async function readPackageJson(repoRoot) {
  const raw = await fs.readFile(path.join(repoRoot, "package.json"), "utf8");
  return JSON.parse(raw);
}
