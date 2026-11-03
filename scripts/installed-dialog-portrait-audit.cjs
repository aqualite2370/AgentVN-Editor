"use strict";
// Independent terminal evidence, profile and source audit; no product fixes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip"), { sha } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-dialog-portrait-20261019-03";
const author = "D:/AgentVN/output/installed-dialog-portrait-20261019-02", previous = "D:/AgentVN/output/installed-dialog-portrait-20261019-01";
const dest = `${base}/audit-01.json`; assert(!fs.existsSync(dest));
const report = { status: "RUNNING", at: new Date().toISOString(), groups: [], sources: [], downloadsCleanup: [],
  scope: "EVIDENCE_RESTORATION_AUDIT_NOT_ADDITIONAL_PRODUCT_FUNCTIONS" };
const read = p => { report.sources.push({ path: p, sha256: sha(p) }); return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); };
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
(async () => {
  const prior = read(`${previous}/execution-01.json`), oldEditor = read(`${previous}/editor-01.json`);
  const run = read(`${base}/execution-01.json`), editor = read(`${author}/editor-01.json`), player = read(`${base}/player-01.json`);
  const prep = read(`${base}/preparation.json`), fixture = read(`${author}/fixtures.json`);
  assert(prior.finishedAt && run.finishedAt && editor.finishedAt && player.finishedAt);
  report.sourceConclusion = player.status;
  await check("Immutable first QA download failure, exact historical runner and independent history record retained", () => {
    assert.equal(prior.status, "FAILED"); assert.equal(oldEditor.status, "FAILED");
    assert(oldEditor.error.includes("Actual WebView download did not complete")); assert.equal(oldEditor.cartridges.length, 0);
    assert.equal(oldEditor.checks.filter(c => c.status === "PASS").length, 3);
    const snapshot = "F:/AgentVN/Checkpoints/Dialog-Portrait-20261019-01/attempt-01-runners";
    for (const r of prior.runners) assert.equal(sha(path.join(snapshot, path.basename(r.path))), r.sha256);
    const restored = read(`${previous}/profile-restoration.json`);
    const local = restored.profiles.find(p => p.app === "editor" && p.kind === "Local");
    const file = path.join(local.testHeld, "EBWebView/Default/History");
    const history = new DatabaseSync(file, { readOnly: true });
    let downloads;
    try { downloads = history.prepare("select current_path,target_path,received_bytes,total_bytes,state,danger_type,interrupt_reason from downloads").all(); }
    finally { history.close(); }
    assert.equal(downloads.length, 1); assert(downloads[0].target_path.includes("F:/AgentVN/QA/Dialog-Portrait-20261019-01/"));
    assert.equal(downloads[0].received_bytes, 0); assert.equal(downloads[0].interrupt_reason, 1);
    return { downloads, classification: "QA_MIXED_WINDOWS_DOWNLOAD_PATH; NOT_A_PORTRAIT_PRODUCT_RESULT" };
  });
  await check("Real installed author picker, native save/reopen and both actual UI exports preserve exact authored byte identity", async () => {
    assert.equal(editor.status, "PASS"); assert.equal(editor.checks.length, 5); assert(editor.checks.every(c => c.status === "PASS"));
    assert.equal(editor.cartridges.length, 2); assert.deepEqual(editor.pageErrors, []);
    assert.equal(sha(fixture.input), fixture.inputSha256);
    const checks = [];
    for (const c of editor.cartridges) {
      assert.equal(sha(c.path), c.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(c.path));
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      const script = JSON.parse(await zip.file("script.json").async("string"));
      const scene = script.scenes.find(s => s.scene_id === fixture.scene), portrait = manifest.assets.find(a => a.asset_id === fixture.portrait.id);
      assert.equal(scene.commands[0].portrait, fixture.portrait.id); assert(!scene.commands[1].portrait);
      assert.equal(require("./lib/installed-acceptance.cjs").sha256(await zip.file(portrait.path).async("nodebuffer")), fixture.portrait.sha256);
      assert.equal(require("./lib/installed-acceptance.cjs").sha256(await zip.file("script.json").async("nodebuffer")), c.scriptSha256);
      checks.push({ layout: c.layout, cartridge: c.sha256, portrait: fixture.portrait.sha256 });
    }
    assert.equal(editor.cartridges[0].scriptSha256, editor.cartridges[1].scriptSha256);
    return checks;
  });
  await check("Second failed Player synchronization preserved; successful authoring reused without repeated export", () => {
    const failed = read(`${author}/player-01.json`), priorRun = read(`${author}/execution-01.json`);
    assert.equal(failed.status, "FAILED"); assert.equal(failed.cells.length, 0);
    assert(failed.error.includes("InstalledRuntimeSession.command")); assert.equal(failed.launches.length, 1);
    assert.equal(failed.launches[0].cleanup.status, "PASS");
    const snapshot = "F:/AgentVN/Checkpoints/Dialog-Portrait-20261019-01/attempt-02-runners";
    for (const r of priorRun.runners) assert.equal(sha(path.join(snapshot, path.basename(r.path))), r.sha256);
    assert.equal(run.authoringReused.sha256, sha(`${author}/editor-01.json`));
    assert.equal(run.authoringReused.noRepeatedAuthoringOrExport, true);
    assert(!run.commands.some(c => c.label === "editor" || c.label === "launch"));
    return { classification: "QA_REVEAL_CLICK_COMPLETION_RACE; NO_PORTRAIT_ASSERTIONS_REACHED",
      noRepeatedAuthoringOrExport: true };
  });
  await check("Exact24 distinct real Player observations and two unbound controls; absent dedicated portrait is not generic-image PASS", () => {
    assert.equal(player.status, "FAILED"); assert.equal(run.status, "FAILED"); assert.equal(run.sourceConclusion, "FAILED");
    assert.equal(player.cells.length, 24); assert.equal(player.launches.length, 2); assert.equal(player.controls.length, 2);
    assert(!player.error && !player.cleanupError && !run.cleanupError); assert.deepEqual(player.pageErrors, []);
    const names = new Set();
    for (const c of player.cells) {
      assert(!names.has(c.name)); names.add(c.name); assert(c.finishedAt);
      assert.equal(c.status, "FAILED"); assert(c.error.includes("No visible dedicated dialogue portrait"));
      assert.equal(c.bound.boundCommand, true); assert.equal(c.bound.dialogVisible, true); assert.equal(c.bound.dialogDone, true);
      assert.deepEqual(c.bound.viewport, { width: c.viewport.width, height: c.viewport.height, dpr: c.viewport.dpr, reduced: c.viewport.reduced });
      assert.equal(c.bound.horizontalOverflow, false);
      assert.equal(c.bound.images.filter(i => i.sha256 === fixture.portrait.sha256 && i.visible).length, 0);
      // This candidate has no alternative CSS/canvas/SVG image renderer. Do
      // not infer absence from an IMG-only oracle if such a renderer appears.
      assert.deepEqual(c.bound.otherPrimitives, []); assert.deepEqual(c.bound.backgroundImages, []);
    }
    for (const l of ["agentvn", "renpy"]) for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const d of [1, 2]) for (const m of ["normal", "reduced"]) assert(names.has(`${l}-${w}x${h}-dpr${d}-${m}`));
    for (const c of player.controls) { assert.equal(c.observation.command, "1"); assert(c.observation.text.includes("PORTRAIT_CONTROL")); }
    return { combinations: names.size, defect: "DIALOG-PORTRAIT-01", dedicatedPortraitResult: "FAILED",
      classification: "BOUND_EXPORT_PRESENT_BUT_ACTUAL_PLAYER_HAS_NO_PORTRAIT" };
  });
  await check("Native screenshot PNG dimensions and all runner/source/cartridge hashes match", () => {
    for (const r of run.runners) assert.equal(sha(r.path), r.sha256);
    for (const r of player.sources) assert.equal(sha(r.path), r.sha256);
    const all = [...oldEditor.screenshots, ...editor.screenshots, ...player.screenshots];
    assert.equal(player.screenshots.length, 24);
    for (const s of all) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const png = fs.readFileSync(s.path);
      assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(png.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    return { totalNativePngs: all.length, playerPngs: player.screenshots.length };
  });
  await check("Both sessions finally restored four original default profiles and55 independent original hashes", () => {
    for (const b of [previous, author, base]) {
      const p = read(`${b}/preparation.json`), restored = read(`${b}/profile-restoration.json`);
      assert.equal(restored.status, "PASS"); let count = 0;
      for (const row of p.profiles) {
        assert(fs.existsSync(row.original) && !fs.existsSync(row.held));
        for (const f of row.files) { assert.equal(sha(path.join(row.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
      }
      assert.equal(count, 55);
    }
    assert.equal(prior.profileRestoration, "PASS"); assert.equal(run.profileRestoration, "PASS"); return { files: 55, profiles: 4, sessions: 3 };
  });
  await check("Frozen installed binaries, Dev and560 product-source baseline unchanged except earlier seven authorized Editor files", () => {
    assert.equal(sha(`${prep.installRoot}/agentvn-editor.exe`), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(`${prep.installRoot}/agentvn-player.exe`), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const frozen = read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    const allowed = new Map(read("D:/AgentVN/output/editor-selection-mask-20261019-01/terminal-audit-02.json").sources
      .map(s => [path.resolve("D:/AgentVN", s.file), s.sha256]));
    assert.equal(frozen.source.length, 560); assert.equal(allowed.size, 7);
    for (const s of frozen.source) assert.equal(sha(s.path), allowed.get(path.resolve(s.path)) || s.sha256);
    return { productFiles: 560, newBuilds: 0, modelRequests: 0 };
  });
  await check("No owned product process or CDP/backend listener remains", () => {
    const launches = [read(`${previous}/launch.json`), read(`${author}/launch.json`)];
    const ports = [...launches.flatMap(l => [l.cdpPort, l.playerCdpPort, 8278]), ...player.launches.map(l => l.port)];
    assert(player.launches.every(l => l.cleanup?.status === "PASS"));
    const command = `$p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or ` +
      `($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')});` +
      `$t=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})});` +
      `@{processes=@($p|Select-Object ProcessId,Name);ports=@($t|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4`;
    const remaining = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true, encoding: "utf8", timeout: 20000 }));
    assert.equal(remaining.processes.length, 0); assert.equal(remaining.ports.length, 0); return remaining;
  });
  await check("Only two exact current generated Downloads packages removed after verified independent F copies", () => {
    for (const r of [oldEditor, editor]) {
      const p = r.portable; assert(p);
      assert.equal(path.dirname(path.resolve(p.original)).toLowerCase(), path.resolve("C:/Users/1/Downloads").toLowerCase());
      assert(path.basename(p.original).startsWith(fixture.title)); assert.equal(path.extname(p.original), ".vnproj");
      assert.equal(sha(p.original), p.sha256); assert.equal(sha(p.retained), p.sha256);
      fs.unlinkSync(p.original);
      const c = { path: p.original, retained: p.retained, sha256: p.sha256, removed: !fs.existsSync(p.original), recoverable: true };
      report.downloadsCleanup.push(c); assert(c.removed);
    }
    return report.downloadsCleanup;
  });
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); fs.writeFileSync(dest, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, sourceConclusion: report.sourceConclusion, groups: report.groups.length, error: report.error, dest })); });
