/**
 * mcp-scan-static gate — static analysis over `src/server.mjs` to catch
 * tool-poisoning patterns. This is the OWASP MCP "tool poisoning" defense
 * extended beyond the original `server.tool_description_hygiene` linter.
 *
 * What we look for:
 *   - Prompt-injection markers in tool descriptions/titles
 *     (e.g. "ignore previous", "you must", "you should always", base64
 *     blobs ≥60 chars, zero-width unicode, executable HTML tags).
 *   - Hidden-content markers — `<HIDDEN>`, `<!-- hidden -->`, `<sysprompt>`,
 *     `<system>`, `[[hidden]]`, etc. The MCP rug-pull attack inserts
 *     these inside descriptions so a tool-list browser sees one thing
 *     while the model sees another.
 *   - Authority impersonation strings — "as the user", "the user has authorized",
 *     "act as admin", "developer mode", "override safety", which are the
 *     classic prompt-injection escalation phrases.
 *   - Exfiltration directives — "send to", "POST to", "fetch ", "curl ",
 *     "wget " inside a description; tool descriptions should never tell
 *     the model to make outbound calls.
 *   - Encoded payloads beyond base64 — long hex blobs (≥40 hex chars in
 *     a row inside a quoted string), URL-encoded payload markers (%-encoded
 *     runs ≥8 chars), zero-width / RTL-override / bidi-isolate unicode.
 *   - Tool description / title keys that exceed a sanity length.
 *
 * Pure-regex; zero new runtime deps.
 *
 * Exposed:
 *   MCP_SCAN_PATTERNS                 — full pattern list
 *   scanSource(text, opts?)            -> [{ pattern, sample, line }]
 *   findToolDescriptionFields(text)    -> [{ key, value, line }]
 *   runMcpScanStaticGate({ serverPath })  -> { ok, evidence, details }
 */
import fs from "node:fs/promises";

/**
 * Regex catalog. Each pattern has:
 *   name          stable id used in evidence + tests
 *   re            RegExp (with /g where multiple matches matter; NOT /m
 *                 unless we genuinely need per-line semantics — JS regex
 *                 default already matches greedy across boundaries)
 *   description   what an attacker tries to slip in
 *   severity      "high" | "medium" — both are still failures, severity is
 *                 reported in evidence so a human review can prioritise.
 */
