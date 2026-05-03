#!/usr/bin/env node
/**
 * stream-watchdog.mjs — heartbeat + auto-reassign.
 *
 * Runs every 1-15 minutes (cron or manual). Detects stuck correlations and
 * auto-posts REASSIGN_REQUEST messages to free the queue.
 *
 * Detection rules:
 *   - Correlation STUCK: >3 messages on the same correlation, last activity
 *     >20 min, no `resolved`
 *   - Message EXPIRED: `expires:` field passed, status not `resolved`/`expired`
 *   - Loop WEDGED: both inboxes >5 open, no LEDGER append in 60 min
 *
 * Foolproof: idempotent — running twice produces the same state.
 */

import fs from 'node:fs';
import path from 'node:path';

const NOW = new Date();
const INCLUDE_SIBLINGS =
  process.env.HERMESPROOF_STREAM_INCLUDE_SIBLINGS === '1' ||
  process.argv.includes('--include-siblings');

function findStreamDirs() {
  const here = process.cwd();
  let root = here;
  while (root !== path.dirname(root)) {
    if (fs.existsSync(path.join(root, '.git'))) break;
    root = path.dirname(root);
  }
  const out = [];
  const sp = path.join(root, 'handoffs', 'STREAM');
  if (fs.existsSync(sp)) out.push(sp);
  // Sibling repos are opt-in so local/manual runs cannot mutate a nearby checkout.
  const parent = path.dirname(root);
  if (INCLUDE_SIBLINGS && fs.existsSync(parent)) {
    for (const sib of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!sib.isDirectory()) continue;
      const ssp = path.join(parent, sib.name, 'handoffs', 'STREAM');
      if (fs.existsSync(ssp) && !out.includes(ssp)) out.push(ssp);
    }
  }
  return out;
}

function parseMessages(text, fname) {
  const blocks = [];
  const lines = text.split(/\r?\n/);
  let cur = null;
  for (const line of lines) {
    if (/^## msg-/.test(line)) {
      if (cur) blocks.push(cur);
      cur = { header: line, lines: [line], file: fname };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function parseHeader(block) {
  const m = block.header.match(/^## (msg-([^\s]+))\s+—\s+(\S+)\s+—\s+(.+)$/);
  if (!m) return null;
  const fields = {};
  for (const line of block.lines.slice(1)) {
    if (/^## /.test(line)) break;
    const fm = line.match(/^- (\w[\w-]*):\s*(.*)$/);
    if (fm) fields[fm[1]] = fm[2].trim();
  }
  // Parse the embedded UTC timestamp from id: msg-2026-05-03T11-30-00Z-001
  const ts = m[2].match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/);
  let date = null;
  if (ts) {
    const [, d, hh, mm, ss] = ts;
    date = new Date(`${d}T${hh}:${mm}:${ss}Z`);
  }
  return {
    id: m[1],
    type: m[3],
    slug: m[4],
    fields,
    timestamp: date,
    block,
  };
}

function messageTimestamp(id) {
  const dashed = id.match(/^msg-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-/);
  if (dashed) {
    const [, d, hh, mm, ss] = dashed;
    return new Date(`${d}T${hh}:${mm}:${ss}Z`);
  }
  const compact = id.match(/^msg-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/);
  if (compact) {
    const [, yyyy, mo, dd, hh, mm, ss] = compact;
    return new Date(`${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}Z`);
  }
  return null;
}

function ageMinutes(date) {
  if (!date) return Infinity;
  return (NOW - date) / 60000;
}

function check(dir) {
  const findings = { stuck: [], expired: [], wedged: false, dir };
  const inboxFiles = ['CLAUDE_INBOX.md', 'CODEX_INBOX.md'];
  let openCount = 0;
  const corrThreads = new Map();

  for (const fname of inboxFiles) {
    const f = path.join(dir, fname);
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    const blocks = parseMessages(text, f).map(parseHeader).filter(Boolean);
    for (const m of blocks) {
      if (['open', 'acknowledged'].includes(m.fields.status)) openCount++;
      const corr = m.fields.correlation || '<no-corr>';
      if (!corrThreads.has(corr)) corrThreads.set(corr, []);
      corrThreads.get(corr).push(m);

      // Expiry check
      if (m.fields.expires && m.fields.status !== 'resolved' && m.fields.status !== 'expired') {
        const exp = new Date(m.fields.expires.replace(/Z$/, '').replace(/(\+\d{2})(\d{2})/, '$1:$2') + (m.fields.expires.endsWith('Z') ? 'Z' : ''));
        // Tolerant parser
        if (!isNaN(exp.getTime()) && exp < NOW) {
          findings.expired.push({ id: m.id, corr, file: f, expires: m.fields.expires });
        }
      }
    }
  }

  // Stuck correlations: >3 messages, last activity >20 min, no resolved
  for (const [corr, thread] of corrThreads) {
    if (thread.length < 3) continue;
    const hasResolved = thread.some((t) => t.fields.status === 'resolved');
    if (hasResolved) continue;
    const latest = thread.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
    if (ageMinutes(latest.timestamp) > 20) {
      findings.stuck.push({ correlation: corr, lastActivity: latest.timestamp, count: thread.length });
    }
  }

  // Wedged: both inboxes >5 open + no LEDGER append in 60 min
  const ledger = path.join(dir, 'LEDGER.md');
  let latestLedgerActivity = null;
  if (fs.existsSync(ledger)) {
    const ledgerText = fs.readFileSync(ledger, 'utf8');
    for (const block of parseMessages(ledgerText, ledger)) {
      const parsed = parseHeader(block);
      if (!parsed) continue;
      const ts = messageTimestamp(parsed.id);
      if (ts && (!latestLedgerActivity || ts > latestLedgerActivity)) latestLedgerActivity = ts;
    }
  }
  if (openCount > 10 && ageMinutes(latestLedgerActivity) > 60) {
    findings.wedged = true;
  }

  return findings;
}

function safeMessageId(correlation) {
  const stamp = NOW.toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
  let hash = 0;
  for (const ch of correlation) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 900;
  }
  return `msg-${stamp}-${String(hash + 100).padStart(3, '0')}`;
}

function hasOpenReassign(dir, correlation) {
  for (const fname of ['CLAUDE_INBOX.md', 'CODEX_INBOX.md']) {
    const f = path.join(dir, fname);
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    const blocks = parseMessages(text, f).map(parseHeader).filter(Boolean);
    if (
      blocks.some(
        (m) =>
          m.type === 'REASSIGN_REQUEST' &&
          m.fields.correlation === correlation &&
          ['open', 'acknowledged'].includes(m.fields.status)
      )
    ) {
      return true;
    }
  }
  return false;
}

function markExpired(finding) {
  if (!fs.existsSync(finding.file)) return false;
  const text = fs.readFileSync(finding.file, 'utf8');
  const lines = text.split(/\r?\n/);
  let inTarget = false;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`## ${finding.id} `)) {
      inTarget = true;
      continue;
    }
    if (inTarget && lines[i].startsWith('## msg-')) break;
    if (inTarget && /^- status:\s*/.test(lines[i])) {
      lines[i] = '- status: expired';
      changed = true;
      break;
    }
  }
  if (changed) fs.writeFileSync(finding.file, lines.join('\n'));
  return changed;
}

