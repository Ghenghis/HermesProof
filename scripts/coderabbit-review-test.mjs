import test from "node:test";
import assert from "node:assert/strict";
import {
  detectBotComments,
  parseRemoteUrl,
  runCoderabbitReviewGate
} from "./coderabbit-review.mjs";

test("detectBotComments matches `coderabbitai[bot]` exactly", () => {
  const comments = [
    { user: { login: "coderabbitai[bot]" }, html_url: "u1" },
    { user: { login: "humanReviewer" }, html_url: "u2" }
  ];
  const hits = detectBotComments(comments, "coderabbitai");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].html_url, "u1");
});

test("detectBotComments accepts bare login (no [bot] suffix)", () => {
  const comments = [
    { user: { login: "coderabbitai" } },
    { user: { login: "someone-else" } }
  ];
  assert.equal(detectBotComments(comments, "coderabbitai").length, 1);
});

test("detectBotComments is case-insensitive on login", () => {
  const comments = [{ user: { login: "CodeRabbitAI[bot]" } }];
  assert.equal(detectBotComments(comments, "coderabbitai").length, 1);
});

test("detectBotComments tolerates malformed entries", () => {
  const comments = [{}, { user: null }, { user: { login: null } }];
  assert.deepEqual(detectBotComments(comments, "coderabbitai"), []);
});

test("parseRemoteUrl handles SSH and HTTPS variants", () => {
  assert.deepEqual(
    parseRemoteUrl("git@github.com:Ghenghis/HermesProof.git"),
    { owner: "Ghenghis", repo: "HermesProof" }
  );
  assert.deepEqual(
    parseRemoteUrl("https://github.com/Ghenghis/HermesProof.git"),
    { owner: "Ghenghis", repo: "HermesProof" }
  );
  assert.deepEqual(
    parseRemoteUrl("https://github.com/Ghenghis/HermesProof"),
    { owner: "Ghenghis", repo: "HermesProof" }
  );
});

test("parseRemoteUrl returns null on garbage", () => {
  assert.equal(parseRemoteUrl(""), null);
  assert.equal(parseRemoteUrl("not-a-url"), null);
});

test("runCoderabbitReviewGate skips when token missing", async () => {
  const r = await runCoderabbitReviewGate({
    owner: "x", repo: "y", pr: 1
    // no token
  });
  assert.equal(r.ok, true);
  assert.equal(r.skip, true);
  assert.match(r.details, /no GitHub token/i);
});

test("runCoderabbitReviewGate skips when PR coordinates missing", async () => {
  const r = await runCoderabbitReviewGate({ token: "t" });
  assert.equal(r.ok, true);
  assert.equal(r.skip, true);
  assert.match(r.details, /no PR context/i);
});

test("runCoderabbitReviewGate passes when injected fetcher returns a bot comment", async () => {
  const r = await runCoderabbitReviewGate({
    owner: "Ghenghis",
    repo: "HermesProof",
    pr: 42,
    token: "fake",
    fetchIssueComments: async () => [
      { user: { login: "coderabbitai[bot]" }, html_url: "u" }
    ],
    fetchReviewComments: async () => []
  });
  assert.equal(r.ok, true);
  assert.equal(r.skip, false);
  assert.equal(r.evidence.issue_hits, 1);
  assert.equal(r.evidence.review_hits, 0);
});

test("runCoderabbitReviewGate fails when no bot comments anywhere", async () => {
  const r = await runCoderabbitReviewGate({
    owner: "Ghenghis", repo: "HermesProof", pr: 42, token: "fake",
    fetchIssueComments: async () => [{ user: { login: "human" } }],
    fetchReviewComments: async () => []
  });
  assert.equal(r.ok, false);
  assert.equal(r.skip, false);
});

test("runCoderabbitReviewGate becomes skip on ENETWORK", async () => {
  const r = await runCoderabbitReviewGate({
    owner: "Ghenghis", repo: "HermesProof", pr: 42, token: "fake",
    fetchIssueComments: async () => {
      const err = new Error("offline");
      err.code = "ENETWORK";
      throw err;
    }
  });
  assert.equal(r.ok, true);
  assert.equal(r.skip, true);
  assert.match(r.details, /network unavailable/i);
});

test("runCoderabbitReviewGate fails (not skip) on hard API errors", async () => {
  const r = await runCoderabbitReviewGate({
    owner: "Ghenghis", repo: "HermesProof", pr: 42, token: "fake",
    fetchIssueComments: async () => { throw new Error("400 Bad Request"); }
  });
  assert.equal(r.ok, false);
  assert.equal(r.skip, false);
});
