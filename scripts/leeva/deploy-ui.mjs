#!/usr/bin/env node
import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const SERVER_VERSION = "2026.1012.0";
const BACKUP_FORMAT = "paperclip-leeva-ui-backup-v1";
const defaultDist = fileURLToPath(new URL("../../ui/dist", import.meta.url));
export const HELP = `Deploy only the built Leeva UI to a matching Paperclip server.

Usage:
  node scripts/leeva/deploy-ui.mjs --server-dir <@paperclipai/server> [--dist <ui/dist>] [--apply]
  node scripts/leeva/deploy-ui.mjs --server-dir <@paperclipai/server> --restore <backup-directory> [--apply]

Default: validate and print the plan without writing anything. --apply replaces
ui-dist after staging and preserves old assets for already-open browser tabs.
A full original UI backup is kept beside ui-dist. --restore verifies that backup
and creates a fresh backup of the current UI before restoring it. Server code,
database, authentication and agent configuration are never changed. Supported
server: @paperclipai/server ${SERVER_VERSION}. Restart/reload is not automatic.
Ancestor install symlinks are resolved once; symlinks within UI trees are refused.
`;

export function parseOptions(args) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    "server-dir": { type: "string" }, dist: { type: "string" }, restore: { type: "string" },
    apply: { type: "boolean", default: false }, "dry-run": { type: "boolean" },
    help: { type: "boolean", default: false },
  } });
  if (values.apply && values["dry-run"]) throw new Error("Choose --apply or --dry-run.");
  if (values.restore && values.dist) throw new Error("Choose --restore or --dist.");
  return values;
}

async function regularFile(filename) {
  if (!(await fs.lstat(filename)).isFile()) throw new Error(`Expected a regular file: ${filename}`);
}

// Hashing the complete tree makes backups verifiable and refuses links/special files.
async function treeDigest(directory) {
  const digest = createHash("sha256");
  async function visit(relative) {
    const filename = path.join(directory, relative);
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink()) throw new Error(`Symlink refused: ${filename}`);
    if (stat.isDirectory()) {
      digest.update(`directory:${JSON.stringify(relative)}\n`);
      for (const name of (await fs.readdir(filename)).sort()) await visit(path.join(relative, name));
    } else if (stat.isFile()) {
      digest.update(`file:${JSON.stringify(relative)}:${stat.size}\n`);
      digest.update(await fs.readFile(filename));
    } else throw new Error(`Special file refused: ${filename}`);
  }
  await visit("");
  await regularFile(path.join(directory, "index.html"));
  if ((await fs.stat(path.join(directory, "index.html"))).size === 0) throw new Error("index.html is empty.");
  return digest.digest("hex");
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function buildPlan(options) {
  if (!options["server-dir"]) throw new Error("--server-dir is required.");
  const server = await fs.realpath(path.resolve(options["server-dir"]));
  await regularFile(path.join(server, "package.json"));
  const pkg = JSON.parse(await fs.readFile(path.join(server, "package.json"), "utf8"));
  if (pkg.name !== "@paperclipai/server" || pkg.version !== SERVER_VERSION) {
    throw new Error(`Expected @paperclipai/server ${SERVER_VERSION}; refusing a different package/version.`);
  }
  const target = path.join(server, "ui-dist");
  const targetHash = await treeDigest(target);
  let source;
  if (options.restore) {
    const backup = path.resolve(options.restore);
    if (path.dirname(backup) !== server || !path.basename(backup).startsWith(".leeva-ui-backup-")) {
      throw new Error("Restore requires a backup generated beside this server's ui-dist.");
    }
    if ((await fs.lstat(backup)).isSymbolicLink()) throw new Error("Backup symlink refused.");
    await regularFile(path.join(backup, "manifest.json"));
    const manifest = JSON.parse(await fs.readFile(path.join(backup, "manifest.json"), "utf8"));
    source = path.join(backup, "ui-dist");
    if (manifest.format !== BACKUP_FORMAT || manifest.serverVersion !== SERVER_VERSION
      || manifest.sha256 !== await treeDigest(source)) throw new Error("Backup identity or checksum does not match.");
  } else {
    const requested = path.resolve(options.dist ?? defaultDist);
    if ((await fs.lstat(requested)).isSymbolicLink()) throw new Error("Build directory symlink refused.");
    source = await fs.realpath(requested);
  }
  if (contains(source, target) || contains(target, source)) throw new Error("Source and destination overlap.");
  const sourceHash = await treeDigest(source);
  return { action: options.restore ? "restore" : "deploy", server, source, target, sourceHash, targetHash };
}

