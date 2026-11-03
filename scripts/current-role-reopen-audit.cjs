"use strict";
// Independent artifact/byte review. No product runs, model calls or repairs.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { normalizeInstalledControls } = require("./lib/installed-control-normalization.cjs");
const { qa, authorRoot, playerRoot, editorRoot } = require("./current-role-closure.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const root = editorRoot + "/editor-14", file = root + "/report.json", r = read(file);
const author = read(authorRoot + "/report.json");
const actual = descriptor();
const expected = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const key = d => `${d.width}/${d.height}/${Number(d.dpr.toFixed(6))}/${d.reduced}`;
function structure(value) {
  assert.equal(value.status, "FAILED"); assert(value.finishedAt && !value.cleanupError && !value.captureError);
  assert.match(value.error, /12 !== 0/);
  assert.equal(value.version, "1.9.35"); assert.equal(value.cases.length, 3);
  assert.deepEqual(value.cases.map(c => c.status), ["PASS", "PASS", "FAILED"]);
  assert(value.cases.every(c => c.finishedAt)); assert.equal(value.violations.length, 12);
  assert.deepEqual(value.errors, []); assert.equal(value.productChanges, 0);
  assert.equal(value.builds, 0); assert.equal(value.modelRequests, 0);
  assert.equal(value.matrix.length, 12);
  for (const d of expected) {
    const found = value.matrix.filter(row => key(row.display) === key(d));
    assert.equal(found.length, 1); const row = found[0];
    assert.equal(row.status, "FAILED"); assert(row.finishedAt);
    assert.equal(row.draftPreserved, false); assert.equal(row.executionBlocked, true); assert.equal(row.savedLayoutUnchanged, true);
    const violation = value.violations.filter(v => key(v.display) === key(d)); assert.equal(violation.length, 1);
    assert.equal(violation[0].issue, "Invalid unsaved code lost on workspace roundtrip without explicit discard");
    // This run really reached export in every cell. Do not credit a missing
    // panel or an unobserved navigation state as an invalid-code guard.
    assert.equal(row.publication.status, "LAST_SAVED_VALID_LAYOUT_EXPORTED");
    assert(row.publication.cartridge.path && row.publication.cartridge.sha256);
  }
  assert.equal(value.screenshots.length, 14);
  assert.equal(value.cases[0].detail.bothLayoutsAnd24RoleStatesExact, true);
  assert.equal(value.cases[0].detail.actualNativePicker, true);
}
async function archive() {
  const zip = await JSZip.loadAsync(fs.readFileSync(r.portable.path), { checkCRC32: true });
  const project = JSON.parse(await zip.file("project.json").async("string"));
  assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, r.reopened);
  assert.deepEqual(r.reopened, author.authored.settings.runtimeUILayoutProfiles);
  assert.deepEqual(r.savedProfiles.profiles.agentvn, r.reopened.profiles.agentvn);
  assert.deepEqual(r.savedProfiles.profiles.renpy.renpy.shared.buttonRoles, author.expected);
  const control = r.savedProfiles.profiles.renpy.screens.find(s => s.screen_id === "title")
    .components.find(c => c.component_id === "title_start_button");
  assert.equal(control.presentation.css, ".root { background-color: #315b72; border-radius: 6px; } .body { color: #f6f8ff; }");
  assert.equal(control.presentation.html, '<span class="root"><span class="body"><slot name="content"></slot></span></span>');
  return { actualPortableBytes: true, freshReopen: true, bothLayoutsExact: true, sixRoles: 6, configuredStates: 24 };
}
async function exports() {
  let files = 0;
  const normalized = normalizeInstalledControls(read(r.installation.path), r.savedProfiles.profiles.renpy);
  for (const row of r.matrix) {
    const receipt = row.publication.cartridge; assert.equal(sha(receipt.path), receipt.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(receipt.path), { checkCRC32: true });
    const skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
    assert.deepEqual(skin, normalized.layout); assert.deepEqual(row.publication.normalization, normalized.evidence);
    const checks = JSON.parse(await zip.file("checksum.json").async("string"));
    assert(checks.files.length > 0); const unique = new Set();
    for (const f of checks.files) {
      assert.equal(typeof f.path, "string");
      assert(!f.path.includes("\\") && !f.path.includes(":") &&
        !f.path.split("/").some(p => !p || p === "." || p === ".."));
      assert(!unique.has(f.path)); unique.add(f.path);
      const entry = zip.file(f.path); assert(entry); const bytes = await entry.async("nodebuffer");
      assert.equal(bytes.length, f.size_bytes);
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), f.hash_sha256); files++;
    }
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    assert(unique.has(manifest.entry_script));
    for (const entry of Object.values(zip.files).filter(f => !f.dir && /\.(?:json|css|html)$/.test(f.name))) {
      const value = await entry.async("string");
      assert(!value.includes("__qaInvalidPublicationExecuted"));
      assert(!value.includes("--qa-invalid-publication"));
    }
  }
  return { actualUIExports: 12, checksummedFiles: files,
    lastSavedValidSourceOnly: true, invalidExecutableHTMLAndGlobalCSSAbsent: true };
}
function provenance() {
  for (const f of [r.source, r.portable, r.installation, r.tool, r.workspaceTool, ...actual.resources])
    assert.equal(sha(f.path), f.sha256);
  assert.equal(r.tool.sha256, r.workspaceTool.sha256);
  assert.deepEqual(read(r.installation.path).executable, actual.executable);
  const picker = read(r.nativePicker.path);
  assert.equal(sha(r.nativePicker.path), r.nativePicker.sha256);
  assert.equal(picker.status, "PASS"); assert.equal(picker.ownerPid, r.launches[0].pid);
  assert.equal(path.resolve(picker.directory), path.resolve(r.portable.path));
  const bindingRoot = path.join(qa, "player-binding-02");
  const session = read(path.join(bindingRoot, "session-binding.json"));
  for (const f of [session.base, session.preview, session.adaptedBase]) assert.equal(sha(f.path), f.sha256);
  let before = fs.readFileSync(session.base.path, "utf8");
  for (const change of session.edits) {
    assert.equal(before.split(change.before).length - 1, 1);
    before = before.replace(change.before, change.after);
  }
  assert.equal(before, fs.readFileSync(session.adaptedBase.path, "utf8"));
  assert.equal(read(qa + "/closure-audit-01/report.json").status, "PASS");
  return { actualNSISReceipt: true, nativePickerOwnerAndPath: true,
    exactArchivedTool: true, sharedSessionGuardOnlyRelocated: true };
}
function cleanup() {
  for (const picture of r.screenshots) {
    assert.equal(sha(picture.path), picture.sha256); assert.deepEqual(picture.before, picture.after);
    const display = expected.find(d => key(d) === key(picture.before)); assert(display);
    const bytes = fs.readFileSync(picture.path);
    assert.equal(bytes.readUInt32BE(16), display.width * display.dpr);
    assert.equal(bytes.readUInt32BE(20), display.height * display.dpr);
  }
  const identities = new Set(), ports = [];
  const confirm = read(editorRoot + "/editor-15/report.json");
  const all = [r, author, read(playerRoot + "/report.json"), confirm];
  for (const report of all) {
    for (const launch of report.launches) {
      for (const p of launch.knownProcesses ?? []) identities.add(`${p.ProcessId}:${p.Created}`);
      if (launch.port) { ports.push(launch.port); assert.equal(launch.cleanup.status, "PASS"); }
      for (const port of launch.ports ?? []) ports.push(port);
    }
    for (const c of report.cleanups ?? []) {
      assert.equal(c.status, "PASS"); for (const p of c.killed) identities.add(p);
    }
  }
  assert.deepEqual(listeners(ports), []);
  for (const p of rows()) assert(!identities.has(`${p.ProcessId}:${p.Created}`));
  const cache = read(root + "/native-cache-protection.json"), restored = read(root + "/native-cache-restoration.json");
  assert.equal(r.nativeCacheRestoration, "PASS"); assert.equal(restored.status, "PASS");
  assert.equal(restored.deletedUserFiles, 0); assert.equal(restored.originalDirectoryId, cache.directoryId);
  assert(!fs.existsSync(cache.held)); assert(ps(`fsutil file queryfileid '${cache.original}'`).includes(cache.directoryId));
  for (const f of cache.files) assert.equal(sha(path.join(cache.original, f.relative)), f.sha256);
  for (const n of ["10", "11", "12", "13"]) {
    const failed = read(editorRoot + `/editor-${n}/report.json`); assert.equal(failed.status, "FAILED");
    assert(failed.finishedAt && !failed.cleanupError);
    for (const c of failed.cleanups) assert.equal(c.status, "PASS");
  }
  const oldPlayer = read(path.join(path.dirname(playerRoot), "roles-installed-1935-01/report.json"));
  assert.equal(oldPlayer.status, "FAILED"); assert.equal(oldPlayer.launches.length, 0);
  assert.equal(oldPlayer.profileRestoration.status, "PASS");
  const restoredConfirm = read(editorRoot + "/editor-15/native-cache-restoration.json");
  assert.equal(restoredConfirm.status, "PASS"); assert.equal(restoredConfirm.deletedUserFiles, 0);
  return { strictPNGs: 14, ownedProcessIdentities: identities.size, absentPorts: new Set(ports).size,
    originalCacheRestored: true, historicalQAFailuresRetained: 5, deletedUserFiles: 0 };
}
(async () => {
  const out = qa + "/reopen-invalid-audit-01"; assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), input: desc(file),
    author: desc(authorRoot + "/report.json"), groups: [], productChanges: 0, builds: 0, modelRequests: 0 };
  const save = () => fs.writeFileSync(out + "/report.json", JSON.stringify(report, null, 2));
  const group = async (name, fn) => {
    const item = { name, status: "RUNNING" }; report.groups.push(item); save();
    try { item.detail = await fn(); item.status = "PASS"; }
    catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
    finally { save(); }
  };
  try {
    await group("Complete failed matrix verified; incomplete or falsely passing receipts rejected", () => {
      structure(r);
      const mutations = [x => x.matrix = [], x => x.matrix[0] = x.matrix[1],
        x => x.matrix[0].draftPreserved = true, x => x.matrix[0].executionBlocked = false,
        x => x.matrix[0].publication.status = "UNOBSERVED", x => x.cases.pop()];
      for (const change of mutations) { const copy = structuredClone(r); change(copy); assert.throws(() => structure(copy)); }
      return { displays: 12, rejectedIncompleteReceipts: mutations.length };
    });
    await group("Fresh native archive and original role/profile bytes", archive);
    await group("Twelve actual exports exclude invalid source and retain exact valid layout", exports);
    await group("Exact installed bytes, native picker owner and QA provenance", provenance);
    await group("Focused confirmation has exact before/after source and no discard confirmation", () => {
      const confirm = read(editorRoot + "/editor-15/report.json");
      assert.equal(confirm.status, "FAILED"); assert.match(confirm.error, /1 !== 0/);
      assert.equal(confirm.matrix.length, 1); assert.equal(confirm.violations.length, 1);
      const row = confirm.matrix[0]; assert.equal(row.draftPreserved, false);
      assert(row.before.html.includes("__qaInvalidPublicationExecuted"));
      assert(row.before.css.includes("--qa-invalid-publication")); assert.equal(row.before.saveDisabled, true);
      const component = r.savedProfiles.profiles.renpy.screens.find(s => s.screen_id === "title")
        .components.find(c => c.component_id === "title_start_button");
      assert.equal(row.after.html, component.presentation.html); assert.equal(row.after.css, component.presentation.css);
      assert(!row.dialogs.some(text => /放弃.*(?:修改|保存)|未保存.*(?:修改|布局)|保存并|放弃并/.test(text)));
      assert.equal(row.publication.status, "LAST_SAVED_VALID_LAYOUT_EXPORTED");
      assert.equal(sha(row.publication.cartridge.path), row.publication.cartridge.sha256);
      assert.equal(sha(confirm.tool.path), confirm.tool.sha256);
      for (const picture of confirm.screenshots) {
        assert.equal(sha(picture.path), picture.sha256);
        assert.deepEqual(picture.before, picture.after);
        const bytes = fs.readFileSync(picture.path);
        assert.equal(bytes.readUInt32BE(16), 1920); assert.equal(bytes.readUInt32BE(20), 1080);
      }
      return { oneAdditional1080pConfirmation: true, actualInvalidCodeReplacedBySavedSource: true,
        explicitDiscardConfirmation: false, screenshots: confirm.screenshots.length };
    });
    await group("PNG dimensions, process/port absence and cache restoration", cleanup);
    report.status = "EVIDENCE_VERIFIED_PRODUCT_FAILED_DRAFT_LOSS";
    report.auditStatus = "PASS"; report.productStatus = "FAILED";
    report.functionalResults = { nativeSixRoleReopen: "PASS", invalidSourceExcludedFromExport: "PASS",
      unsavedDraftRetention: "FAILED" };
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, out + "/executed-audit.cjs", fs.constants.COPYFILE_EXCL); save();
    console.log(JSON.stringify(report, null, 2));
  }
})();
