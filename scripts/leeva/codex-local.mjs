#!/usr/bin/env node
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const HELP = `Create a new Paperclip agent using this machine's Codex CLI.

Usage:
  node scripts/leeva/codex-local.mjs --company <uuid> --cwd <git-worktree> [options]

Options:
  --base-url <origin>  Local Paperclip origin (default http://127.0.0.1:3100)
  --company <uuid>     Existing company ID; never creates a company
  --cwd <directory>    Existing Git working tree on the Paperclip host (required)
  --command <path>     Codex executable, or a command name to find on PATH
  --name <name>        New agent name (default Codex 本机)
  --model <id>         Optional model ID; otherwise use the local Codex default
  --dry-run           Print the request without contacting Paperclip (default)
  --apply             Check existing agents, then create once through the API
  --help              Show this help

Requires Node 24.11+, Git, a logged-in Codex CLI, and local_trusted Paperclip
running as the same OS user. Only loopback origins are accepted. No credentials
are read or copied by this tool. It never starts a task or modifies Chief.
Reasoning is low; sandbox bypass, timer heartbeats, and on-demand wakes are off.
--apply does not perform a model/hello call. Use the UI Test button separately.
`;

export function parseOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      "base-url": { type: "string", default: "http://127.0.0.1:3100" },
      company: { type: "string" },
      cwd: { type: "string" },
      command: { type: "string", default: "codex" },
      name: { type: "string", default: "Codex 本机" },
      model: { type: "string" },
      "dry-run": { type: "boolean" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.apply && values["dry-run"]) throw new Error("Choose --apply or --dry-run, not both.");
  return values;
}

export function validateBaseUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("--base-url must be a loopback HTTP(S) origin without credentials, path, query, or fragment.");
  }
  return url.origin;
}

export function resolveCommand(command, searchPath = process.env.PATH ?? "") {
  if (!command || command.includes("\0")) throw new Error("Invalid --command.");
  const candidates = command.includes(path.sep)
    ? [path.resolve(command)]
    : searchPath.split(path.delimiter).filter(Boolean).map((directory) => path.resolve(directory, command));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* Try the next PATH entry without running the executable. */ }
  }
  throw new Error("Codex executable was not found. Install/login to Codex, or pass --command with its executable path.");
}

export function resolveWorktree(directory) {
  if (!directory) throw new Error("--cwd is required; choose an existing Git working tree.");
  const resolved = realpathSync(path.resolve(directory));
  if (!statSync(resolved).isDirectory()) throw new Error("--cwd must be a directory.");
  try {
    const output = execFileSync("git", ["-C", resolved, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000,
    });
    if (output.trim() === "true") return resolved;
  } catch { /* Report the actionable requirement without dumping Git stderr. */ }
  throw new Error("--cwd must be inside a Git working tree. This tool does not create or initialize repositories.");
}

const normalizedName = (value) => value.trim().normalize("NFC").toLocaleLowerCase("en-US");

export function buildPlan(options) {
  const baseUrl = validateBaseUrl(options["base-url"]);
  const company = options.company?.toLowerCase();
  if (!company || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(company)) {
    throw new Error("--company must be an existing company UUID.");
  }
  const name = options.name.trim();
  if (!name || name.length > 160) throw new Error("--name must contain 1–160 characters.");
  if (options.model !== undefined && !options.model.trim()) throw new Error("--model cannot be empty.");
  const key = createHash("sha256").update(`${company}\n${normalizedName(name)}`).digest("hex");
  return {
    baseUrl,
    endpoint: `/api/companies/${company}/agents`,
    payload: {
      name,
      role: "general",
      adapterType: "codex_local",
      adapterConfig: {
        engine: "cli",
        command: resolveCommand(options.command),
        cwd: resolveWorktree(options.cwd),
        modelReasoningEffort: "low",
        dangerouslyBypassApprovalsAndSandbox: false,
        ...(options.model ? { model: options.model.trim() } : {}),
      },
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false, maxConcurrentRuns: 1 } },
      defaultEnvironmentId: null,
      metadata: { leevaLocalCodex: { version: 1, key } },
    },
  };
}

