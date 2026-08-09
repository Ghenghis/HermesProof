#!/usr/bin/env node
import fs from "node:fs"

const args = process.argv.slice(2)
const val = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const blockersPath = val("--blockers", "ci-blockers.json")
const out = val("--out", "release-truth.json")
const blockers = fs.existsSync(blockersPath) ? JSON.parse(fs.readFileSync(blockersPath, "utf8")) : { blockers: [] }
const release = blockers.blockers.filter((item) => item.severity === "release-blocker")
const report = {
  generated_at: new Date().toISOString(),
  ok: release.length === 0,
  release_blockers: release.length,
  blockers: blockers.blockers.length,
  blocker_ids: release.map((item) => item.blocker_id),
  commit: blockers.commit || "unknown",
  pipeline_id: blockers.pipeline_id || null,
}
fs.writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (!report.ok && args.includes("--fail-on-release-blocker")) process.exit(1)
