import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RELEASE_FACTS_SCHEMA,
  loadReleaseFacts,
  validateReleaseFacts
} from "./release-facts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("release facts load the supported stable dual-remote product contract", async () => {
  const facts = await loadReleaseFacts({ root });
  assert.equal(facts.schema, RELEASE_FACTS_SCHEMA);
  assert.equal(facts.version, "0.9.0");
  assert.equal(facts.gitlab.projectUrl, "https://gitlab.com/Ghenghis/HermesProof");
  assert.deepEqual(facts.github, {
    projectUrl: "https://github.com/Ghenghis/HermesProof",
    releasesUrl: "https://github.com/Ghenghis/HermesProof/releases",
    apiRepo: "Ghenghis/HermesProof"
  });
  assert.deepEqual(facts.channels, {
    stable: "refs/heads/main",
    preview: "refs/heads/release/hp-mha-serena-shippable"
  });
  assert.deepEqual(facts.servers, {
    core: { name: "hermes3d-locks", tools: 121 },
    composite: { name: "hp-mha-serena", tools: 34 }
  });
  assert.deepEqual(facts.serena, {
    version: "1.7.0",
    cataloguedTools: 52,
    desktopActiveTools: 29,
    governedLspTools: 15,
    rawMutationTools: 0
  });
  assert.equal(facts.truthGates, 37);
  assert.ok(facts.install.defaultTargets.includes("kilocode"));
  assert.ok(facts.install.nativeMcpHosts.includes("lm-studio"));
  assert.equal(facts.localModels.preferred.id, "lm-studio-lm-link");
  assert.equal(facts.localModels.fallback.id, "ollama");
  assert.ok(facts.capabilityProfiles.includes("reverse-engineering-local"));
});

test("release facts reject unsafe remotes, refs, versions, and counts", () => {
  const base = {
    schema: RELEASE_FACTS_SCHEMA,
    version: "0.9.0",
    releaseTag: "v0.9.0",
    gitlab: {
      projectUrl: "https://gitlab.com/Ghenghis/HermesProof",
      pagesUrl: "https://ghenghis.gitlab.io/HermesProof",
      apiProject: "Ghenghis%2FHermesProof"
    },
    github: {
      projectUrl: "https://github.com/Ghenghis/HermesProof",
      releasesUrl: "https://github.com/Ghenghis/HermesProof/releases",
      apiRepo: "Ghenghis/HermesProof"
    },
    channels: {
      stable: "refs/heads/main",
      preview: "refs/heads/release/hp-mha-serena-shippable"
    },
    servers: {
      core: { name: "hermes3d-locks", tools: 121 },
      composite: { name: "hp-mha-serena", tools: 34 }
    },
    serena: {
      version: "1.7.0",
      cataloguedTools: 52,
      desktopActiveTools: 29,
      governedLspTools: 15,
      rawMutationTools: 0
    },
    truthGates: 37,
    nodeMinimum: 20,
    install: {
      defaultTargets: ["kilocode", "lm-studio", "ollama"],
      nativeMcpHosts: ["kilocode", "lm-studio"]
    },
    localModels: {
      preferred: {
        id: "lm-studio-lm-link",
        baseUrl: "http://127.0.0.1:1234/v1",
        statusCommand: ["lms", "link", "status", "--json"]
      },
      fallback: {
        id: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        statusUrl: "http://127.0.0.1:11434/api/tags"
      }
    },
    capabilityProfiles: ["backend-default", "reverse-engineering-local"]
  };

  assert.throws(
    () => validateReleaseFacts({ ...base, gitlab: { ...base.gitlab, projectUrl: "http://evil.invalid/repo" } }),
    /gitlab\.projectUrl/
  );
  assert.throws(
    () => validateReleaseFacts({ ...base, github: { ...base.github, releasesUrl: "https://evil.invalid/releases" } }),
    /github\.releasesUrl/
  );
  assert.throws(
    () => validateReleaseFacts({ ...base, channels: { ...base.channels, stable: "main;calc.exe" } }),
    /channels\.stable/
  );
  assert.throws(
    () => validateReleaseFacts({ ...base, version: "latest" }),
    /version/
  );
  assert.throws(
    () => validateReleaseFacts({ ...base, servers: { ...base.servers, core: { ...base.servers.core, tools: 0 } } }),
    /servers\.core\.tools/
  );
});

test("loaded release facts are deeply frozen", async () => {
  const facts = await loadReleaseFacts({ root });
  assert.equal(Object.isFrozen(facts), true);
  assert.equal(Object.isFrozen(facts.servers), true);
  assert.throws(() => {
    facts.servers.core.tools = 1;
  }, TypeError);
});