// Keep this transaction small: a failed activation restores the complete original.
export async function activateUi(staging, target, saved, rename = fs.rename) {
  await rename(target, saved);
  try {
    await rename(staging, target);
  } catch (error) {
    try { await rename(saved, target); }
    catch (rollbackError) {
      throw new Error(`Activation and rollback failed; original UI remains at ${saved}. ${rollbackError.message}`, { cause: error });
    }
    throw new Error("Activation failed; the original UI was restored.", { cause: error });
  }
}

export async function applyPlan(plan) {
  const lock = path.join(plan.server, ".leeva-ui-deploy.lock");
  await fs.mkdir(lock); // Exclusive: never remove another deployment's lock.
  let staging;
  let backup;
  try {
    if (await treeDigest(plan.target) !== plan.targetHash || await treeDigest(plan.source) !== plan.sourceHash) {
      throw new Error("UI changed after validation; run the command again.");
    }
    staging = await fs.mkdtemp(path.join(plan.server, ".leeva-ui-stage-"));
    await fs.cp(plan.target, staging, { recursive: true, dereference: false });
    // Retain all old files for open tabs. A hashed asset name must never change bytes.
    async function overlay(relative) {
      const source = path.join(plan.source, relative);
      const destination = path.join(staging, relative);
      const stat = await fs.lstat(source);
      if (stat.isSymbolicLink()) throw new Error(`Symlink refused: ${source}`);
      if (stat.isDirectory()) {
        await fs.mkdir(destination, { recursive: true });
        for (const name of await fs.readdir(source)) await overlay(path.join(relative, name));
      } else if (stat.isFile()) {
        if (relative === "index.html") return;
        if (relative.startsWith(`assets${path.sep}`)) {
          const existing = await fs.readFile(destination).catch((error) => { if (error.code !== "ENOENT") throw error; });
          if (existing && !existing.equals(await fs.readFile(source))) throw new Error(`Asset filename collision: ${relative}`);
        }
        await fs.copyFile(source, destination);
      } else throw new Error(`Special file refused: ${source}`);
    }
    await overlay("");
    await fs.copyFile(path.join(plan.source, "index.html"), path.join(staging, "index.html"));
    await treeDigest(staging);
    if (await treeDigest(plan.target) !== plan.targetHash || await treeDigest(plan.source) !== plan.sourceHash) {
      throw new Error("UI changed while staging; original UI remains untouched.");
    }
    backup = await fs.mkdtemp(path.join(plan.server, ".leeva-ui-backup-"));
    await fs.writeFile(path.join(backup, "manifest.json"), JSON.stringify({
      format: BACKUP_FORMAT, serverVersion: SERVER_VERSION, createdAt: new Date().toISOString(), sha256: plan.targetHash,
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await activateUi(staging, plan.target, path.join(backup, "ui-dist"));
    return { action: plan.action, target: plan.target, backup };
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true });
    if (backup && !(await fs.stat(path.join(backup, "ui-dist")).catch(() => null))) {
      await fs.rm(backup, { recursive: true, force: true });
    }
    await fs.rmdir(lock);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else {
      const plan = await buildPlan(options);
      console.log(JSON.stringify(options.apply ? await applyPlan(plan) : { dryRun: true, ...plan }, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
