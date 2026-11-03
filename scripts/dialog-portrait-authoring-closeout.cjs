"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Dialog-Portrait-Authoring-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/Dialog-Portrait-Authoring-20261020-01";
const out = path.join(root, "output/dialog-portrait-authoring-20261020-01");
const file = path.join(out, `receipt-${process.argv[2] || "01"}.json`); assert(!fs.existsSync(file));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const artifact = f => ({ path: f, sha256: sha(f), bytes: fs.statSync(f).size, generatedAt: fs.statSync(f).mtime.toISOString() });
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], modelRequests: 0,
  scope: "SOURCE_BROWSER_AUTHORING_AND_RUNTIME_CONSUMPTION_PLUS_DEV_BUILD_NOT_INSTALLED_ACCEPTANCE",
  historicalInstalledLedger: { PASS: 3, FAILED: 9, BLOCKED: 6, unchanged: true } };
async function check(name, fn) {
  const detail = await fn(); report.checks.push({ name, status: "PASS", detail });
}
function validateBrowser(r, expectedCount, expectedChecks) {
  assert.equal(r.status, "PASS"); assert.equal(r.cases.length, expectedCount);
  assert.equal(r.modelRequests, 0); assert.equal(r.cleanup.status, "PASS");
  for (const s of r.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
  assert.equal(new Set(r.cases.map(c => c.key)).size, expectedCount);
  for (const c of r.cases) {
    assert.equal(c.status, "PASS"); assert.equal(c.checks.length, expectedChecks);
    const s = c.screenshot; assert.equal(sha(s.path), s.sha256);
    const bytes = fs.readFileSync(s.path);
    assert.deepEqual(s.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
    assert.deepEqual(s.after, s.before);
    assert.equal(bytes.readUInt32BE(16), c.width * c.dpr); assert.equal(bytes.readUInt32BE(20), c.height * c.dpr);
  }
}
(async () => {
  const prep = read(path.join(out, "preparation.json"));
  const authorFile = path.join(qa, "editor-full-02/report.json"), author = read(authorFile);
  const playerFile = path.join(qa, "player-full-04/report.json"), player = read(playerFile);
  const exportedFile = path.join(qa, "green-editor-smoke-04/report.json"), exported = read(exportedFile);
  await check("Original missing UI red and all interim failed reports retained", async () => {
    assert.equal(sha(prep.input), prep.inputSha256);
    assert.equal(sha(path.join(checkpoint, "AgentVN Dev.before.exe")), prep.dev.sha256);
    const originals = ["red-editor-01", "green-editor-smoke-01", "green-editor-smoke-02", "green-editor-smoke-03",
      "editor-full-01", "player-full-01", "player-full-02", "player-full-03"]
      .map(folder => { const f = path.join(qa, folder, "report.json"); assert.equal(read(f).status, "FAILED"); return artifact(f); });
    assert(read(originals[0].path).cases[0].error.includes("must expose portrait position controls"));
    return { originals, checkpointDev: artifact(path.join(checkpoint, "AgentVN Dev.before.exe")),
      failureKinds: ["real missing author UI", "QA used normal-page selector for structured page",
        "QA imported before reload enabled input", "QA omitted closing intentional fullscreen publishing panel",
        "QA read prior preview frame before requested geometry", "QA launched old same-version record before import completed",
        "QA async wait predicate did not poll; it returned while import was still active (initialization-reset hypothesis NOT established)"] };
  });
  await check("Twelve Editor displays, real backend reopen and portable reimport", async () => {
    validateBrowser(author, 12, 6);
    report.portableProjects = [];
    for (const c of author.cases) {
      const f = path.join(path.dirname(authorFile), `${c.key}.vnproj`);
      const zip = await JSZip.loadAsync(fs.readFileSync(f)), p = JSON.parse(await zip.file("project.json").async("string"));
      for (const type of ["agentvn", "renpy"]) {
        assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles.profiles[type].dialogPortrait, prep.values[type]);
        const a = c.observations[`${type}-custom`], b = c.observations[`${type}-default`];
        assert.equal(a.imageSha256, prep.portraitSha256);
        assert.deepEqual(a.body, b.body); assert.deepEqual(a.speaker, b.speaker);
        assert.equal(c.observations[`${type}-controls`].length, 3);
        const h = c.observations[`${type}-history`]; assert(h);
        for (const r of [h.reset, h.redo]) {
          assert(Math.abs(r.image.x - b.image.x) <= 1 && Math.abs(r.image.y - b.image.y) <= 1);
          assert.deepEqual(r.body, b.body);
        }
        assert(Math.abs(h.undo.image.x - a.image.x) <= 1 && Math.abs(h.undo.image.width - a.image.width) <= 1);
      }
      const image = p.asset_manifest.find(a => a.asset_id === "qa_portrait"); assert(image);
      assert.equal(hash(await zip.file(image.metadata.project_path).async("nodebuffer")), prep.portraitSha256);
      report.portableProjects.push(artifact(f));
    }
    return { evidence: artifact(authorFile), displayConfigurations: 12, typeAuthorFlows: 24,
      backendRestartClaim: false, previewCanvas: "existing 1280x720 Runtime iframe, not twelve standalone display sizes" };
  });
  await check("Actual UI cartridge/library/player consumption in twelve displays", async () => {
    validateBrowser(exported, 1, 6); validateBrowser(player, 12, 2);
    report.cartridges = [];
    for (const a of exported.cases[0].artifacts) {
      assert.equal(sha(a.path), a.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(a.path)), manifest = JSON.parse(await zip.file("manifest.json").async("string")),
        layout = JSON.parse(await zip.file("ui/layout.json").async("string")), script = JSON.parse(await zip.file("script.json").async("string"));
      assert.equal(manifest.runtime_version, "0.22.0");
      assert.deepEqual(layout.dialogPortrait, prep.values[a.type]);
      assert.equal(script.scenes.find(s => s.scene_id === script.entry_scene_id).commands[0].portrait, "qa_portrait");
      const image = manifest.assets.find(a => a.asset_id === "qa_portrait");
      assert.equal(hash(await zip.file(image.path).async("nodebuffer")), prep.portraitSha256);
      for (const c of player.cases) {
        const imported = c.importReceipts[a.type]; assert(imported);
        assert.equal(imported.importing, false); assert.equal(imported.error, undefined);
        assert.equal(imported.layoutType, a.type); assert.deepEqual(imported.config, prep.values[a.type]);
        assert.equal(c.artifacts.find(p => p.type === a.type).sha256, a.sha256);
        assert.equal(c.observations[a.type].imageSha256, prep.portraitSha256);
      }
      report.cartridges.push({ type: a.type, ...artifact(a.path),
        layoutSha256: hash(await zip.file("ui/layout.json").async("nodebuffer")), portraitSha256: prep.portraitSha256 });
    }
    assert.equal(report.cartridges.length, 2);
    const selfTest = path.join(qa, "readiness-self-test-01/report.json");
    assert.equal(read(selfTest).status, "PASS"); assert.equal(read(selfTest).checks.length, 2);
    assert.equal(read(selfTest).checks[0].actual, false); assert.equal(read(selfTest).checks[1].count, 4);
    return { editorExport: artifact(exportedFile), player: artifact(playerFile), readinessToolSelfTest: artifact(selfTest),
      combinations: 12, typePlayFlows: 24,
      boundary: "Two exact UI exports from 1080p author smoke, same current product sources; independently consumed at all twelve Runtime displays" };
  });
  await check("Related behavior, ordered builds and actual Dev overwrite", async () => {
    report.commands = [];
    for (const [folder, count] of [["related-02", 13], ["build-01", 3], ["dev-01", 1]]) {
      const r = read(path.join(qa, folder, "report.json")); assert.equal(r.status, "PASS"); assert.equal(r.steps.length, count);
      for (const s of r.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
      for (const s of r.steps) {
        assert.equal(s.status, "PASS"); assert.equal(s.exitCode, 0);
        report.commands.push({ ...s, log: artifact(path.join(qa, folder, `${s.name}.log`)) });
      }
      if (folder === "dev-01") {
        report.dev = r.dev; assert(r.overwriteEvents.length > 0);
        assert.notEqual(r.devBefore.modifiedAt, r.dev.modifiedAt); report.devOverwriteEvents = r.overwriteEvents;
      }
    }
    assert.equal(sha(report.dev.path), report.dev.sha256);
    assert.equal(sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), report.dev.sha256);
    assert(!report.dev.pending);
    return { commands: report.commands.length, dev: report.dev };
  });
  await check("Bundled shared/Runtime sources and Editor compiled features", async () => {
    report.resources = collectStageResourceEvidence(root, author.sources.map(s => s.file));
    report.player = artifact(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(report.player.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
    report.compiled = [];
    for (const relative of ["GameCli_framework/dist/assets", "editor/dist/gamecli-preview/assets"]) {
      const dir = path.join(root, relative), names = fs.readdirSync(dir).filter(n => /\.js$/.test(n)
        && fs.readFileSync(path.join(dir, n), "utf8").includes("--dialog-portrait-size"));
      assert.equal(names.length, 1); report.compiled.push(artifact(path.join(dir, names[0])));
    }
    assert.equal(report.compiled[0].sha256, report.compiled[1].sha256);
    const editorAssets = path.join(root, "editor/dist/assets");
    const authorJs = fs.readdirSync(editorAssets).filter(n => /\.js$/.test(n)
      && fs.readFileSync(path.join(editorAssets, n), "utf8").includes("dialog-portrait-layout-editor"));
    assert.equal(authorJs.length, 1); report.compiled.push(artifact(path.join(editorAssets, authorJs[0])));
    // No CSS or motion product file was modified by this feature.
    report.unchangedMotion = ["GameCli_framework/src/styles/player.css", "editor/src/styles/layout.css",
      "editor/src/utils/editorTransitionPresentation.ts"].map(file => artifact(path.join(root, file)));
    const priorGui = read(path.join(root, "output/official-gui-consumption-20261020-01/receipt-01.json"));
    const priorTheme = read(path.join(root, "output/theme-icon-source-20261020-01/receipt.json"));
    assert.equal(report.unchangedMotion[0].sha256,
      priorGui.resources.bundled.find(f => f.file === "GameCli_framework/src/styles/player.css").sha256);
    assert.equal(report.unchangedMotion[1].sha256,
      priorTheme.sources.find(f => f.file === "editor/src/styles/layout.css").sha256);
    return { resources: report.resources, player: report.player, compiled: report.compiled,
      motionBoundary: "No stylesheet, motion token or transition state machine edited by this block; no fresh full motion PASS claimed" };
  });
  await check("Frozen installed candidates unchanged and owned service cleanup verified", async () => {
    const installed = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor";
    const expected = [["agentvn-editor.exe", "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c"],
      ["agentvn-player.exe", "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a"],
      ["creator-backend.exe", "db44bd510997a73aee80ba5419d0c9c55e6f73f9a01ad65003915ea089eb5155"]];
    report.frozen = expected.map(([f, expected]) => { const a = artifact(path.join(installed, f)); assert.equal(a.sha256, expected); return a; });
    const services = [];
    for (const folder of ["red-editor-01", "green-editor-smoke-01", "green-editor-smoke-02", "green-editor-smoke-03",
      "green-editor-smoke-04", "player-smoke-01", "editor-full-01", "player-full-01", "editor-full-02", "player-full-02",
      "player-full-03", "player-full-04"]) {
      const r = read(path.join(qa, folder, "report.json")); assert.equal(r.cleanup.status, "PASS");
      services.push({ pid: r.service.pid, url: r.service.url });
      if (r.service.backendPid) services.push({ pid: r.service.backendPid, url: r.service.backendUrl });
    }
    for (const folder of ["related-01", "related-02"]) {
      const r = read(path.join(qa, folder, "default-portrait-evidence/report.json")); assert.equal(r.cleanup.status, "PASS");
      services.push({ pid: r.service.pid, url: r.service.url });
    }
    const pids = [...new Set(services.map(s => s.pid))], ports = [...new Set(services.map(s => Number(new URL(s.url).port)))];
    const command = `$taskPids=@(${pids.join(",")});$taskPorts=@(${ports.join(",")}); ` +
      `$live=@(Get-Process -Id $taskPids -ErrorAction SilentlyContinue | Select-Object Id,ProcessName); ` +
      `$ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $taskPorts } | Select-Object LocalPort,OwningProcess); ` +
      `@{live=$live;ports=$ports} | ConvertTo-Json -Depth 4 -Compress`;
    const actual = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true }));
    assert.equal(actual.live.length, 0); assert.equal(actual.ports.length, 0);
    report.cleanup = { services, pidCount: pids.length, portCount: ports.length, actual };
    return { frozen: report.frozen, cleanup: report.cleanup };
  });
  report.notProven = ["New native Dev UI/restart", "New installed Release", "Windows/Android export/run/upgrades",
    "Portrait NVL/bubble authoring scenarios", "Old Runtime binary rejection of 0.22.0 (API rejection tested only)",
    "Actual whole-matrix motion design reacceptance", "All other historical feature failures/blocks", "Final user project"];
  report.status = "SOURCE_AND_DEV_PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, file, error: report.error })); });
