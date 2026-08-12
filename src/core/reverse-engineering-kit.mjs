import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TOOL_SPECS = Object.freeze({
  ghidra: Object.freeze({ command: "analyzeHeadless", args: ["-version"], capabilities: ["reverse.static"] }),
  rizin: Object.freeze({ command: "rizin", args: ["-v"], capabilities: ["reverse.static"] }),
  radare2: Object.freeze({ command: "radare2", args: ["-v"], capabilities: ["reverse.static"] }),
  cutter: Object.freeze({ command: "cutter", args: ["--version"], capabilities: ["reverse.static"] }),
  x64dbg: Object.freeze({ command: "x64dbg", args: ["--version"], capabilities: ["reverse.debug.windows"] }),
  dnspy: Object.freeze({ command: "dnSpy", args: ["--version"], capabilities: ["reverse.dotnet"] }),
  jadx: Object.freeze({ command: "jadx", args: ["--version"], capabilities: ["reverse.android"] }),
  apktool: Object.freeze({ command: "apktool", args: ["--version"], capabilities: ["reverse.android"] }),
  binwalk: Object.freeze({ command: "binwalk", args: ["--help"], capabilities: ["reverse.firmware"] }),
  "llvm-objdump": Object.freeze({ command: "llvm-objdump", args: ["--version"], capabilities: ["reverse.binary.inspect"] }),
  dumpbin: Object.freeze({ command: "dumpbin", args: ["/?"], capabilities: ["reverse.binary.inspect"] }),
  strings: Object.freeze({ command: "strings", args: ["--version"], capabilities: ["reverse.binary.inspect"] })
});

const PACK_SCHEMA = Object.freeze({
  schema: "hermesproof.capability-pack.v1",
  namespace: "io.hermesproof.reverse-engineering",
  profile: "reverse-engineering-local",
  tools: Object.keys(TOOL_SPECS),
  authorization_required: true,
  default_enabled: false,
  network: "none",
  permissions: ["workspace:read", "process:child"]
});
const schemaSha256 = crypto.createHash("sha256").update(JSON.stringify(PACK_SCHEMA)).digest("hex");

export const REVERSE_ENGINEERING_CAPABILITY_PACK = Object.freeze({
  id: "reverse-engineering-local",
  namespace: PACK_SCHEMA.namespace,
  version: "2026.8.1",
  source: Object.freeze({
    type: "local-system-inventory",
    package: "operator-installed-tools",
    integrity: "sha256-" + schemaSha256
  }),
  capabilities: Object.freeze([
    "reverse.static",
    "reverse.debug.windows",
    "reverse.dotnet",
    "reverse.android",
    "reverse.firmware",
    "reverse.binary.inspect"
  ]),
  permissions: Object.freeze([...PACK_SCHEMA.permissions]),
  executable_sha256: null,
  schema_sha256: schemaSha256,
  sbom: Object.freeze({ format: "spdx-json", generated_at_install: true }),
  health_probe: Object.freeze({ type: "inventory", tools: Object.keys(TOOL_SPECS) }),
  rollback: Object.freeze({ strategy: "disable-lease-and-restore-previous-inventory" }),
  locality: "local",
  cost: "zero",
  default_enabled: false,
  authorization_required: true,
  allowed_scope: "owned-or-explicitly-authorized-targets",
  read_only_first: true
});

function sanitizeProbe(value = {}) {
  return {
    present: value.present === true,
    version: typeof value.version === "string" && value.version.length > 0 ? value.version : null,
    error_code: typeof value.error_code === "string" ? value.error_code : null
  };
}

export function assessReverseEngineeringInventory(inventory = {}) {
  const tools = {};
  const capabilities = new Set();
  for (const [name, spec] of Object.entries(TOOL_SPECS)) {
    const result = sanitizeProbe(inventory[name]);
    tools[name] = result;
    if (result.present) {
      for (const capability of spec.capabilities) capabilities.add(capability);
    }
  }
  return {
    schema: "hermesproof.reverse-engineering-inventory.v1",
    ok: true,
    enabled: false,
    authorization_required: true,
    allowed_scope: "owned-or-explicitly-authorized-targets",
    network_access: false,
    read_only_first: true,
    installed_tool_count: Object.values(tools).filter((tool) => tool.present).length,
    available_capabilities: [...capabilities].sort(),
    tools,
    lease_policy: {
      dimensions: ["workspace", "owner", "task", "time", "target"],
      enable_after_inventory: false,
      idle_disable: true,
      evidence_required: true
    }
  };
}

async function defaultCommandProbe(_name, spec) {
  try {
    const result = await execFileAsync(spec.command, spec.args, {
      shell: false,
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 256 * 1024
    });
    const version = String(result.stdout || result.stderr || "").trim().split(/\r?\n/u)[0] || null;
    return { present: true, version };
  } catch (error) {
    return { present: false, error_code: error?.code === "ENOENT" ? "NOT_FOUND" : "PROBE_FAILED" };
  }
}

export async function probeReverseEngineeringInventory({ commandProbe = defaultCommandProbe } = {}) {
  if (typeof commandProbe !== "function") throw new TypeError("commandProbe must be a function");
  const entries = await Promise.all(Object.entries(TOOL_SPECS).map(async ([name, spec]) => [
    name,
    await commandProbe(name, { command: spec.command, args: [...spec.args] })
  ]));
  return assessReverseEngineeringInventory(Object.fromEntries(entries));
}
