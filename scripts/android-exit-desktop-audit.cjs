"use strict";
// Independent terminal evidence check. Never upgrades installed/Android status.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const same = f => assert.equal(fileEvidence(f.path).sha256, f.sha256, f.path);
function validateNativeResult(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt);
  assert.equal(r.cleanup, "PASS"); assert(!r.cleanupError);
  assert.equal(r.scope, "CURRENT_DEV_NATIVE_EXIT_NOT_INSTALLED_OR_ANDROID");
  assert.equal(r.cells.length, 6); assert.equal(r.launches.length, 12);
  for (const layout of ["agentvn", "renpy"]) for (const mode of ["title_auto_off", "playing_auto_off", "playing_auto_on"]) {
    const cell = r.cells.find(c => c.layout === layout && c.mode === mode); assert(cell);
    assert.equal(cell.status, "PASS"); assert.equal(cell.exits.length, 2);
    for (const e of cell.exits) {
      assert.equal(e.code, 0); assert.equal(e.forcedBeforeExit, false);
      assert.equal(e.confirmationClicks, 1); assert(e.elapsedMs >= 0 && e.elapsedMs < 15000);
    }
    if (mode === "playing_auto_on") {
      assert.deepEqual(cell.restored, cell.before);
      assert(cell.disk.some(f => f.data.save_kind === "auto" && f.data.scene_id === cell.before.scene
        && f.data.command_index === cell.before.command));
    } else assert.equal(cell.disk.length, 0);
  }
  assert(r.launches.every(l => l.cleanup?.status === "PASS"
    && l.cleanup.method === "PROCESS_ALREADY_EXITED_BEFORE_CLEANUP"));
  assert.deepEqual(r.pageErrors, []);
}
function main() {
  const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
  const source = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/android-exit-20261024-${attempt}`);
  const out = path.resolve(`F:/AgentVN/QA/Android-Exit-20261024-01/native-audit-${attempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [], scope: "CURRENT_SOURCE_DEV_NOT_RELEASE_OR_ANDROID" };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  const group = (name, fn) => { const item = { name, status: "RUNNING" }; r.groups.push(item);
    try { item.result = fn(); item.status = "PASS"; }
    catch (e) { item.status = "FAILED"; throw e; } finally { save(); } };
  try {
    const f = path.join(source, "report.json"), n = read(f);
    group("Nonempty native exit/restart semantics and invalid-evidence rejection", () => {
      validateNativeResult(n);
      const mutations = [
        r => r.cells.pop(), r => { r.cells[0].exits = []; },
        r => { r.cells[0].exits[0].forcedBeforeExit = true; },
        r => { r.cells[0].exits[0].code = 1; },
        r => { r.launches[0].cleanup.method = "OWNED_FORCE_STOP"; },
        r => { r.cells.find(c => c.mode === "playing_auto_on").restored.text += "wrong"; },
        r => { r.cells.find(c => c.mode === "playing_auto_on").disk = []; },
        r => { r.finishedAt = undefined; }, r => { r.cleanupError = "unrestored"; },
      ];
      for (const mutate of mutations) { const bad = structuredClone(n); mutate(bad); assert.throws(() => validateNativeResult(bad)); }
      return { cases: 6, actualExits: 12, rejectedInvalidResults: mutations.length };
    });
    group("Screenshots, actual save bytes, build/fixture/tools/frozen products", () => {
      assert.equal(n.screenshots.length, 12);
      for (const s of n.screenshots) {
        same(s); assert.deepEqual(s.before, s.after);
        const bytes = fs.readFileSync(s.path);
        assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
        assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);
      }
      let saves = 0;
      for (const c of n.cells) for (const f of c.disk) {
        const relative = path.relative("C:/Users/1/AppData/Roaming/com.agentvn.player", f.path);
        assert(!path.isAbsolute(relative) && !relative.startsWith(".."));
        const retained = path.join(source, "player-roaming", relative);
        same({ path: retained, sha256: f.sha256 });
        assert.deepEqual(read(retained), f.data); saves++;
      }
      const b = read(n.prep.build.path); assert.equal(b.status, "PASS");
      [n.prep.build, n.prep.exported, n.prep.executable, ...n.prep.cartridges,
        ...n.tools, ...b.sources, ...b.frozen, ...b.bundled, b.dev, b.player].forEach(same);
      r.native = fileEvidence(f); r.build = n.prep.build;
      return { png: n.screenshots.length, diskSaveFiles: saves, frozenUnchanged: b.frozen.length };
    });
    group("Original profile identities and byte restoration", () => {
      const restoration = read(path.join(source, "profile-restoration.json"));
      assert.equal(restoration.status, "PASS");
      const protection = read(path.join(source, "profile-protection.json"));
      assert.equal(protection.records.length, 2);
      let files = 0;
      for (const p of protection.records) {
        assert(!fs.existsSync(p.held)); assert(fs.existsSync(p.original));
        const output = execFileSync("fsutil.exe", ["file", "queryfileid", p.original],
          { encoding: "utf8", windowsHide: true });
        assert.equal(output.match(/0x[0-9a-f]+/i)?.[0].toLowerCase(), p.directoryId);
        if (p.byteInventory) for (const f of p.files) {
          same({ path: path.join(p.original, f.relative), sha256: f.sha256 }); files++;
        }
      }
      return { originalDirectories: 2, originalFiles: files, restoration: fileEvidence(path.join(source, "profile-restoration.json")) };
    });
    group("Exact owned process and port cleanup", () => {
      const now = rows();
      assert(!now.some(p => n.knownProcesses.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
      const ports = n.launches.map(l => l.port); assert.deepEqual(listeners(ports), []);
      return { processIdentities: n.knownProcesses.length, ports };
    });
    r.status = "SOURCE_DEV_EXIT_AUDIT_PASS_ANDROID_NOT_RUN";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, error: r.error }));
}
if (require.main === module) main();
module.exports = { validateNativeResult };
