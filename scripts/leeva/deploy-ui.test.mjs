import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { activateUi, applyPlan, buildPlan, parseOptions, SERVER_VERSION } from "./deploy-ui.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "leeva-ui-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const server = path.join(root, "server");
  const dist = path.join(root, "dist");
  for (const [directory, version] of [[path.join(server, "ui-dist"), "old"], [dist, "new"]]) {
    await fs.mkdir(path.join(directory, "assets"), { recursive: true });
    await fs.writeFile(path.join(directory, "index.html"), version);
    await fs.writeFile(path.join(directory, "assets", `${version}-hash.js`), version);
  }
  await fs.writeFile(path.join(server, "package.json"), JSON.stringify({ name: "@paperclipai/server", version: SERVER_VERSION }));
  return { root, server, dist, options: { "server-dir": server, dist } };
}

test("dry-run is default and validation writes nothing", async (t) => {
  const { server, options } = await fixture(t);
  assert.equal(parseOptions(["--server-dir", server]).apply, false);
  const before = await fs.readdir(server);
  await buildPlan(options);
  assert.deepEqual(await fs.readdir(server), before);
});

test("deployment preserves old chunks, backs up everything, and restores", async (t) => {
  const { server, options } = await fixture(t);
  const target = path.join(server, "ui-dist");
  const result = await applyPlan(await buildPlan(options));
  assert.equal(await fs.readFile(path.join(target, "index.html"), "utf8"), "new");
  assert.equal(await fs.readFile(path.join(target, "assets/old-hash.js"), "utf8"), "old");
  assert.equal(await fs.readFile(path.join(result.backup, "ui-dist/index.html"), "utf8"), "old");
  await applyPlan(await buildPlan({ "server-dir": server, restore: result.backup }));
  assert.equal(await fs.readFile(path.join(target, "index.html"), "utf8"), "old");
  assert.equal(await fs.readFile(path.join(target, "assets/new-hash.js"), "utf8"), "new");
});

test("failed activation rolls back the original directory", async (t) => {
  const { server, dist } = await fixture(t);
  const target = path.join(server, "ui-dist");
  const saved = path.join(server, "saved");
  await assert.rejects(activateUi(dist, target, saved, async (from, to) => {
    if (from === dist) throw new Error("simulated disk error");
    await fs.rename(from, to);
  }), /original UI was restored/);
  assert.equal(await fs.readFile(path.join(target, "index.html"), "utf8"), "old");
  await assert.rejects(fs.stat(saved), { code: "ENOENT" });
});

test("a second rollback failure keeps the original backup recoverable", async (t) => {
  const { server, dist } = await fixture(t);
  const target = path.join(server, "ui-dist");
  const saved = path.join(server, "saved");
  await assert.rejects(activateUi(dist, target, saved, async (from, to) => {
    if (from !== target) throw new Error("simulated disk error");
    await fs.rename(from, to);
  }), /original UI remains at/);
  assert.equal(await fs.readFile(path.join(saved, "index.html"), "utf8"), "old");
});

test("refuses incorrect package/version, missing index, overlaps, and symlinks", async (t) => {
  const { server, dist, options } = await fixture(t);
  await assert.rejects(buildPlan({ ...options, dist: path.join(server, "ui-dist") }), /overlap/);
  await fs.symlink(path.join(server, "package.json"), path.join(dist, "linked-file"));
  await assert.rejects(buildPlan(options), /Symlink refused/);
  await fs.unlink(path.join(dist, "linked-file"));
  await fs.rm(path.join(dist, "index.html"));
  await assert.rejects(buildPlan(options), { code: "ENOENT" });
  await fs.writeFile(path.join(server, "package.json"), JSON.stringify({ name: "@paperclipai/server", version: "future" }));
  await assert.rejects(buildPlan(options), /different package\/version/);
});

test("asset collision aborts without replacing UI or leaking a lock", async (t) => {
  const { server, dist, options } = await fixture(t);
  await fs.writeFile(path.join(dist, "assets/old-hash.js"), "different content");
  await assert.rejects(applyPlan(await buildPlan(options)), /filename collision/);
  assert.equal(await fs.readFile(path.join(server, "ui-dist/index.html"), "utf8"), "old");
  assert.deepEqual((await fs.readdir(server)).sort(), ["package.json", "ui-dist"]);
});

test("rejects changed source and tampered backup before deployment", async (t) => {
  const { server, dist, options } = await fixture(t);
  const stalePlan = await buildPlan(options);
  await fs.writeFile(path.join(dist, "index.html"), "newer");
  await assert.rejects(applyPlan(stalePlan), /changed after validation/);
  const { backup } = await applyPlan(await buildPlan(options));
  await fs.writeFile(path.join(backup, "ui-dist/index.html"), "tampered");
  await assert.rejects(buildPlan({ "server-dir": server, restore: backup }), /checksum/);
});
