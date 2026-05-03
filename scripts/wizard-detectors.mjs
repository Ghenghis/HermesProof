import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const CLIENT_IDS = [
  "claude-desktop",
  "claude-code",
  "codex",
  "windsurf",
  "cursor",
  "vscode-copilot",
  "anthropic-sdk"
];

export function platformLabel(platform = process.platform) {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform;
}

export function resolveHome(env = process.env) {
  return env.HERMESPROOF_TEST_HOME || env.HOME || env.USERPROFILE || os.homedir();
}

export function clientPaths({ workspaceRoot, homeDir = resolveHome(), env = process.env } = {}) {
  const appData = env.APPDATA || path.join(homeDir, "AppData", "Roaming");
  return {
    claudeDesktop: process.platform === "win32"
      ? path.join(appData, "Claude", "claude_desktop_config.json")
      : process.platform === "darwin"
        ? path.join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json")
        : path.join(homeDir, ".config", "Claude", "claude_desktop_config.json"),
    claudeUserDir: path.join(homeDir, ".claude"),
    claudeUserSettings: path.join(homeDir, ".claude", "settings.json"),
    claudeHooksSidecar: path.join(homeDir, ".claude", "settings.hermesproof.hooks.json"),
    codex: path.join(homeDir, ".codex", "config.toml"),
    windsurf: path.join(homeDir, ".codeium", "windsurf", "mcp_config.json"),
    cursorDir: workspaceRoot ? path.join(workspaceRoot, ".cursor") : path.join(homeDir, ".cursor"),
    cursorMcp: workspaceRoot ? path.join(workspaceRoot, ".cursor", "mcp.json") : path.join(homeDir, ".cursor", "mcp.json"),
    cursorRulesDir: workspaceRoot ? path.join(workspaceRoot, ".cursor", "rules") : path.join(homeDir, ".cursor", "rules"),
    vscodeDir: workspaceRoot ? path.join(workspaceRoot, ".vscode") : path.join(homeDir, ".vscode"),
    vscodeMcp: workspaceRoot ? path.join(workspaceRoot, ".vscode", "mcp.json") : path.join(homeDir, ".vscode", "mcp.json"),
    anthropicDir: workspaceRoot ? path.join(workspaceRoot, ".hermesproof") : path.join(homeDir, ".hermesproof")
  };
}

export async function detectClients({ workspaceRoot, env = process.env, homeDir = resolveHome(env) } = {}) {
  const paths = clientPaths({ workspaceRoot, env, homeDir });
  const claudeCode = commandVersion(process.platform === "win32" ? "claude.exe" : "claude");
  const code = commandVersion(process.platform === "win32" ? "code.cmd" : "code");
  return {
    "claude-desktop": {
      id: "claude-desktop",
      label: "Claude Desktop",
      detected: await exists(path.dirname(paths.claudeDesktop)) || await exists(paths.claudeDesktop),
      configPath: paths.claudeDesktop
    },
    "claude-code": {
      id: "claude-code",
      label: "Claude Code CLI",
      detected: claudeCode.detected,
      version: claudeCode.version,
      configPath: paths.claudeUserSettings
    },
    codex: {
      id: "codex",
      label: "Codex CLI",
      detected: await exists(path.dirname(paths.codex)) || await exists(paths.codex),
      configPath: paths.codex
    },
    windsurf: {
      id: "windsurf",
      label: "Windsurf / Cascade",
      detected: await exists(path.dirname(paths.windsurf)) || await exists(paths.windsurf),
      configPath: paths.windsurf
    },
    cursor: {
      id: "cursor",
      label: "Cursor",
      detected: await exists(paths.cursorDir) || await exists(path.join(homeDir, ".cursor")),
      configPath: paths.cursorMcp
    },
    "vscode-copilot": {
      id: "vscode-copilot",
      label: "VS Code Copilot",
      detected: await exists(paths.vscodeDir) || code.detected,
      version: code.version,
      configPath: paths.vscodeMcp
    },
    "anthropic-sdk": {
      id: "anthropic-sdk",
      label: "Anthropic API / Claude Code SDK",
      detected: Boolean(env.ANTHROPIC_API_KEY),
      configPath: path.join(paths.anthropicDir, "anthropic-sdk-example.mjs")
    }
  };
}

function commandVersion(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", shell: false });
  if (result.error) return { detected: false };
  return {
    detected: result.status === 0,
    version: (result.stdout || result.stderr || "").split(/\r?\n/)[0]?.trim() || undefined
  };
}

async function exists(value) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}
