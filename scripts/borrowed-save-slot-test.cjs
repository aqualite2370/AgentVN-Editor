"use strict";
// Real files and an abruptly terminated subprocess; no user's saves are involved.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const { borrowQuickSave, restoreReceipt } = require("./lib/borrowed-save-slot.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const original = Buffer.from("原始快存\0不可丢失\ud83d\udcd6"), fixture = Buffer.from("本轮独占测试字节");
async function make(directory, options = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const sourceDirectory = path.join(directory, "中文 旧存档");
  fs.mkdirSync(sourceDirectory); const source = path.join(sourceDirectory, "quick-06.json");
  fs.writeFileSync(source, original, { flag: "wx" });
  const args = { confirmed: true, sourceDirectory, source, backupDirectory: path.join(directory, "保留 备份"),
    expectedSha256: hash(original), ...options };
  return { args, source, lease: () => borrowQuickSave(args) };
}
if (process.argv[2] === "--crash-worker") {
  (async () => {
    const sample = await make(process.argv[3]), lease = await sample.lease();
    lease.activate(fixture);
    process.stdout.write(`${lease.receiptFile}\n`);
    // Deliberately bypass finally: detached IPC watcher must restore independently.
    process.exit(19);
  })().catch(error => { console.error(error); process.exit(2); });
} else {
  const out = path.resolve(__dirname, "../output/borrowed-save-slot-tests", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(out, { recursive: true });
  const report = { status: "RUNNING", cases: [], out };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function test(name, action) {
    try { await action(path.join(out, name)); report.cases.push({ name, status: "PASS" }); console.log(`PASS ${name}`); }
    catch (error) { report.cases.push({ name, status: "FAILED", error: String(error.stack || error) }); throw error; }
    finally { save(); }
  }
  (async () => {
    await test("explicit-approval-required", async directory => {
      const sample = await make(directory, { confirmed: false });
      await assert.rejects(sample.lease, /Explicit user approval/); assert.deepEqual(fs.readFileSync(sample.source), original);
    });
    await test("changed-preflight-hash-rejected", async directory => {
      const sample = await make(directory, { expectedSha256: "0".repeat(64) });
      await assert.rejects(sample.lease, /Source changed/); assert.deepEqual(fs.readFileSync(sample.source), original);
    });
    await test("wrong-directory-rejected", async directory => {
      const sample = await make(directory); sample.args.sourceDirectory = directory;
      await assert.rejects(sample.lease, /explicit source directory/); assert.deepEqual(fs.readFileSync(sample.source), original);
    });
    await test("old-backup-never-overwritten", async directory => {
      const sample = await make(directory); fs.mkdirSync(sample.args.backupDirectory);
      await assert.rejects(sample.lease, /previous backup directory/); assert.deepEqual(fs.readFileSync(sample.source), original);
    });
    await test("restore-bytes-mtime-retained-backup-and-idempotence", async directory => {
      const sample = await make(directory), before = fs.statSync(sample.source), lease = await sample.lease();
      try { lease.activate(fixture); assert.deepEqual(fs.readFileSync(sample.source), fixture); }
      finally { await lease.restore(); }
      assert.deepEqual(fs.readFileSync(sample.source), original); assert.deepEqual(fs.readFileSync(lease.backup), original);
      assert.equal(fs.statSync(sample.source).mtimeMs, before.mtimeMs);
      assert.equal(restoreReceipt(lease.receiptFile).status, "RESTORED");
    });
    await test("failure-finally-restores", async directory => {
      const sample = await make(directory), lease = await sample.lease();
      await assert.rejects(async () => {
        try { lease.activate(fixture); throw new Error("controlled runtime failure"); }
        finally { await lease.restore(); }
      }, /controlled runtime failure/);
      assert.deepEqual(fs.readFileSync(sample.source), original);
    });
    await test("external-change-preserved-not-overwritten", async directory => {
      const sample = await make(directory), lease = await sample.lease();
      lease.activate(fixture); const external = Buffer.from("模拟外部写入，仅限临时测试目录");
      fs.writeFileSync(sample.source, external);
      await assert.rejects(lease.restore, /recovery failed/);
      assert.deepEqual(fs.readFileSync(sample.source), external);
      assert.deepEqual(fs.readFileSync(lease.backup), original);
      const receipt = JSON.parse(fs.readFileSync(lease.receiptFile));
      assert.deepEqual(fs.readFileSync(receipt.holding), original);
      // This is our temporary fixture, not a user's externally changed file.
      fs.writeFileSync(sample.source, fixture); restoreReceipt(lease.receiptFile);
      assert.deepEqual(fs.readFileSync(sample.source), original);
    });
    await test("watcher-restores-after-abrupt-parent-exit", async directory => {
      const child = spawn(process.execPath, [__filename, "--crash-worker", directory], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; child.stdout.on("data", bytes => { stdout += bytes; });
      const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      assert.equal(code, 19);
      const receiptFile = stdout.trim(), until = Date.now() + 15000;
      let receipt;
      while (Date.now() < until) {
        receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
        if (receipt.status === "RESTORED") break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(receipt.status, "RESTORED"); assert.deepEqual(fs.readFileSync(receipt.source), original);
      assert.deepEqual(fs.readFileSync(receipt.backup), original);
    });
    assert.equal(report.cases.length, 8); report.status = "PASS";
  })().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
    .finally(() => { save(); console.log(`Evidence: ${out}`); });
}
