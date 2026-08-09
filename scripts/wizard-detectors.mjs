import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const CLIENT_IDS = [
  "claude-desktop",
  "claude-code",
  "codex",
  "windsurf",
  "kilocode",
  "lm-studio",
  "ollama",
  "devin",
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
    claudeUserConfig: path.join(homeDir, ".claude.json"),
    claudeUserSettings: path.join(homeDir, ".claude", "settings.json"),
    claudeHooksSidecar: path.join(homeDir, ".claude", "settings.hermesproof.hooks.json"),
    codex: path.join(homeDir, ".codex", "config.toml"),
    windsurf: path.join(homeDir, ".codeium", "windsurf", "mcp_config.json"),
    windsurfRules: workspaceRoot ? path.join(workspaceRoot, ".windsurfrules") : path.join(homeDir, ".windsurfrules"),
    kilocodeDir: workspaceRoot ? path.join(workspaceRoot, ".kilo") : path.join(homeDir, ".config", "kilo"),
    kilocodeMcp: workspaceRoot ? path.join(workspaceRoot, ".kilo", "kilo.json") : path.join(homeDir, ".config", "kilo", "kilo.json"),
    kilocodeRules: workspaceRoot ? path.join(workspaceRoot, ".kilo", "hermesproof", "rules.toml") : path.join(homeDir, ".config", "kilo", "hermesproof", "rules.toml"),
    kilocodePrompt: workspaceRoot ? path.join(workspaceRoot, ".kilo", "hermesproof", "system-prompt-snippet.md") : path.join(homeDir, ".config", "kilo", "hermesproof", "system-prompt-snippet.md"),
    lmStudioMcp: path.join(homeDir, ".lmstudio", "mcp.json"),
    localModelProviders: workspaceRoot ? path.join(workspaceRoot, ".hermesproof", "local-models.json") : path.join(homeDir, ".hermesproof", "local-models.json"),
    devinExport: workspaceRoot ? path.join(workspaceRoot, ".hermesproof", "devin", "mcp-install.json") : path.join(homeDir, ".hermesproof", "devin", "mcp-install.json"),
    cursorDir: workspaceRoot ? path.join(workspaceRoot, ".cursor") : path.join(homeDir, ".cursor"),
    cursorMcp: workspaceRoot ? path.join(workspaceRoot, ".cursor", "mcp.json") : path.join(homeDir, ".cursor", "mcp.json"),
    cursorRulesDir: workspaceRoot ? path.join(workspaceRoot, ".cursor", "rules") : path.join(homeDir, ".cursor", "rules"),
    cursorHermesRule: workspaceRoot ? path.join(workspaceRoot, ".cursor", "rules", "hermesproof.mdc") : path.join(homeDir, ".cursor", "rules", "hermesproof.mdc"),
    cursorQueueRule: workspaceRoot ? path.join(workspaceRoot, ".cursor", "rules", "hermesproof-queue-discipline.mdc") : path.join(homeDir, ".cursor", "rules", "hermesproof-queue-discipline.mdc"),
    cursorStreamRule: workspaceRoot ? path.join(workspaceRoot, ".cursor", "rules", "stream.mdc") : path.join(homeDir, ".cursor", "rules", "stream.mdc"),
    vscodeDir: workspaceRoot ? path.join(workspaceRoot, ".vscode") : path.join(homeDir, ".vscode"),
    vscodeMcp: workspaceRoot ? path.join(workspaceRoot, ".vscode", "mcp.json") : path.join(homeDir, ".vscode", "mcp.json"),
    vscodeInstructions: workspaceRoot ? path.join(workspaceRoot, ".github", "copilot-instructions.md") : path.join(homeDir, ".github", "copilot-instructions.md"),
    anthropicDir: workspaceRoot ? path.join(workspaceRoot, ".hermesproof") : path.join(homeDir, ".hermesproof")
  };
}

export async function detectClients({ workspaceRoot, env = process.env, homeDir = resolveHome(env) } = {}) {
  const paths = clientPaths({ workspaceRoot, env, homeDir });
  const claudeCode = commandVersion(process.platform === "win32" ? "claude.exe" : "claude");
  const code = commandVersion(process.platform === "win32" ? "code.cmd" : "code");
  const kilo = commandVersion(process.platform === "win32" ? "kilo.exe" : "kilo");
  const lms = commandVersion(process.platform === "win32" ? "lms.exe" : "lms");
  const ollama = commandVersion(process.platform === "win32" ? "ollama.exe" : "ollama");
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
      configPath: paths.claudeUserConfig
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
    kilocode: {
      id: "kilocode",
      label: "Kilo Code (VS Code / CLI / JetBrains)",
      detected: kilo.detected || code.detected || await exists(paths.kilocodeDir),
      version: kilo.version,
      configPath: paths.kilocodeMcp
    },
    "lm-studio": {
      id: "lm-studio",
      label: "LM Studio / LM Link",
      detected: lms.detected || await exists(path.dirname(paths.lmStudioMcp)),
      version: lms.version,
      configPath: paths.lmStudioMcp
    },
    ollama: {
      id: "ollama",
      label: "Ollama local-model fallback",
      detected: ollama.detected,
      version: ollama.version,
      configPath: paths.localModelProviders
    },
    devin: {
      id: "devin",
      label: "Devin Add Your Own MCP export",
      detected: Boolean(env.DEVIN_API_KEY || env.DEVIN_TOKEN),
      configPath: paths.devinExport
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
