#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { EventManager } from "../src/core/event-manager.mjs";
import { generateReviewPacket } from "./generate-review-packet.mjs";

function webhookTimeoutMs() {
  const parsed = Number(process.env.HERMESPROOF_WEBHOOK_TIMEOUT_MS || 10000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
}

function parseArgs(argv) {
  const out = { poll: 30, markHandled: false, writeReviewPackets: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workspace") out.workspace = argv[++i];
    else if (arg === "--poll") out.poll = Number(argv[++i]);
    else if (arg === "--once") out.once = true;
    else if (arg === "--write-review-packets") out.writeReviewPackets = true;
    else if (arg === "--review-packet-dir") out.reviewPacketDir = argv[++i];
    else if (arg === "--mark-handled") out.markHandled = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

export async function watchEvents({
  workspace = process.cwd(),
  poll = 30,
  once = false,
  writeReviewPackets = false,
  reviewPacketDir,
  markHandled = false,
  webhookUrl = process.env.HERMESPROOF_WEBHOOK_URL
} = {}) {
  const manager = new EventManager({ workspaceRoot: workspace });
  const seen = new Set();
  do {
    const listed = await manager.listEvents({ status: "outbox", limit: 500 });
    for (const event of listed.events) {
      if (seen.has(event.event_id)) continue;
      seen.add(event.event_id);
      let packet = null;
      if (writeReviewPackets) {
        packet = await generateReviewPacket({ workspace, event, reviewPacketDir });
      }
      console.log(
        `[HermesProof] ${event.event_type} ${event.task_id || "(no-task)"} ` +
        `by ${event.owner || "(unknown)"} -> ${event.recommended_action}` +
        (packet ? ` packet=${packet.path}` : "")
      );
      let posted = false;
      if (webhookUrl) {
        const timeoutMs = webhookTimeoutMs();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
            signal: controller.signal
          });
          posted = response.status >= 200 && response.status < 300;
          console.log(`[HermesProof] webhook ${event.event_id} status=${response.status}`);
        } catch (err) {
          posted = false;
          if (err.name === "AbortError") {
            console.error(`[HermesProof] webhook timeout ${event.event_id} after ${timeoutMs}ms`);
          } else {
            console.error(`[HermesProof] webhook failed ${event.event_id}: ${err.message}`);
          }
        } finally {
          clearTimeout(timer);
        }
      }
      if (markHandled && (!webhookUrl || posted)) {
        await manager.markEventHandled({
          event_id: event.event_id,
          handled_by: "event-watcher",
          note: webhookUrl ? "webhook accepted event" : "marked by watch-events"
        });
      }
    }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, poll) * 1000));
  } while (true);
  return { ok: true, seen: seen.size };
}

export async function markEventHandled({ workspace = process.cwd(), eventId, handledBy, note = "" }) {
  const manager = new EventManager({ workspaceRoot: workspace });
  return await manager.markEventHandled({
    event_id: eventId,
    handled_by: handledBy,
    note
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/watch-events.mjs [--workspace <path>] [--once] [--write-review-packets] [--mark-handled]`);
    process.exit(0);
  }
  try {
    const result = await watchEvents(args);
    if (args.once) console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}
