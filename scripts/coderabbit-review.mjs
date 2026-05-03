#!/usr/bin/env node
/**
 * coderabbit-review — gate `quality.coderabbit_reviewed` (advisory).
 *
 * Asserts that CodeRabbit (the `coderabbitai[bot]` GitHub user) has posted
 * AT LEAST ONE comment on a given PR. We do not gate on the verdict — only
 * presence — so a passing gate means "the PR was looked at by an
 * automated reviewer". Combined with the existing
 * `tests.unit` / `e2e.multi_agent_flow` gates this is a cheap "got
 * reviewed" signal.
 *
 * We hit two endpoints because CodeRabbit posts both:
 *   - GET /repos/:owner/:repo/issues/:n/comments    (PR thread comments)
 *   - GET /repos/:owner/:repo/pulls/:n/comments     (review/inline comments)
 *
 * Auth:
 *   - Reads GH_TOKEN, then GITHUB_TOKEN. If neither is set, the gate
 *     gracefully reports `skip:true` rather than failing — avoids flapping
 *     local runs.
 *   - PR coordinates from $PR_NUMBER + git remote `origin`, or --pr / --repo.
 *
 * No new runtime deps. Uses node:https only.
 *
 * Wired as truth gate `quality.coderabbit_reviewed` (advisory) in
 * scripts/truth-gates.mjs.
 */

import https from "node:https";
import { spawnSync } from "node:child_process";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// ---------------------------------------------------------------------------
// Argv
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") out.repo = argv[++i];
    else if (a === "--pr") out.pr = Number(argv[++i]);
    else if (a === "--bot") out.bot = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/coderabbit-review.mjs [options]

Options:
  --repo <owner/name>   Override repo (default: parsed from origin remote)
  --pr <number>         PR number (default: $PR_NUMBER)
  --bot <login>         Bot login to look for (default: coderabbitai[bot])
  --json                JSON only output
  --help                Show this help

