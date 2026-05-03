#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { EventManager } from "../src/core/event-manager.mjs";
import { ensureDir, statePaths } from "../src/core/fs-utils.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workspace") out.workspace = argv[++i];
    else if (arg === "--event-id") out.eventId = argv[++i];
    else if (arg === "--event-file") out.eventFile = argv[++i];
    else if (arg === "--out-dir") out.outDir = argv[++i];
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

export async function generateReviewPacket({
  workspace,
  event,
  reviewPacketDir
}) {
  const workspaceRoot = path.resolve(workspace || process.cwd());
  const paths = statePaths(workspaceRoot);
  const outDir = reviewPacketDir || paths.reviewPacketsDir;
  await ensureDir(outDir);
  const safeTask = String(event.task_id || "no-task").replace(/[^A-Za-z0-9._-]/g, "_");
  const file = path.join(outDir, `REVIEW_${safeTask}_${event.event_id}.md`);
  const pr = await prDetails(workspaceRoot, event);
  const body = [
    `# HermesProof Review Packet`,
    "",
    `- **Event**: \`${event.event_type}\``,
    `- **Event id**: \`${event.event_id}\``,
    `- **Task**: \`${event.task_id || "(none)"}\``,
    `- **Owner**: \`${event.owner || "(none)"}\``,
    `- **Branch**: \`${event.branch || "(unknown)"}\``,
    `- **Next actor**: \`${event.next_actor}\``,
    `- **Recommended action**: \`${event.recommended_action}\``,
    `- **Created UTC**: ${event.created_utc}`,
    "",
    "## Summary",
    "",
    event.summary || "(none)",
    "",
    "## Files",
    "",
    ...list(event.files || []),
    "",
    "## Evidence IDs",
    "",
    ...list(event.evidence_ids || []),
    "",
    "## Pull Request",
    "",
    pr ? `- **PR**: ${pr.url || pr.number || "(unknown)"}` : "- (not found)",
    pr?.files?.length ? "" : "",
    ...(pr?.files?.length ? ["## PR Files", "", ...list(pr.files), ""] : []),
    "## Payload",
    "",
    "```json",
    JSON.stringify(event.payload || {}, null, 2),
    "```",
    "",
    "## Ready-To-Paste Review Prompt",
    "",
    "```text",
    `Review HermesProof event ${event.event_id} (${event.event_type}) for task ${event.task_id || "(none)"}.`,
    `Owner: ${event.owner || "(none)"}. Branch: ${event.branch || "(unknown)"}.`,
    `Recommended action: ${event.recommended_action}.`,
    `Evidence IDs: ${(event.evidence_ids || []).join(", ") || "(none)"}.`,
    "Check the PR diff, confirm listed gates/evidence, and report PASS/FAIL with actionable findings.",
    "```",
    ""
  ].join("\n");
  await fs.writeFile(file, body, "utf8");
  return { ok: true, path: file, event_id: event.event_id };
}

export async function ensureEventDirs(workspace) {
  const paths = statePaths(path.resolve(workspace || process.cwd()));
  await ensureDir(paths.eventsOutboxDir);
  await ensureDir(paths.eventsHandledDir);
  await ensureDir(paths.eventsFailedDir);
  await ensureDir(paths.reviewPacketsDir);
  return {
    outboxDir: paths.eventsOutboxDir,
    handledDir: paths.eventsHandledDir,
    failedDir: paths.eventsFailedDir,
    reviewPacketsDir: paths.reviewPacketsDir
  };
}

export function validateEventEnvelope(event) {
  if (!event || typeof event !== "object") throw new Error("event envelope must be an object");
  if (event.event_schema_version !== 1) throw new Error("unknown_schema_version");
  if (typeof event.event_id !== "string" || !event.event_id.startsWith("evt_")) {
    throw new Error("invalid event_id");
  }
  for (const key of ["event_type", "created_utc", "workspace_root", "next_actor", "recommended_action"]) {
    if (typeof event[key] !== "string" || !event[key]) throw new Error(`missing ${key}`);
  }
  if (!Array.isArray(event.files)) throw new Error("files must be an array");
  if (!Array.isArray(event.evidence_ids)) throw new Error("evidence_ids must be an array");
  if (!event.payload || typeof event.payload !== "object") throw new Error("payload must be an object");
  return true;
}

export async function loadEvent({ workspace, eventId, eventFile }) {
  if (eventFile) return JSON.parse(await fs.readFile(eventFile, "utf8"));
  if (!eventId) throw new Error("--event-id or --event-file is required");
  const manager = new EventManager({ workspaceRoot: path.resolve(workspace || process.cwd()) });
  const listed = await manager.listEvents({ status: "all", limit: 500 });
  const event = listed.events.find((item) => item.event_id === eventId);
  if (!event) throw new Error(`event not found: ${eventId}`);
  return event;
}

async function prDetails(workspaceRoot, event) {
  const prUrl = event?.payload?.pr_url;
  if (prUrl) return { url: prUrl, files: [] };
  const branch = event.branch;
  if (!branch) return null;
  const view = spawnSync("gh", ["pr", "view", "--head", branch, "--json", "number,url,files"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    shell: false
  });
  if (view.status !== 0 || !view.stdout) return null;
  try {
    const parsed = JSON.parse(view.stdout);
    return { ...parsed, files: (parsed.files || []).map((file) => file.path).sort() };
  } catch {
    return null;
  }
}

function list(items) {
  return items.length ? items.map((item) => `- \`${item}\``) : ["- (none)"];
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/generate-review-packet.mjs --workspace <path> --event-id <id> [--out-dir <path>]");
    process.exit(0);
  }
  try {
    const event = await loadEvent({
      workspace: args.workspace,
      eventId: args.eventId,
      eventFile: args.eventFile
    });
    const result = await generateReviewPacket({
      workspace: args.workspace,
      event,
      reviewPacketDir: args.outDir
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}
