import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  ApiError, applyPlan, buildPlan, createApi, findExisting, main, parseOptions,
  resolveCommand, resolveWorktree, validateBaseUrl,
} from "./codex-local.mjs";

const COMPANY = "00000000-0000-0000-0000-000000000001";
const AGENT = "00000000-0000-0000-0000-000000000002";
const scratch = mkdtempSync(path.join(os.tmpdir(), "paperclip-codex-local-test-"));
const repo = path.join(scratch, "worktree");
mkdirSync(repo);
execFileSync("git", ["init", "--quiet", repo]);
const executable = path.join(scratch, "codex");
writeFileSync(executable, "#!/bin/sh\nexit 99\n");
chmodSync(executable, 0o700);
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const options = () => parseOptions(["--company", COMPANY, "--cwd", repo, "--command", executable]);
const plan = () => buildPlan(options());
const agent = (payload) => ({ ...structuredClone(payload), id: AGENT, status: "idle" });

test("safe defaults do not carry a login binding or machine-specific account data", () => {
  const { payload } = plan();
  assert.equal(payload.adapterType, "codex_local");
  assert.equal(payload.adapterConfig.engine, "cli");
  assert.equal(payload.adapterConfig.modelReasoningEffort, "low");
  assert.equal(payload.adapterConfig.dangerouslyBypassApprovalsAndSandbox, false);
  assert.equal(payload.runtimeConfig.heartbeat.enabled, false);
  assert.equal(payload.runtimeConfig.heartbeat.wakeOnDemand, false);
  assert.equal(payload.defaultEnvironmentId, null);
  assert.ok(!("aiConnection" in payload.runtimeConfig));
  assert.ok(!("env" in payload.adapterConfig));
  assert.ok(!("model" in payload.adapterConfig));
});

test("dry-run is offline and executable discovery never invokes Codex", async () => {
  const output = [];
  await main(["--company", COMPANY, "--cwd", repo, "--command", executable], {
    out: (value) => output.push(value),
    request: () => assert.fail("dry-run made an API request"),
  });
  assert.equal(JSON.parse(output[0]).mode, "dry-run");
  assert.equal(resolveCommand("codex", scratch), executable);
  assert.throws(() => resolveCommand("missing", scratch), /not found/);
});

test("requires a real worktree and valid company, rejects conflicting/unknown flags", () => {
  assert.equal(resolveWorktree(repo), realpathSync(repo));
  assert.throws(() => resolveWorktree(scratch), /Git working tree/);
  assert.throws(() => resolveWorktree(undefined), /required/);
  assert.throws(() => buildPlan({ ...options(), company: "../another-company" }), /UUID/);
  assert.throws(() => parseOptions(["--apply", "--dry-run"]), /not both/);
  assert.throws(() => parseOptions(["--force"]), /Unknown option/);
});

test("only clean loopback origins are accepted", () => {
  for (const value of ["http://127.0.0.1:3100", "http://localhost:3100/", "https://[::1]:3100"]) {
    assert.ok(validateBaseUrl(value));
  }
  for (const value of ["http://example.com", "https://example.com", "http://127.0.0.1.evil.test",
    "http://user:password@localhost:3100", "http://localhost:3100/api", "http://localhost:3100/?token=secret",
    "http://localhost:3100/#fragment", "file:///tmp/app"]) {
    assert.throws(() => validateBaseUrl(value), /loopback/);
  }
});

test("new agent is created once, read back, and never assigned or awakened", async () => {
  const selected = plan();
  const calls = [];
  const result = await applyPlan(selected, async (method, endpoint, body) => {
    calls.push([method, endpoint]);
    if (method === "POST") return agent(body);
    return endpoint === selected.endpoint ? [] : agent(selected.payload);
  });
  assert.equal(result.status, "created-and-read-back");
  assert.deepEqual(calls, [["GET", selected.endpoint], ["POST", selected.endpoint], ["GET", `/api/agents/${AGENT}`]]);
});

test("an unchanged tool-created agent is reused without mutations", async () => {
  const selected = plan();
  const result = await applyPlan(selected, async (method) => {
    assert.equal(method, "GET");
    return [agent(selected.payload)];
  });
  assert.equal(result.status, "already-exists");
});

test("name conflicts, altered login/settings, and duplicate keys fail closed", () => {
  const expected = plan().payload;
  const changed = (modify) => { const row = agent(expected); modify(row); return row; };
  for (const row of [
    changed((row) => { delete row.metadata; }),
    changed((row) => { row.runtimeConfig.aiConnection = { mode: "responsible_user" }; }),
    changed((row) => { row.runtimeConfig.heartbeat.enabled = true; }),
    changed((row) => { row.adapterConfig.dangerouslyBypassApprovalsAndSandbox = true; }),
    changed((row) => { row.adapterConfig.env = { CODEX_HOME: "another-home" }; }),
    changed((row) => { row.adapterConfig.extraArgs = ["--yolo"]; }),
  ]) assert.throws(() => findExisting([row], expected), /settings differ/);
  assert.throws(() => findExisting([agent(expected), agent(expected)], expected), /Multiple/);
  assert.throws(() => findExisting({ items: [] }, expected), /agents list/);
});

test("approval/auth rejection stays authoritative and is never retried", async () => {
  for (const status of [401, 403, 409, 422]) {
    let posts = 0;
    const failure = new ApiError(status, "Official approval or sign-in required");
    await assert.rejects(applyPlan(plan(), async (method) => {
      if (method === "GET") return [];
      posts++;
      throw failure;
    }), (error) => error === failure);
    assert.equal(posts, 1);
  }
});

test("lost create response is reconciled by GET, never a second POST", async () => {
  const selected = plan();
  let posts = 0;
  const result = await applyPlan(selected, async (method) => {
    if (method === "POST") { posts++; throw new TypeError("connection lost"); }
    return posts ? [agent(selected.payload)] : [];
  });
  assert.equal(result.status, "created-response-recovered");
  assert.equal(posts, 1);
});

test("unknown create outcome stops instead of declaring success or retrying", async () => {
  let posts = 0;
  await assert.rejects(applyPlan(plan(), async (method) => {
    if (method === "GET") return [];
    posts++;
    throw new ApiError(503, "temporarily unavailable");
  }), /outcome is unknown/);
  assert.equal(posts, 1);
});

test("HTTP client refuses redirects and retains official error status/message", async () => {
  const request = createApi("http://127.0.0.1:3100", async (url, init) => {
    assert.equal(url.origin, "http://127.0.0.1:3100");
    assert.equal(init.redirect, "error");
    assert.ok(!("Authorization" in init.headers));
    return new Response(JSON.stringify({ error: "Use the official hire approval flow." }), { status: 409 });
  });
  await assert.rejects(request("POST", "/api/companies/example/agents", {}), (error) =>
    error instanceof ApiError && error.status === 409 && /hire approval/.test(error.message));
});
