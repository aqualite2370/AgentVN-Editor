"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/novel-card-position-store", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "REAL_POSITION_CONTROLLER_WITH_CONTROLLED_STORAGE_BOUNDARIES",
  cases: [], startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const held = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
async function main() {
  const built = require("../editor/node_modules/esbuild").buildSync({
    stdin: { contents: 'export * from "./editor/src/novel-import/novelCardPosition";', loader: "ts", resolveDir: root },
    platform: "node", format: "cjs", bundle: true, write: false,
  });
  const loaded = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(loaded, loaded.exports, require);
  const { createNovelCardPositionStore, novelCardPositionKey: key } = loaded.exports;
  function setup() {
    const cache = new Map(), disk = new Map(), calls = [], warnings = [];
    let fail = false, holdRead, holdWrite;
    const storage = {
      getItem: k => cache.get(k) ?? null,
      setItem(k, value) { cache.set(k, value); }, removeItem(k) { cache.delete(k); },
    };
    const native = {
      async read(id) {
        calls.push({ operation: "read", id });
        const value = structuredClone(disk.get(id) ?? null);
        if (holdRead) { const hold = holdRead; holdRead = undefined; await hold.promise; }
        return value;
      },
      async write(id, position) {
        calls.push({ operation: "write", id, position });
        if (holdWrite) { const hold = holdWrite; holdWrite = undefined; await hold.promise; }
        if (fail) throw Error("controlled native disk failure");
        const value = { schemaVersion: 1, projectId: id, position };
        disk.set(id, structuredClone(value)); return value;
      },
    };
    return { cache, disk, calls, storage, native, warnings,
      store: createNovelCardPositionStore({ storage, native, onMirrorError: error => warnings.push(String(error)) }),
      set fail(value) { fail = value; }, set holdRead(value) { holdRead = value; },
      set holdWrite(value) { holdWrite = value; } };
  }
  async function check(name, body) { await body(); report.cases.push({ name, status: "PASS" }); save(); }
  await check("missing-position-does-not-create-record", async () => {
    const h = setup(); assert.equal(await h.store.read("A"), null); assert.equal(h.disk.size, 0);
  });
  await check("legacy-cache-migrates-only-to-own-project", async () => {
    const h = setup(); h.cache.set(key("中文 A"), JSON.stringify({ x: .2, y: .8 }));
    assert.deepEqual(await h.store.read("中文 A"), { x: .2, y: .8 });
    assert.deepEqual(h.disk.get("中文 A").position, { x: .2, y: .8 });
    assert.equal(await h.store.read("B"), null); assert.equal(h.disk.has("B"), false);
  });
  await check("native-record-wins-over-old-browser-bytes", async () => {
    const h = setup(); h.disk.set("A", { schemaVersion: 1, projectId: "A", position: { x: .4, y: .5 } });
    h.cache.set(key("A"), JSON.stringify({ x: .9, y: .9 }));
    assert.deepEqual(await h.store.read("A"), { x: .4, y: .5 });
    assert.deepEqual(JSON.parse(h.cache.get(key("A"))), { x: .4, y: .5 });
  });
  await check("reset-tombstone-cannot-resurrect-stale-cache", async () => {
    const h = setup(); await h.store.write("A", { x: .2, y: .3 }); await h.store.write("A", null);
    h.cache.set(key("A"), JSON.stringify({ x: .8, y: .8 }));
    assert.equal(await h.store.read("A"), null); assert.equal(h.cache.has(key("A")), false);
    assert.equal(h.disk.get("A").position, null);
  });
  await check("native-write-is-not-committed-before-ack", async () => {
    const h = setup(), hold = held(); h.holdWrite = hold;
    let committed = false; const saving = h.store.write("A", { x: .1, y: .2 }).then(() => { committed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(committed, false); assert.equal(h.cache.has(key("A")), false);
    hold.release(); await saving; assert.equal(committed, true);
  });
  await check("failed-write-keeps-prior-record-and-cache-and-retries", async () => {
    const h = setup(); await h.store.write("A", { x: .1, y: .2 }); h.fail = true;
    await assert.rejects(h.store.write("A", { x: .8, y: .9 }), /native disk failure/);
    assert.deepEqual(h.disk.get("A").position, { x: .1, y: .2 });
    assert.deepEqual(JSON.parse(h.cache.get(key("A"))), { x: .1, y: .2 });
    h.fail = false; await h.store.write("A", { x: .8, y: .9 });
    assert.deepEqual(await h.store.read("A"), { x: .8, y: .9 });
  });
  await check("migration-failure-does-not-claim-persisted-or-delete-legacy", async () => {
    const h = setup(); h.cache.set(key("A"), JSON.stringify({ x: .2, y: .7 })); h.fail = true;
    await assert.rejects(h.store.read("A"), /native disk failure/);
    assert.equal(h.disk.has("A"), false); assert(h.cache.has(key("A")));
    h.fail = false; assert.deepEqual(await h.store.read("A"), { x: .2, y: .7 });
  });
  await check("same-project-read-write-and-reset-are-serialized", async () => {
    const h = setup(), hold = held(); h.holdRead = hold;
    const reading = h.store.read("A"), writing = h.store.write("A", { x: .3, y: .6 }), resetting = h.store.write("A", null);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.calls.map(v => v.operation), ["read"]);
    hold.release(); await Promise.all([reading, writing, resetting]);
    assert.deepEqual(h.calls.map(v => v.operation), ["read", "write", "write"]);
    assert.equal(await h.store.read("A"), null);
  });
  await check("other-project-not-blocked-and-no-cross-project-payload", async () => {
    const h = setup(), hold = held(); h.holdWrite = hold;
    const a = h.store.write("A", { x: .4, y: .5 });
    await new Promise(resolve => setImmediate(resolve));
    await h.store.write("B", { x: .8, y: .1 });
    assert.equal(h.disk.has("A"), false);
    assert.deepEqual(h.disk.get("B").position, { x: .8, y: .1 });
    hold.release(); await a; assert.deepEqual(h.disk.get("A").position, { x: .4, y: .5 });
  });
  await check("corrupt-native-and-wrong-owner-are-not-legacy-fallback", async () => {
    for (const record of [{ schemaVersion: 9, projectId: "A", position: null },
      { schemaVersion: 1, projectId: "B", position: null },
      { schemaVersion: 1, projectId: "A", position: { x: 2, y: .1 } }]) {
      const h = setup(); h.disk.set("A", record); h.cache.set(key("A"), '{"x":0.2,"y":0.5}');
      await assert.rejects(h.store.read("A")); assert.equal(h.calls.filter(v => v.operation === "write").length, 0);
    }
  });
  await check("invalid-coordinate-writes-rejected-before-native", async () => {
    const h = setup();
    for (const point of [{ x: NaN, y: .2 }, { x: .1, y: Infinity }, { x: -1, y: .1 },
      { x: .1, y: 1.1 }, {}, { x: "0.2", y: .2 }])
      await assert.rejects(h.store.write("A", point));
    assert.equal(h.calls.length, 0);
  });
  await check("empty-or-oversized-project-id-rejected", async () => {
    const h = setup();
    for (const id of ["", "  ", "A".repeat(1025)]) await assert.rejects(h.store.write(id, null));
    assert.equal(h.calls.length, 0);
  });
  await check("browser-only-keeps-local-behavior-without-native-promise", async () => {
    const h = setup(), browser = createNovelCardPositionStore({ storage: h.storage });
    await browser.write("A", { x: .1, y: .9 });
    assert.deepEqual(await browser.read("A"), { x: .1, y: .9 });
    await browser.write("A", null); assert.equal(await browser.read("A"), null);
    assert.equal(h.disk.size, 0);
  });
  await check("committed-native-write-survives-mirror-storage-failure", async () => {
    const h = setup(), store = createNovelCardPositionStore({ storage: {
      getItem: h.storage.getItem, setItem() { throw Error("quota"); }, removeItem() { throw Error("quota"); },
    }, native: h.native, onMirrorError: error => h.warnings.push(String(error)) });
    await store.write("A", { x: .4, y: .2 });
    assert.deepEqual(await store.read("A"), { x: .4, y: .2 });
    assert.equal(h.warnings.length, 2);
  });
  await check("actual-native-json-float-tail-is-acknowledged-and-mirrors-committed-value", async () => {
    // Exact requested/acknowledged pair observed in native session-05.
    const requested = { x: 0.9195544554455446, y: 0.9335171684357647 };
    const acknowledged = { x: 0.9195544554455446, y: 0.9335171684357648 };
    const h = setup(), store = createNovelCardPositionStore({ storage: h.storage, native: {
      read: h.native.read,
      async write(id, position) {
        assert.deepEqual(position, requested);
        const record = { schemaVersion: 1, projectId: id, position: acknowledged };
        h.disk.set(id, structuredClone(record)); return record;
      },
    } });
    await store.write("A", requested);
    assert.deepEqual(JSON.parse(h.cache.get(key("A"))), acknowledged);
    assert.deepEqual(await store.read("A"), acknowledged);
  });
  await check("float-tail-tolerance-does-not-accept-coordinate-or-null-substitution", async () => {
    for (const position of [{ x: .2 + 1e-12, y: .3 }, null, { x: .2, y: .3001 }]) {
      const h = setup(), store = createNovelCardPositionStore({ storage: h.storage, native: {
        read: h.native.read, async write(id) { return { schemaVersion: 1, projectId: id, position }; },
      } });
      await assert.rejects(store.write("A", { x: .2, y: .3 }), /ACK_INVALID/);
      assert.equal(h.cache.size, 0);
    }
  });
  await check("mismatched-native-ack-is-not-success-and-does-not-update-cache", async () => {
    const h = setup(), store = createNovelCardPositionStore({ storage: h.storage, native: {
      read: h.native.read, async write(id) { return { schemaVersion: 1, projectId: id, position: { x: .9, y: .9 } }; },
    } });
    await assert.rejects(store.write("A", { x: .2, y: .3 }), /ACK_INVALID/);
    assert.equal(h.cache.size, 0);
  });
  await check("invalid-legacy-cache-is-not-silently-migrated", async () => {
    const h = setup(); h.cache.set(key("A"), "{broken");
    await assert.rejects(h.store.read("A"));
    assert.equal(h.disk.size, 0); assert.equal(h.cache.get(key("A")), "{broken");
  });
  report.status = "PASS";
}
main().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error })); });
