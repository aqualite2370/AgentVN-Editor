"use strict";
// Test-only, explicitly authorized borrowing of one existing legacy quick-save file.
// The original is retained by same-directory rename, plus a durable external copy.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fork } = require("node:child_process");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fileHash = file => hash(fs.readFileSync(file));
function noLinks(file) {
  for (let current = path.resolve(file);; current = path.dirname(current)) {
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), `Refusing link: ${current}`);
    if (path.dirname(current) === current) break;
  }
}
function durableNew(file, bytes) {
  const fd = fs.openSync(file, "wx");
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function updateReceipt(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  durableNew(temporary, Buffer.from(JSON.stringify(value, null, 2)));
  fs.renameSync(temporary, file);
}
function readReceipt(file) {
  noLinks(file);
  const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(receipt.version, 1);
  assert.equal(path.dirname(receipt.source), receipt.sourceDirectory);
  assert(/^quick-0[1-6]\.json$/.test(path.basename(receipt.source)));
  assert.equal(receipt.holding, `${receipt.source}.agentvn-hold-${receipt.id}`);
  for (const item of [receipt.source, receipt.holding, receipt.backup]) noLinks(item);
  assert.equal(fileHash(receipt.backup), receipt.originalSha256, "Recovery backup changed");
  return receipt;
}
function restoreReceipt(file) {
  const receipt = readReceipt(file);
  if (fs.existsSync(receipt.holding)) {
    assert.equal(fileHash(receipt.holding), receipt.originalSha256, "Held original changed; preserve all evidence");
    if (fs.existsSync(receipt.source)) {
      assert.equal(fileHash(receipt.source), receipt.fixtureSha256, "Slot changed externally; never overwrite it");
      fs.unlinkSync(receipt.source); // Only this lease's byte-verified fixture.
    }
    fs.renameSync(receipt.holding, receipt.source);
  }
  assert.equal(fileHash(receipt.source), receipt.originalSha256, "Original must be restored byte-for-byte");
  receipt.status = "RESTORED";
  receipt.restoredSha256 = fileHash(receipt.source);
  receipt.restoredAt = new Date().toISOString();
  receipt.backupRetained = true;
  updateReceipt(file, receipt);
  return receipt;
}
async function borrowQuickSave({ confirmed, sourceDirectory, source, backupDirectory, expectedSha256 }) {
  assert.equal(confirmed, true, "Explicit user approval required before borrowing a populated slot");
  sourceDirectory = path.resolve(sourceDirectory); source = path.resolve(source);
  backupDirectory = path.resolve(backupDirectory);
  assert.equal(path.dirname(source), sourceDirectory, "Only the explicit source directory is allowed");
  assert(/^quick-0[1-6]\.json$/.test(path.basename(source)));
  assert(!fs.existsSync(backupDirectory), "Never overwrite a previous backup directory");
  noLinks(source); noLinks(backupDirectory);
  assert(fs.lstatSync(source).isFile());
  const original = fs.readFileSync(source), originalStat = fs.statSync(source);
  assert.equal(hash(original), expectedSha256, "Source changed since preflight; do not borrow");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const backup = path.join(backupDirectory, path.basename(source));
  durableNew(backup, original);
  assert.equal(fileHash(backup), expectedSha256);
  assert.equal(fileHash(source), expectedSha256, "Source changed while backing up");
  const id = crypto.randomUUID(), receiptFile = path.join(backupDirectory, "recovery.json");
  const receipt = {
    version: 1, id, status: "BACKUP_VERIFIED", sourceDirectory, source, backup,
    holding: `${source}.agentvn-hold-${id}`, originalSha256: expectedSha256,
    originalBytes: original.length, originalMtimeMs: originalStat.mtimeMs,
    createdAt: new Date().toISOString(), parentPid: process.pid,
  };
  durableNew(receiptFile, Buffer.from(JSON.stringify(receipt, null, 2)));
  // A disconnected IPC channel, unlike a PID poll, cannot mistake PID reuse for a live parent.
  const watcher = fork(__filename, ["--watch", receiptFile], {
    detached: true, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const closed = new Promise(resolve => watcher.once("exit", (code, signal) => resolve({ code, signal })));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Save recovery watcher readiness timed out")), 10000);
      watcher.once("error", error => { clearTimeout(timer); reject(error); });
      watcher.once("message", message => {
        clearTimeout(timer); message.ready ? resolve() : reject(new Error("Save recovery watcher refused receipt"));
      });
    });
  } catch (error) {
    if (watcher.connected) watcher.disconnect();
    throw error;
  }
  return {
    receiptFile, backup, watcherPid: watcher.pid,
    activate(bytes) {
      assert.equal(readReceipt(receiptFile).status, "BACKUP_VERIFIED", "A slot can be borrowed only once");
      assert.equal(fileHash(source), expectedSha256, "Original changed before activation");
      receipt.fixtureSha256 = hash(bytes);
      receipt.fixtureEvidence = path.join(backupDirectory, "test-fixture.json");
      durableNew(receipt.fixtureEvidence, bytes);
      receipt.status = "ARMED"; updateReceipt(receiptFile, receipt);
      fs.renameSync(source, receipt.holding);
      assert.equal(fileHash(receipt.holding), expectedSha256);
      durableNew(source, bytes);
      receipt.status = "BORROWED"; updateReceipt(receiptFile, receipt);
      return { source, backup, receiptFile, fixtureSha256: receipt.fixtureSha256 };
    },
    async restore() {
      if (watcher.connected) watcher.send({ restore: true });
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Save recovery watcher restoration timed out")), 15000);
        closed.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
      });
      assert.equal(result.code, 0, `Save recovery failed; retain backup and inspect ${receiptFile}`);
      const restored = readReceipt(receiptFile);
      assert.equal(restored.status, "RESTORED");
      assert.equal(fileHash(source), expectedSha256);
      return restored;
    },
  };
}
if (require.main === module) {
  assert.equal(process.argv[2], "--watch");
  const receiptFile = path.resolve(process.argv[3]);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try { restoreReceipt(receiptFile); process.exit(0); }
    catch (error) {
      try {
        const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
        receipt.recoveryError = String(error.stack || error);
        updateReceipt(receiptFile, receipt);
      } catch {}
      process.exit(1);
    }
  };
  process.on("disconnect", finish);
  process.on("message", message => { if (message.restore) finish(); });
  readReceipt(receiptFile);
  process.send({ ready: true });
}
module.exports = { borrowQuickSave, restoreReceipt };