Env:
  GH_TOKEN / GITHUB_TOKEN   GitHub token (skip if absent — gate becomes inert)
  PR_NUMBER                 PR to inspect when --pr not supplied
  CODERABBIT_BOT_LOGIN      Override bot login (default: coderabbitai[bot])`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Detect if any comment in `comments[]` was posted by `botLogin`.
 * Each comment is `{ user: { login }, ... }` (matches GitHub API shape).
 * Login match is case-insensitive; we accept exact match OR `<login>[bot]`.
 */
export function detectBotComments(comments, botLogin) {
  if (!Array.isArray(comments)) return [];
  const targets = [
    String(botLogin).toLowerCase(),
    `${String(botLogin).toLowerCase()}[bot]`
  ];
  return comments.filter((c) => {
    const login = c?.user?.login;
    if (!login) return false;
    return targets.includes(String(login).toLowerCase());
  });
}

/**
 * Parse `git remote get-url origin` text into { owner, repo }.
 * Accepts both SSH and HTTPS forms; returns null on failure.
 */
export function parseRemoteUrl(remoteUrl) {
  if (!remoteUrl) return null;
  const trimmed = String(remoteUrl).trim();
  // SSH: git@github.com:owner/repo(.git)?
  const sshM = trimmed.match(/git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshM) return { owner: sshM[1], repo: sshM[2] };
  // HTTPS: https://github.com/owner/repo(.git)?
  const httpsM = trimmed.match(/https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?(?:\/)?$/);
  if (httpsM) return { owner: httpsM[1], repo: httpsM[2] };
  return null;
}

// ---------------------------------------------------------------------------
// HTTP helpers (node:https)
// ---------------------------------------------------------------------------
function ghRequest(pathname, { token } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.github.com",
      path: pathname,
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "hermesproof-coderabbit-review-gate",
        "x-github-api-version": "2022-11-28"
      }
    };
    if (token) opts.headers.authorization = `Bearer ${token}`;
    const req = https.request(opts, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { buf += c; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
          catch (err) { reject(err); }
        } else {
          const err = new Error(`GitHub API ${pathname} status=${res.statusCode}: ${buf.slice(0, 200)}`);
          err.status = res.statusCode;
          reject(err);
        }
      });
    });
    req.setTimeout(8000, () => {
      req.destroy(Object.assign(new Error("timeout"), { code: "ENETWORK" }));
    });
    req.on("error", (err) => {
      if (["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"].includes(err.code)) err.code = "ENETWORK";
      reject(err);
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Coordinates resolution
// ---------------------------------------------------------------------------
function detectRepoFromGit() {
  const r = spawnSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return parseRemoteUrl(r.stdout);
}

// ---------------------------------------------------------------------------
// Gate runner (testable; injectable fetcher)
// ---------------------------------------------------------------------------
export async function runCoderabbitReviewGate({
  owner,
  repo,
  pr,
  botLogin = process.env.CODERABBIT_BOT_LOGIN || "coderabbitai",
  token,
  fetchIssueComments,
  fetchReviewComments
} = {}) {
  if (!owner || !repo || !pr) {
    return {
      ok: true,
      skip: true,
      evidence: { reason: "missing PR coordinates", owner, repo, pr },
      details: "no PR context (owner/repo/pr); gate inert"
    };
  }
  if (!token) {
    return {
      ok: true,
      skip: true,
      evidence: { reason: "GH_TOKEN/GITHUB_TOKEN not set", owner, repo, pr },
      details: "no GitHub token; gate inert"
    };
  }

  const issueFetcher = fetchIssueComments || ((o, r, n) =>
    ghRequest(`/repos/${o}/${r}/issues/${n}/comments?per_page=100`, { token }).then((x) => x.body));
  const reviewFetcher = fetchReviewComments || ((o, r, n) =>
    ghRequest(`/repos/${o}/${r}/pulls/${n}/comments?per_page=100`, { token }).then((x) => x.body));

  let issueComments = [];
  let reviewComments = [];
  let networkSkip = null;
  try {
    issueComments = await issueFetcher(owner, repo, pr);
  } catch (err) {
    if (err?.code === "ENETWORK") networkSkip = { stage: "issue_comments", code: err.code, message: err.message };
    else return { ok: false, skip: false, evidence: { stage: "issue_comments", error: err.message, owner, repo, pr }, details: `issue comments fetch failed: ${err.message}` };
  }
  if (!networkSkip) {
    try {
      reviewComments = await reviewFetcher(owner, repo, pr);
    } catch (err) {
      if (err?.code === "ENETWORK") networkSkip = { stage: "review_comments", code: err.code, message: err.message };
      else return { ok: false, skip: false, evidence: { stage: "review_comments", error: err.message, owner, repo, pr }, details: `review comments fetch failed: ${err.message}` };
    }
  }

  if (networkSkip) {
    return {
      ok: true,
      skip: true,
      evidence: { reason: "network unavailable", details: networkSkip, owner, repo, pr },
      details: `skipped: network unavailable (${networkSkip.code})`
    };
  }

  const issueHits = detectBotComments(issueComments, botLogin);
  const reviewHits = detectBotComments(reviewComments, botLogin);
  const totalHits = issueHits.length + reviewHits.length;
  const ok = totalHits >= 1;

  return {
    ok,
    skip: false,
    evidence: {
      owner,
      repo,
      pr,
      bot_login: botLogin,
      issue_comment_count: issueComments.length,
      review_comment_count: reviewComments.length,
      issue_hits: issueHits.length,
      review_hits: reviewHits.length,
      first_hit: issueHits[0]?.html_url || reviewHits[0]?.html_url || null
    },
    details: ok
      ? `${totalHits} CodeRabbit comment(s) present (${issueHits.length} issue + ${reviewHits.length} review)`
      : `no comments by ${botLogin} on PR #${pr}`
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && url.pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
  let owner = null, repo = null;
  if (args.repo && args.repo.includes("/")) {
    const [o, r] = args.repo.split("/");
    owner = o; repo = r;
  } else {
    const detected = detectRepoFromGit();
    if (detected) ({ owner, repo } = detected);
  }
  const pr = args.pr || Number(process.env.PR_NUMBER) || null;
  const result = await runCoderabbitReviewGate({
    owner, repo, pr,
    botLogin: args.bot,
    token
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
  } else {
    const tag = result.skip ? "SKIP" : result.ok ? "PASS" : "FAIL";
    console.log(`[${tag}] quality.coderabbit_reviewed -- ${result.details}`);
  }
  // Advisory: exit 0 unless we had a fatal API error (skip is treated as pass).
  process.exit(result.ok ? 0 : 1);
}
