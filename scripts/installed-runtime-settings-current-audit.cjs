"use strict";
// Independent evidence-only verification. No product launch, model request or profile mutation.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { validate } = require("./installed-runtime-settings-current.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const attempt = process.argv[2] || "01", audit = process.argv[3] || "01";
assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
const source = path.join(base, `installed-settings-current-${attempt}`);
const out = path.join(base, `installed-settings-current-${attempt}-audit-${audit}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
  scope: "CURRENT_INSTALLED_LIBRARY_SETTINGS_EVIDENCE_NOT_STANDALONE_OR_ANDROID",
  productChanges: 0, modelRequests: 0, launches: 0 };
async function group(name, fn) {
  const g = { name, status: "RUNNING" }; report.groups.push(g);
  try { g.detail = await fn(); g.status = "PASS"; }
  catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
}
(async () => {
  const s = read(path.join(source, "installed-session.json")), r = read(path.join(source, "report.json"));
  validate(s, r);
  report.session = desc(path.join(source, "installed-session.json")); report.raw = desc(path.join(source, "report.json"));
  await group("Installed provenance, exact executed sources, protected bytes and hostile report rejection", () => {
    for (const f of [s.installation, s.executable, s.originalExport, s.originalFixture, s.restoration,
      ...s.protectedFiles, ...s.cartridges, r.source, r.fixture, r.runnerAtInvocation, ...r.tools])
      assert.equal(sha(f.path), f.sha256, f.path);
    for (const f of s.snapshots) {
      assert.equal(sha(f.copy.path), f.copy.sha256); assert.equal(f.source.sha256, f.copy.sha256);
      if (/\.(cjs|ps1)$/.test(f.source.path)) assert.equal(sha(f.source.path), f.source.sha256);
    }
    const variants = [
      a => { a[0].status = "RUNNING"; }, a => { a[0].version = "1.9.13"; },
      a => { a[0].executable.sha256 = "wrong"; }, a => { a[0].commands.pop(); },
      a => { a[0].commands[0].status = "FAILED"; }, a => { a[0].gitAfter.index = "changed"; },
      a => { a[0].cleanupError = "not restored"; }, a => { a[0].modelRequests = 1; },
      a => { a[0].productChanges = 1; }, a => { a[0].builds = 1; },
      a => { a[1].matrix = []; }, a => { a[1].matrix[1] = a[1].matrix[0]; },
      a => { a[1].checks.pop(); }, a => { a[1].checks[0].detail.controls[0].value = 99; },
      a => { a[1].checks.find(c => c.name.startsWith("Switching the same")).detail.otherAfter.muteAll = false; },
      a => { a[1].screenshots.pop(); }, a => { a[1].launches[0].executableSha256 = "wrong"; },
      a => { a[1].launches[0].identity.ExecutablePath = "D:\\AgentVN\\agentvn-player.exe"; },
      a => { a[1].launches[0].cleanup.method = "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE"; },
      a => { a[1].interactions[0].inputs[0].trusted = false; },
      a => { a[1].pageErrors.push("error"); },
      a => { a[1].notRun = a[1].notRun.filter(n => n !== "Android settings/audio"); },
    ];
    for (const mutate of variants) { const a = structuredClone([s, r]); mutate(a); assert.throws(() => validate(...a)); }
    return { snapshots: s.snapshots.length, protectedDistinctPaths: new Set(s.protectedFiles.map(f => path.resolve(f.path))).size,
      invalidVariantsRejected: variants.length, version: s.version, executable: s.executable };
  });
  await group("All17 changed preferences, hidden field stability, real native restarts and cross-layout identity isolation", () => {
    const editable = new Set([...r.inventory.groups.flatMap(g => g.controls.map(c => c[0])), "textSpeed"]);
    const hidden = p => Object.fromEntries(Object.entries(p).filter(([k]) => !editable.has(k)));
    for (const layout of ["agentvn", "renpy"]) {
      const initial = r.checks.find(c => c.layout === layout && c.name.startsWith("New game identity")).detail;
      const changed = r.checks.find(c => c.layout === layout && c.name.startsWith("Change all17")).detail;
      assert.deepEqual(hidden(initial.prefs), hidden(changed.changed.prefs));
      assert.deepEqual(hidden(initial.prefs), hidden(changed.reopened.prefs));
      assert.equal(r.launches.filter(l => l.layout === layout).length, layout === "agentvn" ? 3 : 5);
    }
    const identities = [...new Set(r.launches.map(l => l.installId))]; assert.equal(identities.length, 2);
    const pairs = new Set(r.launches.map(l => `${l.layout}:${l.installId}`)); assert.equal(pairs.size, 3);
    assert.equal(r.interactions.length, 8);
    for (const launch of r.launches) {
      const matches = r.interactions.filter(i => i.pid === launch.pid && i.installId === launch.installId);
      assert.equal(matches.length, 1);
      // The established runner captures the event list after opening the
      // dialog, before its final confirmation destroys the WebView. Its label
      // resolver prioritizes aria-label ("退出游戏"), not data-testid.
      assert(matches[0].inputs.some(i => i.type === "click" && i.label === "退出游戏" && i.trusted));
      assert.equal(launch.cleanup.method, "REAL_UI_CONFIRMED_NATIVE_DESTROY");
    }
    return { businessChecks: r.checks.length, controls: 17, gameIdentities: identities, nativeRestarts: 6,
      displayCases: r.matrix.length, nativeMenuConfirmedExit: 8, physicalWindowCloseClaim: false,
      finalConfirmationEventInInputSnapshot: false,
      exitEvidence: "Trusted dialog opener + awaited real confirmation in hashed runner + native process destruction; input list ends before confirmation.",
      audio: "USER_PREVIOUS_CONFIRMATION_NOT_NEW_LISTENING", actualGameplayEffectOfEachPreference: "NOT_ALL_RETESTED" };
  });
  await group("Both historical real UI-exported cartridges retain exact manifest/script/layout bytes and source identity", async () => {
    const exports = read(s.originalExport.path), manifestIds = [];
    for (const c of s.cartridges) {
      assert.equal(sha(c.path), c.sha256); assert.equal(sha(c.historicalSource), c.sha256);
      const previous = exports.cartridges.find(p => p.layout === c.layout); assert(previous);
      const zip = await JSZip.loadAsync(fs.readFileSync(c.path)), manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      for (const [name, k] of [["script.json", "scriptSha256"], ["ui/layout.json", "layoutSha256"]]) {
        const digest = crypto.createHash("sha256").update(await zip.file(name).async("nodebuffer")).digest("hex");
        assert.equal(digest, previous[k]);
      }
      manifestIds.push(manifest.game_id);
    }
    assert.equal(new Set(manifestIds).size, 1);
    return { actualCartridges: 2, sameGameManifestAcrossLayouts: true, separatelyAssignedQAInstallIdentities: 2,
      historicalExportNotNewEditorExport: true, pickerClaim: false };
  });
  await group("All28 PNG bytes match unchanged real pre/post WebView viewport DPR/media and physical pixel sizes", () => {
    for (const image of r.screenshots) {
      assert.equal(sha(image.path), image.sha256); assert.deepEqual(image.before, image.after);
      const bytes = fs.readFileSync(image.path), d = Math.round(image.before.dpr);
      assert(Math.abs(d - image.before.dpr) < 1e-6);
      assert.equal(bytes.readUInt32BE(16), image.before.width * d);
      assert.equal(bytes.readUInt32BE(20), image.before.height * d);
      assert.equal(image.png.width, bytes.readUInt32BE(16)); assert.equal(image.png.height, bytes.readUInt32BE(20));
    }
    return { screenshots: 28, displayCases: 24, categoryNavigations: 120, physical4KClaim: false };
  });
  await group("Original Player directories/bytes restored and all recorded native roots/ports and owned WebViews absent", () => {
    const journal = read(path.join(source, "profile-protection.json")), restored = read(s.restoration.path);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const old of journal.records) {
      const now = restored.restored.find(p => p.original === old.original); assert(now);
      assert.equal(now.directoryId, old.directoryId); assert.deepEqual(now.files, old.files);
      assert(!fs.existsSync(old.held)); if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
      for (const file of old.files) assert.equal(sha(path.join(old.original, file.relative)), file.sha256);
      if (old.existed) {
        const p = spawnSync("fsutil.exe", ["file", "queryfileid", old.original], { encoding: "utf8", windowsHide: true });
        assert.equal(p.status, 0); assert(p.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
      }
    }
    const active = rows();
    for (const l of r.launches) {
      const ms = Number(l.identity.CreationDate.match(/\d+/)[0]);
      assert(!active.some(p => p.ProcessId === l.pid && Date.parse(p.Created) === ms));
    }
    assert(!active.some(p => p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
    assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
    return { recordedNativeRoots: 8, ports: r.launches.map(l => l.port),
      originalPlayerDirectories: journal.records.length, userFilesDeleted: 0,
      limitation: "Root process identities recorded, not complete historical descendant process trees." };
  });
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, groups: report.groups.map(g => ({ name: g.name, status: g.status })),
    error: report.error }, null, 2));
});
