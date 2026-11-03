"use strict";
// Independently re-read raw native observations and exact historical bytes.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { assertTitleProtocolRefusal, readHistoricalTitlePlayer, describe } = require("./lib/renpy-title-old-runtime-evidence.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const source = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/title-old-026-${attempt}/report.json`);
const out = path.resolve(`F:/AgentVN/QA/Editor-1.9.24-20261024-01/title-old-audit-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: describe(source),
  scope: "INDEPENDENT_OLD_025_NATIVE_026_TITLE_REFUSAL_AUDIT_NOT_UPGRADE_OR_ANDROID",
  checks: [], modelRequests: 0, productChanges: 0 };
const r = read(source);
function check(name, fn) {
  const detail = fn(); report.checks.push({ name, status: "PASS", detail });
}
try {
  check("Complete real old binary matrix, not classifier/preflight or empty evidence", () => {
    assert.equal(r.preflight, false); assert.equal(r.status, "PASS");
    assert(r.finishedAt && !r.error && !r.cleanupError); assert.equal(r.profileRestoration, "PASS");
    assert.equal(r.scope, "RETAINED_REAL_025_PLAYER_REFUSES_CURRENT_UI_EXPORTED_026_TITLE_NOT_UPGRADE_OR_ANDROID");
    assert.equal(r.cases.length, 13); assert.equal(r.screenshots.length, 13);
    assert.equal(new Set(r.screenshots.map(f => path.resolve(f.path))).size, 13);
    assert.equal(new Set(r.cases.map(c => c.key)).size, 13);
    assert.equal(r.launches.length, 13); assert(r.cases.every(c => c.status === "PASS"));
    assert.deepEqual(r.pageErrors, []); assert.equal(r.modelRequests, 0); assert.equal(r.builds, 0);
    assert.equal(r.productChanges, 0); assert.equal(r.normalCloseClaimed, false);
    assert.equal(r.cases.filter(c => c.control).length, 1);
    assert(r.cases.find(c => c.control).sentinel);
    return { launches: 13, supportedControl: 1, refusals: 12 };
  });
  check("Real historical package/installed binary provenance and unchanged current author bytes", () => {
    for (const item of [r.old.installation, r.old.payload, r.old.executable, r.originalOldExecutable,
      r.author, ...r.cartridges, ...r.tools])
      assert.equal(sha(item.path), item.sha256, item.path);
    assert.equal(r.old.editorVersion, "1.9.22");
    assert.equal(r.old.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
    assert.equal(r.originalOldExecutable.sha256, r.old.executable.sha256);
    assert.deepEqual(readHistoricalTitlePlayer().executable, r.originalOldExecutable);
    assert.equal(read(r.author.path).status, "PASS");
    return { executed: r.old.executable, original: r.originalOldExecutable };
  });
  check("Each 1080p/1440p/4K DPR1/2 motion mode explicitly rejects the new protocol", () => {
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const expected = { width, height: width * 9 / 16, dpr, reduced };
      const matches = r.cases.filter(c => !c.control && c.expected.width === width
        && c.expected.dpr === dpr && c.expected.reduced === reduced);
      assert.equal(matches.length, 1); assert.deepEqual(matches[0].expected, expected);
      assertTitleProtocolRefusal(matches[0], expected);
    }
    for (const image of r.screenshots) {
      assert.equal(sha(image.path), image.sha256);
      assert.deepEqual(image.before, image.after);
      const matched = r.cases.filter(c => path.basename(image.path) === `${c.key}.png`);
      assert.equal(matched.length, 1); const expected = matched[0].expected;
      validateNativeViewport(image.before, expected);
      const bytes = fs.readFileSync(image.path);
      assert.equal(bytes.readUInt32BE(16), image.png.width);
      assert.equal(bytes.readUInt32BE(20), image.png.height);
      assert.equal(image.png.width, expected.width * expected.dpr);
      assert.equal(image.png.height, expected.height * expected.dpr);
    }
    return { actualOldRuntime: "0.25.0", rejectedRequiredRuntime: "0.26.0", displayGroups: 12 };
  });
  check("Exact process/port cleanup and original profiles restored", () => {
    const now = rows();
    for (const launch of r.launches) {
      assert.equal(launch.cleanup.status, "PASS"); assert(launch.identity && launch.listener);
      assert.equal(sha(launch.executable.path), launch.executable.sha256);
      assert(launch.known.some(p => p.ProcessId === launch.listener.OwningProcess));
      assert(!now.some(p => launch.known.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
    }
    assert.equal(listeners(r.launches.map(l => l.port)).length, 0);
    const dir = path.dirname(source);
    const restored = read(path.join(dir, "profile-restoration.json"));
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    const before = read(path.join(dir, "profile-protection.json"));
    assert.equal(restored.restored.length, before.records.length);
    for (const record of before.records) {
      const matches = restored.restored.filter(item => item.original === record.original);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].directoryId, record.directoryId);
      assert.deepEqual(matches[0].files, record.files);
      for (const file of record.files)
        assert.equal(sha(path.join(record.original, file.relative)), file.sha256);
    }
    assert.deepEqual(r.commands.map(c => c.exitCode), [0, 0]);
    return { restored: describe(path.join(dir, "profile-restoration.json")), processes: r.launches.length };
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report));
}
