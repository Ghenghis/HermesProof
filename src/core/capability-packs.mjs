import fs from "node:fs/promises";
import path from "node:path";

const clone = (value) => JSON.parse(JSON.stringify(value));
function digest(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(value || "")) throw new TypeError(label + " must be a SHA-256 digest");
}

export function validateCapabilityPack(pack) {
  if (!pack || typeof pack !== "object") throw new TypeError("capability pack is required");
  if (typeof pack.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(pack.id)) {
    throw new TypeError("capability pack id is invalid");
  }
  if (typeof pack.version !== "string" || pack.version.length === 0 || pack.version === "latest" ||
      /[x*]/i.test(pack.version)) {
    throw new TypeError("capability pack requires a pinned version");
  }
  if (!pack.source || typeof pack.source.integrity !== "string") {
    throw new TypeError("capability pack source integrity is required");
  }
  if (pack.executable_sha256 === null) {
    if (!pack.source.integrity) {
      throw new TypeError("dynamic executable provenance requires pinned source integrity");
    }
  } else {
    digest(pack.executable_sha256, "executable_sha256");
  }
  digest(pack.schema_sha256, "schema_sha256");
  if (pack.sbom?.generated_at_install !== true) {
    digest(pack.sbom?.sha256, "SBOM sha256");
  }
  if (!pack.rollback?.strategy) throw new TypeError("capability pack rollback metadata is required");
  if (!Array.isArray(pack.capabilities) || pack.capabilities.length === 0) {
    throw new TypeError("capability pack capabilities are required");
  }
  if (!Array.isArray(pack.permissions)) throw new TypeError("capability pack permissions are required");
  if (pack.default_enabled !== false) throw new TypeError("capability packs must default disabled");
  return { ok: true, pack: clone(pack) };
}

export class CapabilityPackManager {
  constructor({ workspaceRoot, catalog = [], installer } = {}) {
    if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
      throw new TypeError("workspaceRoot is required");
    }
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.catalog = catalog.map((pack) => validateCapabilityPack(pack).pack);
    this.installer = installer;
    this.stateFile = path.join(this.workspaceRoot, ".hermes3d_orchestrator", "capability-packs.json");
    this.state = { schema: "hermesproof.capability-packs.v1", installed: [] };
    this.initialized = false;
  }

  async init() {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    try {
      this.state = JSON.parse(await fs.readFile(this.stateFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await this.persist();
    }
    this.state.installed = Array.isArray(this.state.installed) ? this.state.installed : [];
    this.initialized = true;
    return this;
  }

  async persist() {
    const temporary = this.stateFile + "." + process.pid + ".tmp";
    await fs.writeFile(temporary, JSON.stringify(this.state, null, 2) + "\n", "utf8");
    await fs.rename(temporary, this.stateFile);
  }

  pack(packId) {
    const pack = this.catalog.find((item) => item.id === packId);
    if (!pack) throw new Error("Unknown capability pack: " + packId);
    return pack;
  }

  resolve(requiredCapabilities = []) {
    const remaining = new Set(requiredCapabilities);
    const selected = [];
    while (remaining.size > 0) {
      const candidates = this.catalog
        .map((pack) => ({ pack, covers: pack.capabilities.filter((capability) => remaining.has(capability)) }))
        .filter((item) => item.covers.length > 0)
        .sort((left, right) =>
          Number(right.pack.locality === "local") - Number(left.pack.locality === "local") ||
          Number(right.pack.cost === "zero") - Number(left.pack.cost === "zero") ||
          right.covers.length - left.covers.length ||
          left.pack.capabilities.length - right.pack.capabilities.length ||
          left.pack.id.localeCompare(right.pack.id)
        );
      if (candidates.length === 0) break;
      const winner = candidates[0];
      selected.push(winner.pack);
      for (const capability of winner.covers) remaining.delete(capability);
    }
    return {
      ok: remaining.size === 0,
      selected_pack_ids: selected.map((pack) => pack.id),
      unresolved_capabilities: [...remaining]
    };
  }

  plan(packId) {
    const pack = this.pack(packId);
    return {
      schema: "hermesproof.capability-pack-plan.v1",
      pack_id: pack.id,
      namespace: pack.namespace,
      sandbox_path: path.join(this.workspaceRoot, ".hermes3d_orchestrator", "capability-packs", pack.id, pack.version),
      source: { ...clone(pack.source), version: pack.version },
      permissions: [...pack.permissions],
      health_probe: clone(pack.health_probe),
      global_install: false,
      enabled_after_install: false,
      rollback: clone(pack.rollback)
    };
  }

  async install({ packId, apply = false } = {}) {
    const pack = this.pack(packId);
    const plan = this.plan(packId);
    if (!apply) return { ok: true, status: "planned", plan };
    if (typeof this.installer !== "function") {
      throw new Error("No capability-pack installer is configured; apply is fail-closed");
    }
    const receipt = await this.installer({ pack: clone(pack), plan: clone(plan) });
    const verified = this.verifyReceipt(pack, receipt);
    if (!verified.ok) {
      this.upsert({ pack_id: pack.id, version: pack.version, status: "quarantined", enabled: false, receipt: clone(receipt) });
      await this.persist();
      return { ok: false, status: "quarantined", enabled: false, mismatches: verified.mismatches };
    }
    this.upsert({ pack_id: pack.id, version: pack.version, status: "installed", enabled: false, receipt: clone(receipt) });
    await this.persist();
    return { ok: true, status: "installed", enabled: false, receipt: clone(receipt), plan };
  }

  verifyReceipt(pack, receipt = {}) {
    const expected = {
      schema_sha256: pack.schema_sha256,
      package_integrity: pack.source.integrity
    };
    if (pack.executable_sha256 !== null) {
      expected.executable_sha256 = pack.executable_sha256;
    }
    const mismatches = Object.entries(expected)
      .filter(([key, value]) => receipt[key] !== value)
      .map(([key]) => key);
    if (pack.executable_sha256 === null &&
        !/^[a-f0-9]{64}$/i.test(receipt.executable_sha256 || "")) {
      mismatches.push("executable_sha256");
    }
    if (pack.sbom?.generated_at_install === true &&
        !/^[a-f0-9]{64}$/i.test(receipt.sbom_sha256 || "")) {
      mismatches.push("sbom_sha256");
    }
    return { ok: mismatches.length === 0, mismatches };
  }

  upsert(record) {
    const existing = this.state.installed.find((item) => item.pack_id === record.pack_id);
    if (existing) Object.assign(existing, record);
    else this.state.installed.push(record);
  }

  async verifyInstalled(packId, receipt) {
    const pack = this.pack(packId);
    const result = this.verifyReceipt(pack, receipt);
    const existing = this.state.installed.find((item) => item.pack_id === packId) ||
      { pack_id: pack.id, version: pack.version };
    existing.receipt = clone(receipt);
    existing.enabled = false;
    existing.status = result.ok ? "installed" : "quarantined";
    this.upsert(existing);
    await this.persist();
    return { ok: result.ok, status: existing.status, mismatches: result.mismatches };
  }
}