function postReassign(dir, finding) {
  if (hasOpenReassign(dir, finding.correlation)) {
    console.log(`    REASSIGN already open for ${finding.correlation}; skipping duplicate`);
    return;
  }
  const id = safeMessageId(finding.correlation);
  const body = `## ${id} — REASSIGN_REQUEST — ${finding.correlation}
- from: WATCHDOG
- to: ANY
- correlation: ${finding.correlation}
- expires: ${new Date(NOW.getTime() + 30 * 60000).toISOString()}
- status: open

Correlation \`${finding.correlation}\` is STUCK (${finding.count} messages,
last activity ${finding.lastActivity?.toISOString() || 'unknown'}, no \`resolved\`).
Reassigning to ANY available role. First TASK_CLAIMED wins.

Watchdog auto-generated at ${NOW.toISOString()}.

`;
  for (const fname of ['CLAUDE_INBOX.md', 'CODEX_INBOX.md']) {
    const f = path.join(dir, fname);
    if (fs.existsSync(f)) fs.appendFileSync(f, '\n' + body);
  }
}

function main() {
  const dirs = findStreamDirs();
  let exitCode = 0;
  const allFindings = [];
  for (const dir of dirs) {
    const f = check(dir);
    allFindings.push(f);
    console.log(`watchdog [${dir}]:`);
    console.log(`  stuck: ${f.stuck.length}`);
    console.log(`  expired: ${f.expired.length}`);
    console.log(`  wedged: ${f.wedged}`);
    for (const s of f.stuck) {
      console.log(`    STUCK ${s.correlation} (${s.count} msgs, last ${s.lastActivity?.toISOString()})`);
      postReassign(dir, s);
    }
    for (const e of f.expired) {
      if (markExpired(e)) console.log(`    EXPIRED ${e.id} in ${e.file}`);
    }
    if (f.wedged) {
      exitCode = 2; // signal escalate-to-user
      console.log(`    LOOP WEDGED → escalate to user`);
    }
  }
  process.exit(exitCode);
}

main();