export const MCP_SCAN_PATTERNS = [
  // -------- existing tool_description_hygiene set --------
  {
    name: "ignore_previous",
    re: /ignore\s+(?:all\s+)?previous/i,
    severity: "high",
    description: 'classic "ignore previous instructions" injection'
  },
  {
    name: "you_must",
    re: /\byou\s+must\b/i,
    severity: "medium",
    description: 'imperative "you must" — prompt-injection foothold'
  },
  {
    name: "always_directive",
    re: /\byou\s+(?:should\s+)?always\b/i,
    severity: "medium",
    description: 'imperative "you (should) always"'
  },
  {
    name: "long_base64",
    re: /[A-Za-z0-9+/=]{60,}/,
    severity: "high",
    description: "long base64-shaped run (encoded payload)"
  },
  {
    name: "zero_width",
    re: /[​‌‍⁠﻿‪-‮⁦-⁩]/,
    severity: "high",
    description: "zero-width or bidi-override unicode (steganographic injection)"
  },
  {
    name: "html_executable",
    re: /<\s*(?:script|iframe|object|embed)\b/i,
    severity: "high",
    description: "executable HTML tag in description"
  },

  // -------- mcp-scan extensions --------
  {
    name: "hidden_marker",
    re: /<\s*hidden\s*>|\[\[\s*hidden\s*\]\]|<!--\s*hidden\s*-->/i,
    severity: "high",
    description: "explicit hidden-content marker (rug-pull setup)"
  },
  {
    name: "system_prompt_marker",
    re: /<\s*(?:sysprompt|system|sys)\s*>|<\|\s*system\s*\|>/i,
    severity: "high",
    description: 'fake "system" prompt marker'
  },
  {
    name: "authority_user_authorized",
    re: /\bthe\s+user\s+(?:has\s+)?(?:authori[sz]ed|approved|consented|pre[-\s]?authori[sz]ed)\b/i,
    severity: "high",
    description: "authority-impersonation: claims user authorization"
  },
  {
    name: "act_as_admin",
    re: /\bact\s+as\s+(?:the\s+)?(?:admin(?:istrator)?|root|developer|anthropic)\b/i,
    severity: "high",
    description: "role escalation phrase"
  },
  {
    name: "developer_mode",
    re: /\b(?:developer|dev|debug|jailbreak|sudo|god)\s+mode\b/i,
    severity: "high",
    description: 'mode-escalation phrase ("developer mode", "jailbreak mode")'
  },
  {
    name: "override_safety",
    re: /\boverride\s+(?:safety|guard(?:rails)?|policy|policies|rules)\b/i,
    severity: "high",
    description: "explicit safety-override directive"
  },
  {
    name: "exfil_outbound_post",
    re: /\b(?:POST|GET|PUT|DELETE)\s+(?:to\s+)?https?:\/\//i,
    severity: "high",
    description: "outbound HTTP exfiltration directive in description"
  },
  {
    name: "exfil_curl_wget",
    re: /\b(?:curl|wget|nc|netcat)\s+-{1,2}/i,
    severity: "high",
    description: "shell-exfil directive in description"
  },
  {
    name: "long_hex_payload",
    re: /["'][0-9a-f]{40,}["']/i,
    severity: "medium",
    description: "long hex-encoded run inside a quoted string"
  },
  {
    name: "url_encoded_payload",
    re: /(?:%[0-9A-Fa-f]{2}){8,}/,
    severity: "medium",
    description: "URL-encoded payload of ≥8 octets"
  }
];

/**
 * Run every pattern against the source. Returns matches in source order.
 * `opts.skipPatterns` lets callers narrow the set (e.g. for negative tests).
 */
export function scanSource(text, opts = {}) {
  const skip = new Set(opts.skipPatterns || []);
  const findings = [];
  for (const p of MCP_SCAN_PATTERNS) {
    if (skip.has(p.name)) continue;
    const m = text.match(p.re);
    if (!m) continue;
    const idx = m.index ?? text.indexOf(m[0]);
    const before = idx >= 0 ? text.slice(0, idx) : "";
    const line = before.length ? before.split(/\r?\n/).length : 1;
    findings.push({
      pattern: p.name,
      severity: p.severity,
      description: p.description,
      sample: m[0].slice(0, 80),
      line
    });
  }
  return findings;
}

/**
 * Heuristic extraction of `description: "…"` and `title: "…"` field values
 * from the server source. We only need this for tighter-scoped scans (e.g.
 * scanning only the description bodies, not the surrounding code). Pure
 * regex; works for the hand-written zod object shapes used in src/server.mjs.
 *
 * Returns: [{ key, value, line }]  (line = 1-based)
 */
export function findToolDescriptionFields(text) {
  const out = [];
  // .describe("…") — zod fluent API used heavily in this repo
  const describeRe = /\.describe\(\s*(["'`])((?:\\.|(?!\1).)*)\1\s*\)/g;
  let m;
  while ((m = describeRe.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    out.push({ key: "describe", value: m[2], line: before.split(/\r?\n/).length });
  }
  // description: "…" or title: "…"
  const fieldRe = /\b(description|title)\s*:\s*(["'`])((?:\\.|(?!\2).)*)\2/g;
  while ((m = fieldRe.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    out.push({ key: m[1], value: m[3], line: before.split(/\r?\n/).length });
  }
  return out;
}

/**
 * Run the gate against the MCP server source file.
 * Returns:
 *   { ok, evidence: { file, bytes, fields_scanned, findings: [...] }, details }
 */
export async function runMcpScanStaticGate({ serverPath }) {
  const src = await fs.readFile(serverPath, "utf8");
  const findings = scanSource(src);
  const fields = findToolDescriptionFields(src);
  // Field-scoped scan: catch a pattern that lives specifically inside a
  // description / title body even if the surrounding code (e.g. a comment
  // saying "you must" inside a non-tool function) would have been a false
  // positive. We currently only ADD findings here — the broad scanSource
  // already covers the strict superset.
  const fieldFindings = [];
  for (const f of fields) {
    for (const p of MCP_SCAN_PATTERNS) {
      const m = f.value.match(p.re);
      if (!m) continue;
      // Avoid double-counting against the source-wide scan: only record if
      // this specific (pattern, line, sample) is not already in `findings`.
      const sample = m[0].slice(0, 80);
      const dup = findings.some(
        (existing) => existing.pattern === p.name && existing.sample === sample
      );
      if (!dup) {
        fieldFindings.push({
          pattern: p.name,
          severity: p.severity,
          field: f.key,
          line: f.line,
          sample
        });
      }
    }
  }
  const allFindings = [...findings, ...fieldFindings];
  const ok = allFindings.length === 0;
  const details = ok
    ? `0 suspicious patterns across ${MCP_SCAN_PATTERNS.length} signatures`
    : `${allFindings.length} pattern(s): ${allFindings.map((f) => f.pattern).join(", ")}`;
  return {
    ok,
    evidence: {
      file: serverPath,
      bytes: Buffer.byteLength(src, "utf8"),
      pattern_count: MCP_SCAN_PATTERNS.length,
      fields_scanned: fields.length,
      findings: allFindings
    },
    details
  };
}
