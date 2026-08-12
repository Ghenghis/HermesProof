import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const target = path.join(os.homedir(), ".claude.json");
const supervisorPath = path.join(
  "G:",
  "Github",
  "hermes3d-mcp-lock-orchestrator",
  "scripts",
  "mcp-supervisor.mjs"
);

const raw = fs.readFileSync(target, "utf8");
const j = JSON.parse(raw);
if (!j.mcpServers || !j.mcpServers["hermes3d-locks"]) {
  console.error("hermes3d-locks block missing");
  process.exit(1);
}
const before = JSON.parse(JSON.stringify(j.mcpServers["hermes3d-locks"]));
j.mcpServers["hermes3d-locks"].args = [supervisorPath];

fs.writeFileSync(target, JSON.stringify(j, null, 2));
console.log("--- before ---");
console.log(JSON.stringify(before, null, 2));
console.log("--- after ---");
console.log(JSON.stringify(j.mcpServers["hermes3d-locks"], null, 2));
