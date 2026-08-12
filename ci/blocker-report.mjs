#!/usr/bin/env node
import child from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const args = process.argv.slice(2)
const val = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const has = (name) => args.includes(name)
const root = val("--in", ".")
const out = val("--out", "ci-blockers.json")
const md = val("--markdown", path.join("reports", "blockers.md"))

const run = (cmd, params = []) => {
  try {
    return child.execFileSync(cmd, params, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  } catch {
    return "unavailable"
  }
}

const files = []
const walk = (dir) => {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if ([".git", "node_modules", ".npm"].includes(entry.name)) continue
      walk(file)
      continue
    }
    if (/\.(json|log|txt|md)$/i.test(entry.name)) files.push(file)
  }
}

const add = (map, input) => {
  const key = [input.lane, input.kind, input.fingerprint].join(":")
  if (map.has(key)) {
    const item = map.get(key)
    item.evidence = Array.from(new Set([...item.evidence, ...input.evidence]))
    item.artifacts = Array.from(new Set([...item.artifacts, ...input.artifacts]))
    return
  }
  const id = crypto.createHash("sha1").update(key).digest("hex").slice(0, 12)
  map.set(key, {
    blocker_id: `blk_${id}`,
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    gitlab_labels: [`lane::${input.lane}`, `kind::${input.kind}`, `severity::${input.severity}`],
    ...input,
  })
}

walk(root)
const blockers = new Map()
for (const file of files) {
  const body = fs.readFileSync(file, "utf8")
  const checks = [
    {
      regex: /workspace\.integrity.*fail|unexpected modified|unexpected untracked|dirty worktree/i,
      item: {
        title: "HermesProof workspace integrity is dirty",
        severity: "release-blocker",
        lane: "hermesproof",
        kind: "dirty-worktree",
        fingerprint: "hermesproof-dirty-worktree",
        suspected_root: "Release proof cannot be trusted while unexpected worktree changes exist.",
        next_action: "Commit, clean, or register an expected-diff manifest before release.",
      },
    },
    {
      regex: /chain.*break|proof.*break|integrity.*break/i,
      item: {
        title: "HermesProof chain integrity break",
        severity: "release-blocker",
        lane: "hermesproof",
        kind: "chain-break",
        fingerprint: "hermesproof-chain-break",
        suspected_root: "Proof chain verification reported a break.",
        next_action: "Inspect PROOF/latest.json and repair or quarantine broken proof records.",
      },
    },
    {
      regex: /OpenHands unavailable|visible.*HermesProof.*failed|sidecar.*proof.*missing/i,
      item: {
        title: "Kilo sidecar evidence was missing",
        severity: "release-blocker",
        lane: "openhands",
        kind: "visible-proof-missing",
        fingerprint: "kilo-sidecar-proof-missing",
        suspected_root: "Kilo visible sidecar actions were not recorded into HermesProof.",
        next_action: "Require Kilo CI artifacts with visible sidecar proof ids before ecosystem release.",
      },
    },
  ]
  for (const check of checks) {
    if (!check.regex.test(body)) continue
    add(blockers, {
      ...check.item,
      evidence: [file, body.slice(0, 2000)],
      artifacts: [file],
    })
  }
}

const list = Array.from(blockers.values()).sort((a, b) => a.blocker_id.localeCompare(b.blocker_id))
const report = {
  generated_at: new Date().toISOString(),
  commit: run("git", ["rev-parse", "HEAD"]),
  pipeline_id: process.env.CI_PIPELINE_ID || null,
  environment: {
    os: `${process.platform} ${process.arch} ${os.release()}`,
    runner_tags: (process.env.CI_RUNNER_TAGS || "").split(",").map((item) => item.trim()).filter(Boolean),
    node: process.version,
    npm: run("npm", ["--version"]),
  },
  blockers: list,
}

fs.writeFileSync(out, JSON.stringify(report, null, 2))
fs.mkdirSync(path.dirname(md), { recursive: true })
fs.writeFileSync(
  md,
  [
    "# HermesProof CI Blockers",
    "",
    `Generated: ${report.generated_at}`,
    `Blockers: ${list.length}`,
    "",
    ...list.flatMap((item) => [
      `## ${item.blocker_id} ${item.title}`,
      "",
      `- Severity: ${item.severity}`,
      `- Lane: ${item.lane}`,
      `- Kind: ${item.kind}`,
      `- Suspected root: ${item.suspected_root}`,
      `- Next action: ${item.next_action}`,
      "",
    ]),
  ].join("\n"),
)
console.log(JSON.stringify({ blockers: list.length, releaseBlockers: list.filter((item) => item.severity === "release-blocker").length }, null, 2))
if (has("--fail-on-release-blocker") && list.some((item) => item.severity === "release-blocker")) process.exit(1)
