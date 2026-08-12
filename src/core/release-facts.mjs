import fs from "node:fs/promises";
import path from "node:path";

export const RELEASE_FACTS_SCHEMA = "hermesproof.release-facts.v1";

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SERENA_VERSION_RE = /^\d+\.\d+\.\d+(?:\.dev\d+)?$/;
const REF_RE = /^refs\/heads\/[0-9A-Za-z._/-]+$/;
const SERVER_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function requiredString(value, field, pattern) {
  if (typeof value !== "string" || !value.trim() || (pattern && !pattern.test(value))) {
    throw new Error(field + " is invalid");
  }
  return value;
}

function positiveInteger(value, field, { allowZero = false } = {}) {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(field + " must be an integer >= " + minimum);
  }
  return value;
}

function exactGitLabUrl(value, field) {
  requiredString(value, field);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(field + " is invalid");
  }
  if (url.protocol !== "https:" || url.hostname !== "gitlab.com" || url.username || url.password || url.search || url.hash) {
    throw new Error(field + " must be a credential-free https://gitlab.com URL");
  }
  return value.replace(/\/$/, "");
}

function exactGitLabPagesUrl(value, field) {
  requiredString(value, field);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(field + " is invalid");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".gitlab.io") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(field + " must be a credential-free https://*.gitlab.io URL");
  }
  return value.replace(/\/$/, "");
}

function exactGitHubUrl(value, field, expectedPath) {
  requiredString(value, field);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(field + " is invalid");
  }
  const normalizedPath = url.pathname.replace(/\/$/, "");
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    normalizedPath !== expectedPath ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(field + " must be the credential-free HermesProof GitHub URL");
  }
  return value.replace(/\/$/, "");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function stringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(field + " must be a non-empty string array");
  }
  if (new Set(value).size !== value.length) throw new Error(field + " contains duplicates");
  return value;
}

function localUrl(value, field, allowedPort) {
  requiredString(value, field);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(field + " is invalid");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== String(allowedPort)) {
    throw new Error(field + " must use the approved loopback endpoint");
  }
}

export function validateReleaseFacts(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("release facts must be an object");
  }
  if (input.schema !== RELEASE_FACTS_SCHEMA) throw new Error("schema is invalid");
  requiredString(input.version, "version", VERSION_RE);
  if (input.releaseTag !== "v" + input.version) throw new Error("releaseTag must equal v + version");
  exactGitLabUrl(input.gitlab?.projectUrl, "gitlab.projectUrl");
  exactGitLabPagesUrl(input.gitlab?.pagesUrl, "gitlab.pagesUrl");
  if (input.gitlab.apiProject !== "Ghenghis%2FHermesProof") throw new Error("gitlab.apiProject is invalid");
  exactGitHubUrl(input.github?.projectUrl, "github.projectUrl", "/Ghenghis/HermesProof");
  exactGitHubUrl(input.github?.releasesUrl, "github.releasesUrl", "/Ghenghis/HermesProof/releases");
  if (input.github.apiRepo !== "Ghenghis/HermesProof") throw new Error("github.apiRepo is invalid");
  requiredString(input.channels?.stable, "channels.stable", REF_RE);
  requiredString(input.channels?.preview, "channels.preview", REF_RE);
  if (input.channels.stable !== "refs/heads/main") throw new Error("channels.stable must target main");
  requiredString(input.servers?.core?.name, "servers.core.name", SERVER_RE);
  positiveInteger(input.servers?.core?.tools, "servers.core.tools");
  requiredString(input.servers?.composite?.name, "servers.composite.name", SERVER_RE);
  positiveInteger(input.servers?.composite?.tools, "servers.composite.tools");
  requiredString(input.serena?.version, "serena.version", SERENA_VERSION_RE);
  positiveInteger(input.serena?.cataloguedTools, "serena.cataloguedTools");
  positiveInteger(input.serena?.desktopActiveTools, "serena.desktopActiveTools");
  positiveInteger(input.serena?.governedLspTools, "serena.governedLspTools");
  positiveInteger(input.serena?.rawMutationTools, "serena.rawMutationTools", { allowZero: true });
  if (input.serena.desktopActiveTools > input.serena.cataloguedTools) {
    throw new Error("serena.desktopActiveTools cannot exceed cataloguedTools");
  }
  positiveInteger(input.truthGates, "truthGates");
  positiveInteger(input.nodeMinimum, "nodeMinimum");
  stringArray(input.install?.defaultTargets, "install.defaultTargets");
  stringArray(input.install?.nativeMcpHosts, "install.nativeMcpHosts");
  for (const host of input.install.nativeMcpHosts) {
    if (!input.install.defaultTargets.includes(host)) throw new Error("install.nativeMcpHosts must be default targets");
  }
  if (input.localModels?.preferred?.id !== "lm-studio-lm-link") throw new Error("localModels.preferred.id is invalid");
  localUrl(input.localModels.preferred.baseUrl, "localModels.preferred.baseUrl", 1234);
  stringArray(input.localModels.preferred.statusCommand, "localModels.preferred.statusCommand");
  if (input.localModels?.fallback?.id !== "ollama") throw new Error("localModels.fallback.id is invalid");
  localUrl(input.localModels.fallback.baseUrl, "localModels.fallback.baseUrl", 11434);
  localUrl(input.localModels.fallback.statusUrl, "localModels.fallback.statusUrl", 11434);
  stringArray(input.capabilityProfiles, "capabilityProfiles");
  return deepFreeze(structuredClone(input));
}

export async function loadReleaseFacts({ root = process.cwd() } = {}) {
  const file = path.join(path.resolve(root), "config", "release-facts.json");
  const raw = await fs.readFile(file, "utf8");
  return validateReleaseFacts(JSON.parse(raw));
}
