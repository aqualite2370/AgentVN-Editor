"use strict";
// Independent audit; retains every original failure and cleans only the
// precisely identified Downloads file after archive, reimport and Player proof.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const editorRoot = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-56";
const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/control-code-installed-1924-02";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const editor = read(path.join(editorRoot, "report.json")), player = read(path.join(playerRoot, "report.json"));
const review = read(path.join(base, "control-export-review-01/report.json"));
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const key = r => `${r.width}/${r.height}/${r.dpr}/${r.reduced}`;
function business(p) {
  assert.equal(p.status, "PASS"); assert(p.finishedAt && !p.error && !p.cleanupError && !p.captureError);
  assert.deepEqual(p.pageErrors, []); assert.equal(p.modelRequests, 0); assert.equal(p.productChanges, 0); assert.equal(p.builds, 0);
  assert.equal(p.cells.length, 12); assert.equal(p.rawControlSamples.length, 36);
  for (const d of matrix) {
    const matches = p.cells.filter(c => key(c) === key(d)); assert.equal(matches.length, 1);
    const c = matches[0]; assert.equal(c.status, "PASS");
    for (const [id, n, color] of [
      ["title_start_button", c.start, "rgb(127, 54, 100)"],
      ["title_about_button", c.about, "rgb(49, 91, 114)"],
    ]) {
      assert.equal(n.tag, "BUTTON"); assert.equal(n.slotCount, "1");
      assert.equal(n.color, color); assert.equal(n.radius, `${6 * d.width / 1280}px`);
      assert(n.hit && !n.disabled && !n.inert && n.text.trim() && n.overflow <= 1);
      const r = n.rect; assert(r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 &&
        r.right <= d.width + 1 && r.bottom <= d.height + 1);
      if (id === "title_start_button") {
        assert.equal(n.images.length, 1); assert.equal(n.images[0].sha256, review.cartridge.image.sha256);
      }
    }
    assert.deepEqual(c.aboutAction, { actualAbout: true, returned: true });
    const samples = p.rawControlSamples.filter(s => key(s.viewport) === key(d));
    assert.equal(samples.length, 3); assert.equal(samples.filter(s => s.id === "title_start_button").length, 2);
    assert(samples.every(s => s.actual.hit));
  }
  assert.equal(p.story.actualStartAction, true);
  assert.equal(p.story.text, "本轮独立 UI 验收，不影响用户工程。");
  return { cells: 12, actualControlSamples: 36, aboutRoundtrips: 12, actualStoryStart: 1 };
}
if (process.argv.includes("--self-test")) {
  business(player);
  const mutations = [
    r => { r.status = "RUNNING"; }, r => { r.cells = []; }, r => { r.cells[0] = r.cells[1]; },
    r => { r.cells[0].start.images[0].sha256 = "wrong"; }, r => { r.cells[0].about.hit = false; },
    r => { r.cells[0].about.rect.right = 99999; }, r => { r.cells[0].aboutAction.returned = false; },
    r => { r.story.actualStartAction = false; }, r => { r.rawControlSamples.pop(); },
  ];
  for (const mutate of mutations) { const bad = structuredClone(player); mutate(bad); assert.throws(() => business(bad)); }
  console.log(JSON.stringify({ status: "PASS", invalidReceiptsRejected: mutations.length, scope: "AUDIT_ONLY" }));
} else {
  assert.equal(process.argv[2], "01");
  const out = path.join(base, "control-roundtrip-audit-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
    scope: "NATIVE_PORTABLE_REIMPORT_COMPLETED_DOWNLOAD_AND_INSTALLED_PREVIEW_PLAYER_NOT_ALL_CONTROLS_OR_STANDALONE_OR_ANDROID",
    inputs: [path.join(editorRoot, "report.json"), path.join(playerRoot, "report.json"),
      path.join(base, "control-export-review-01/report.json")].map(desc),
    modelRequests: 0, productChanges: 0, builds: 0, nativeDownloadCleanup: "NOT_RUN" };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g); save();
    try { g.detail = fn(); g.status = "PASS"; } catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
    finally { save(); }
  }
  try {
    group("Native picker, real portable reimport, completed download and preserved failure boundaries", () => {
      const original = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-54/report.json");
      assert.equal(original.status, "FAILED"); assert.equal(original.cases[0].status, "PASS");
      assert.equal(original.cases[1].status, "PASS");
      assert.equal(editor.status, "FAILED"); assert.equal(editor.cases[0].status, "PASS");
      assert.match(editor.error, /Expected values to be strictly deep-equal/);
      assert.equal(editor.nativeCacheRestoration, "PASS"); assert.deepEqual(editor.errors, []);
      assert.equal(editor.nativePickerCompletion.requestId, editor.nativePicker.id);
      assert.equal(editor.nativePickerCompletion.ownerPid, editor.nativePicker.ownerPid);
      assert.equal(editor.nativePickerCompletion.interaction, "COMPUTER_USE_SKY_NATIVE_DIALOG");
      assert.equal(path.resolve(editor.nativePickerCompletion.selectedPath), path.resolve(editor.portable.path));
      assert.equal(review.status, "PASS"); assert.equal(review.inheritedChanges.length, 5);
      assert.equal(review.badLayoutsRejected, 4);
      assert.deepEqual(review.profiles, editor.profiles);
      for (const f of [...review.normalizationSources, review.source, review.installation, review.tool,
        review.cartridge, editor.portable]) assert.equal(sha(f.path), f.sha256);
      return { actualAuthorAndSaveSource: "editor54", actualNativeReimport: "editor56",
        exactDownloadedBytes: review.cartridge.sha256, originalFailedReceiptsUnchanged: true,
        inheritedNormalizationOnly: 5 };
    });
    group("Actual installed Player controls, image bytes and native actions across twelve displays", () => business(player));
    group("Frozen source identities, actual viewport screenshots and exact owned-process cleanup", () => {
      const installed = read(review.installation.path);
      assert.equal(installed.executable.version, "1.9.24");
      assert.equal(player.executable.sha256, "6e7f4ec17d8388a99937123f88ddf7cebbe161fac39a19cfe3a3bc849e642168");
      for (const f of [installed.executable, ...installed.resources, ...installed.protectedFiles,
        player.executable, player.tool, player.source, ...player.rendererSources]) assert.equal(sha(f.path), f.sha256);
      assert.equal(player.launches.length, 1);
      assert.deepEqual(player.launches[0].args, ["--mode", "preview", "--cartridge", review.cartridge.path]);
      assert.equal(path.resolve(player.launches[0].executable.path), path.resolve(installed.installRoot, "agentvn-player.exe"));
      assert.equal(player.screenshots.length, 12);
      for (const d of matrix) {
        const screenshots = player.screenshots.filter(s => key(s.before) === key(d)); assert.equal(screenshots.length, 1);
        const s = screenshots[0]; assert.deepEqual(s.before, s.after);
        assert.equal(sha(s.path), s.sha256);
        const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), d.width * d.dpr);
        assert.equal(b.readUInt32BE(20), d.height * d.dpr);
      }
      const current = rows();
      for (const r of [editor, player]) {
        assert(r.cleanups.length > 0 && r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
        const ports = r.cleanups.flatMap(c => c.ports || [c.port]);
        assert.deepEqual(listeners(ports), []);
        assert(r.knownProcesses.length > 0);
        for (const p of r.knownProcesses) assert(!current.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
      }
      return { installedVersion: "1.9.24", actualWebViewSimulatedDisplays: 12, png: 12,
        exactProcessIdentities: editor.knownProcesses.length + player.knownProcesses.length,
        normalCloseClaimed: false, physical4KClaimed: false };
    });
    group("Original Editor cache and Player profiles restored by identity and original bytes", () => {
      const cache = read(path.join(editorRoot, "native-cache-restoration.json"));
      const protection = read(path.join(editorRoot, "native-cache-protection.json"));
      assert.equal(cache.status, "PASS"); assert.equal(cache.deletedUserFiles, 0);
      assert.equal(cache.originalDirectoryId, protection.directoryId);
      assert(!fs.existsSync(protection.held));
      for (const f of protection.files) assert.equal(sha(path.join(protection.original, f.relative)), f.sha256);
      assert(ps(`fsutil file queryfileid '${protection.original}'`).includes(protection.directoryId));
      const restored = read(path.join(playerRoot, "profile-restoration.json"));
      assert.equal(player.profileRestored, true); assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      let files = 0;
      for (const r of restored.restored) {
        assert(ps(`fsutil file queryfileid '${r.original}'`).includes(r.directoryId));
        if (r.byteInventory) for (const f of r.files) { assert.equal(sha(path.join(r.original, f.relative)), f.sha256); files++; }
      }
      return { editorFiles: protection.files.length, playerFiles: files, restoredProfiles: restored.restored.length };
    });
    const file = editor.portable.originalNativePath;
    assert.equal(path.resolve(path.dirname(file)).toLowerCase(), "c:\\users\\1\\downloads");
    assert.equal(path.basename(file), "安装版普通设置与安全代码独立工程_20261024_212949.vnproj");
    assert.equal(sha(file), editor.portable.sha256);
    assert.equal(sha(editor.portable.path), editor.portable.sha256);
    report.nativeDownload = { original: file, archive: desc(editor.portable.path), originalBytes: fs.statSync(file).size };
    fs.unlinkSync(file); assert(!fs.existsSync(file));
    report.nativeDownloadCleanup = "REMOVED_ONLY_EXACT_TEST_PACKAGE_AFTER_ARCHIVE_REIMPORT_AND_PLAYER";
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
}
