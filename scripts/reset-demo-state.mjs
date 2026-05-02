import fs from "node:fs/promises";
import path from "node:path";
const workspace = process.env.HERMES3D_WORKSPACE || process.cwd();
const state = path.join(workspace, ".hermes3d_orchestrator");
await fs.rm(state, { recursive: true, force: true });
console.log(`Removed ${state}`);
