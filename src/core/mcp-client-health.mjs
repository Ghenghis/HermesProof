export const REQUIRED_HERMESPROOF_MCP_SERVERS = Object.freeze([
  "hermes3d-locks",
  "hp-mha-serena"
]);

export function evaluateRequiredMcpConnections(
  output,
  requiredServers = REQUIRED_HERMESPROOF_MCP_SERVERS
) {
  const lines = String(output ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const connections = {};
  const missing = [];
  const failed = [];

  for (const server of requiredServers) {
    const line = lines.find((candidate) => candidate.startsWith(server + ":")) || "";
    const connected = /✓\s*Connected/iu.test(line);
    connections[server] = { line, connected };
    if (!line) missing.push(server);
    else if (!connected) failed.push(server);
  }

  return {
    ok: missing.length === 0 && failed.length === 0,
    required: [...requiredServers],
    connections,
    missing,
    failed
  };
}