export class ApiError extends Error {
  constructor(status, message) {
    super(`Paperclip HTTP ${status}: ${message}`);
    this.status = status;
  }
}

export function createApi(baseUrl, fetchImpl = fetch) {
  return async function request(method, endpoint, body) {
    const response = await fetchImpl(new URL(endpoint, baseUrl), {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error.slice(0, 1000) : response.statusText;
      throw new ApiError(response.status, message);
    }
    if (!data || typeof data !== "object") throw new Error("Paperclip returned an unexpected response; inspect the UI before retrying.");
    return data;
  };
}

function assertMatches(agent, expected) {
  const config = agent.adapterConfig ?? {};
  const runtime = agent.runtimeConfig ?? {};
  const matches = agent.metadata?.leevaLocalCodex?.key === expected.metadata.leevaLocalCodex.key
    && agent.metadata?.leevaLocalCodex?.version === 1
    && agent.adapterType === expected.adapterType
    && agent.role === expected.role
    && normalizedName(agent.name ?? "") === normalizedName(expected.name)
    && agent.defaultEnvironmentId === null
    && !runtime.aiConnection
    && Object.entries(expected.adapterConfig).every(([key, value]) => config[key] === value)
    && (config.model ?? "") === (expected.adapterConfig.model ?? "")
    && Object.keys(config.env ?? {}).length === 0
    && !(config.args?.length || config.extraArgs?.length)
    && Object.entries(expected.runtimeConfig.heartbeat).every(([key, value]) => runtime.heartbeat?.[key] === value);
  if (!matches) throw new Error("An agent with this name/key already exists but its settings differ. Inspect it in Paperclip; this tool will not overwrite or duplicate it.");
  if (typeof agent.id !== "string" || !agent.id) throw new Error("Paperclip agent response has no ID; inspect the UI before retrying.");
  return agent;
}

export function findExisting(agents, expected) {
  if (!Array.isArray(agents)) throw new Error("Expected the official agents list; refusing to create without a complete duplicate check.");
  const matches = agents.filter((agent) => normalizedName(agent.name ?? "") === normalizedName(expected.name)
    || agent.metadata?.leevaLocalCodex?.key === expected.metadata.leevaLocalCodex.key);
  if (matches.length > 1) throw new Error("Multiple matching agents exist; resolve them in Paperclip before applying again.");
  return matches.length ? assertMatches(matches[0], expected) : null;
}

export async function applyPlan(plan, request = createApi(plan.baseUrl)) {
  // No POST retries: a lost response can mean the server already committed.
  const existing = findExisting(await request("GET", plan.endpoint), plan.payload);
  if (existing) return { status: "already-exists", id: existing.id, name: existing.name };
  let created;
  try {
    created = await request("POST", plan.endpoint, plan.payload);
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
    try {
      const recovered = findExisting(await request("GET", plan.endpoint), plan.payload);
      if (recovered) return { status: "created-response-recovered", id: recovered.id, name: recovered.name };
    } catch { /* Preserve uncertainty; never turn a failed read into another POST. */ }
    throw new Error("Create outcome is unknown. No POST was retried. Inspect the company agents in Paperclip before running --apply again.");
  }
  assertMatches(created, plan.payload);
  const verified = assertMatches(await request("GET", `/api/agents/${encodeURIComponent(created.id)}`), plan.payload);
  return { status: "created-and-read-back", id: verified.id, name: verified.name };
}

export async function main(argv = process.argv.slice(2), { out = console.log, request } = {}) {
  const options = parseOptions(argv);
  if (options.help) { out(HELP); return; }
  const plan = buildPlan(options);
  if (!options.apply) {
    out(JSON.stringify({ mode: "dry-run", method: "POST", url: `${plan.baseUrl}${plan.endpoint}`, body: plan.payload }, null, 2));
    return;
  }
  out(JSON.stringify(await applyPlan(plan, request), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
