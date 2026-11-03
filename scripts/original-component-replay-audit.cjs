"use strict";
// Evidence audit: recompute text intersections, PNG pixels and binary provenance.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const base = path.resolve("F:/AgentVN/QA/Original-Component-Replay-20261103-01"), [run = "02", attempt = "01"] = process.argv.slice(2);
assert.match(run, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
const target = path.join(base, `audit-${attempt}.json`); assert(!fs.existsSync(target));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: file, sha256: sha(fs.readFileSync(file)) });
const currentFile = path.join(base, `installed-${run}/report.json`), current = read(currentFile);
const oldFile = path.join(base, "installed-01/report.json"), old = read(oldFile);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), scope: "ORIGINAL_COMPONENT_EVIDENCE_AUDIT",
  current: desc(currentFile), originalFailure: desc(oldFile), groups: [] };
function group(name, fn) { const item = { name, status: "RUNNING" }; report.groups.push(item);
  try { item.detail = fn(); item.status = "PASS"; } catch (e) { item.status = "FAILED"; throw e; } }
try {
  group("same-failed-input-new-installed-binary-and-no-paid-retry", () => {
    assert.equal(old.status, "FAILED"); assert.equal(old.matrix.length, 12);
    assert(old.matrix.every(cell => cell.status === "FAILED_MENU_OCCLUSION"));
    assert.equal(current.status, "PASS"); assert.deepEqual(current.cartridge, old.cartridge);
    assert.equal(sha(fs.readFileSync(current.cartridge.path)), current.cartridge.sha256);
    assert.deepEqual(current.originalComponent, old.originalComponent);
    assert.equal(current.layoutSha256, old.layoutSha256);
    assert.notEqual(current.executable.sha256, old.executable.sha256);
    assert.equal(current.installation.version, "1.9.40");
    const install = verifiedInstalledCandidate(current.receipt.path);
    assert.equal(sha(fs.readFileSync(current.receipt.path)), current.receipt.sha256);
    assert.equal(install.resources.find(p => /agentvn-player\.exe$/i.test(p.path)).sha256, current.executable.sha256);
    assert.equal(current.modelRequests, 0); assert.equal(current.paidRequests, 0);
    return { oldVersion: old.installation.version, newVersion: current.installation.version,
      unchangedCartridge: current.cartridge.sha256, unchangedComponent: true, modelRequests: 0 };
  });
  group("full-nonempty-matrix-character-geometry-focus-and-real-clicks", () => {
    assert.equal(current.matrix.length, 12); const combinations = new Set();
    let chars = 0;
    for (const cell of current.matrix) {
      combinations.add(`${cell.width}/${cell.height}/${cell.dpr}/${cell.reduced}`);
      assert([1920, 2560, 3840].includes(cell.width) && cell.height === cell.width * 9 / 16);
      assert([1, 2].includes(cell.dpr) && typeof cell.reduced === "boolean");
      assert.equal(cell.status, "PASS"); assert.equal(cell.componentAction, true); assert.equal(cell.settingsAction, true);
      const { controls, componentRect: box, componentOverflow, overflow } = cell.overlay;
      assert.equal(controls.length, 7); assert.equal(cell.focus.length, 8);
      assert(cell.focus.every(item => item.owned)); assert(overflow <= 1 && componentOverflow.x <= 1 && componentOverflow.y <= 1);
      for (const c of controls) {
        assert(c.centerHit && !c.disabled && c.characters.length);
        assert.equal(c.blockedCharacters.length, 0); assert.equal(c.overlapCharacters.length, 0);
        assert(c.rect.left >= 0 && c.rect.top >= 0 && c.rect.right <= cell.width + 1 && c.rect.bottom <= cell.height + 1);
        for (const char of c.characters) {
          const r = char.rect;
          const area = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left))
            * Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
          assert.equal(area, 0); assert.equal(char.overlapArea, area);
          assert(char.ownsPoint && !char.componentOwnsPoint); chars++;
        }
      }
    }
    assert.equal(combinations.size, 12); assert(chars > 100);
    assert.equal(current.cases.length, 4); assert(current.cases.every(c => c.status === "PASS"));
    assert.equal(current.cases[3].detail.navigations.length, 5);
    assert(current.cases[3].detail.actualResume); assert.deepEqual(current.errors, []);
    return { cells: 12, checkedCharacters: chars, componentActions: 12, settingsActions: 12, actualResume: true };
  });
  group("actual-resource-pixels-and-dpr-screenshots", () => {
    assert.equal(current.image.resourceBytes, 68);
    assert.equal(current.image.resourceSha256, "31debdf420bfe10225d7ff5b26c10266111d1959d0be97fcfcfca9a33e09f245");
    assert.equal(current.screenshots.length, 12);
    for (let i = 0; i < current.screenshots.length; i++) {
      const image = current.screenshots[i], cell = current.matrix[i], bytes = fs.readFileSync(image.path);
      assert.equal(sha(bytes), image.sha256); assert.deepEqual(image.before, image.after);
      assert.equal(image.before.width, cell.width); assert.equal(image.before.height, cell.height);
      assert.equal(image.before.reduced, cell.reduced); assert(Math.abs(image.before.dpr - cell.dpr) < 1e-6);
      assert.equal(bytes.readUInt32BE(16), cell.width * cell.dpr);
      assert.equal(bytes.readUInt32BE(20), cell.height * cell.dpr);
    }
    assert.equal(current.physical4KClaimed, false); assert.equal(current.standaloneSetupClaimed, false);
    return { images: 12, pngDimensionsVerified: true, viewportSimulationOnly: true };
  });
  group("source-to-build-to-install-and-owned-cleanup", () => {
    const source = read(path.join(base, "browser-02/report.json")); assert.equal(source.status, "PASS");
    assert.equal(source.matrix.length, 12); assert.equal(source.cleanup, "PASS");
    for (const stage of ["gates-01", "dev-01", "release-01", "resources-01"]) {
      const result = read(path.join(base, stage, "report.json")); assert.equal(result.status, "PASS");
      assert(result.commands.length && result.commands.every(c => c.status === "PASS" && c.exitCode === 0));
      for (const file of result.sources) assert.equal(sha(fs.readFileSync(file.path)), file.sha256);
      for (const command of result.commands) assert.equal(sha(fs.readFileSync(command.log.path)), command.log.sha256);
    }
    assert.equal(current.cleanup, "PASS"); assert.equal(current.normalCloseClaimed, false);
    const now = rows(), known = new Set(current.known.map(p => `${p.ProcessId}:${p.Created}`));
    assert(!now.some(p => known.has(`${p.ProcessId}:${p.Created}`)));
    assert.equal(listeners([current.launch.port]).length, 0);
    const install = read(current.receipt.path);
    assert.equal(install.metadataRestoration, "PASS");
    const changedResources = install.resources.filter(r => /renpyTitleControls\.ts|RenpyTitleView\.tsx/.test(r.path));
    assert.equal(changedResources.length, 2);
    for (const resource of changedResources) {
      const relative = path.relative(install.installRoot, resource.path);
      assert.equal(sha(fs.readFileSync(path.resolve(__dirname, "..", relative))), resource.sha256);
    }
    return { buildStages: 4, exactProcessPortCleanup: true, defaultDataAndRegistrationRestored: true };
  });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString(); fs.writeFileSync(target, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, groups: report.groups.length, target, error: report.error }));
