import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  LMSTUDIO_DEFAULT,
  probeUrl,
  runLmstudioHealth
} from "./local-providers-health.mjs";

test("LM Studio defaults to the IPv4 loopback address used by its Windows server", () => {
  assert.equal(LMSTUDIO_DEFAULT, "http://127.0.0.1:1234/v1/models");
});

test("LM Studio health accepts a live IPv4 models endpoint", async (t) => {
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/v1/models");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "local-test-model" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const address = server.address();
  const result = await runLmstudioHealth({
    baseUrl: `http://127.0.0.1:${address.port}/v1/models`,
    timeoutMs: 1_000
  });

  assert.equal(result.ok, true);
  assert.equal(result.evidence.status, 200);
  assert.match(result.details, /reachable/);
});

test("provider probe remains fail-closed when the endpoint is unreachable", async () => {
  const result = await probeUrl("http://127.0.0.1:1/v1/models", { timeoutMs: 250 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.ok(result.error);
});
