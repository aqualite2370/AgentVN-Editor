"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Official-GUI-Consumption-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/Official-GUI-Consumption-20261020-01";
const output = path.join(root, "output/official-gui-consumption-20261020-01");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sha = file => hash(fs.readFileSync(file));
const describe = file => ({ path: file, sha256: sha(file), bytes: fs.statSync(file).size, generatedAt: fs.statSync(file).mtime.toISOString() });
const changed = ["GameCli_framework/src/components/player/ChoicePanel.tsx", "GameCli_framework/src/styles/player.css"];
const receiptFile = path.join(output, `receipt-${process.argv[2] || "01"}.json`); assert(!fs.existsSync(receiptFile));
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], modelRequests: 0,
  historicalInstalledLedger: { PASS: 3, FAILED: 9, BLOCKED: 6, unchanged: true },
  scope: "SOURCE_GUI_REAL_UI_EXPORT_AND_RUNTIME_CONSUMPTION_PLUS_DEV_BUILD_NOT_NEW_INSTALLED_ACCEPTANCE" };
async function check(name, fn) {
  const detail = await fn(); report.checks.push({ name, status: "PASS", detail });
}
function captureProof(c, shot) {
  assert.equal(sha(shot.path), shot.sha256);
  const bytes = fs.readFileSync(shot.path);
  assert.deepEqual(shot.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
  assert.deepEqual(shot.after, shot.before);
  assert.equal(bytes.readUInt32BE(16), c.width * c.dpr);
  assert.equal(bytes.readUInt32BE(20), c.height * c.dpr);
}
(async () => {
  const prep = read(path.join(output, "preparation.json"));
  const uiFile = path.join(qa, "editor-smoke-02/report.json"), ui = read(uiFile);
  const playerFile = path.join(qa, "player-full-01/report.json"), player = read(playerFile);
  const protectionFile = path.join(qa, "choice-protection-01/report.json"), protection = read(protectionFile);
  await check("Original official GUI, real UI portable roundtrip and six-dependency cartridge", async () => {
    assert.equal(sha(prep.officialArchive.path), prep.officialArchive.sha256);
    assert.equal(sha(prep.input), prep.inputSha256); assert.equal(ui.status, "PASS"); assert.equal(ui.cases.length, 1);
    const c = ui.cases[0]; assert.equal(c.checks.length, 5); assert(c.checks.every(x => x.status === "PASS"));
    assert.equal(captureProof(c, c.screenshot), undefined);
    for (const a of [c.portable, c.cartridge]) assert.equal(sha(a.path), a.sha256);
    const portable = await JSZip.loadAsync(fs.readFileSync(c.portable.path));
    const project = JSON.parse(await portable.file("project.json").async("string"));
    assert.equal(project.asset_manifest.length, 25);
    assert(project.editor_settings.runtimeUILayoutProfiles.profiles.agentvn);
    assert(project.editor_settings.runtimeUILayoutProfiles.profiles.renpy);
    for (const asset of project.asset_manifest) {
      const proof = c.portable.assets.find(a => a.id === asset.asset_id); assert(proof);
      assert.equal(hash(await portable.file(asset.metadata.project_path).async("nodebuffer")), proof.sha256);
    }
    const cartridge = await JSZip.loadAsync(fs.readFileSync(c.cartridge.path));
    const manifest = JSON.parse(await cartridge.file("manifest.json").async("string"));
    const layout = JSON.parse(await cartridge.file("ui/layout.json").async("string"));
    assert.equal(manifest.assets.length, 6); assert.equal(layout.layout_type, "renpy");
    assert.equal(layout.renpy.shared.fontSize, 22); assert.equal(layout.renpy.shared.spacing, 4);
    assert.equal(layout.renpy.save_load.saveColumns, 3);
    for (const asset of manifest.assets) {
      const proof = c.cartridge.assets.find(a => a.id === asset.asset_id); assert(proof);
      assert.equal(hash(await cartridge.file(asset.path).async("nodebuffer")), proof.sha256);
      assert.equal(proof.sha256, prep.officialFiles.find(f => f.relative === proof.relative).sha256);
    }
    report.artifacts = { portable: c.portable, cartridge: c.cartridge };
    return { ui: describe(uiFile), official: prep.officialArchive, portableAssets: 25, cartridgeAssets: 6,
      realReimport: c.portable.realReimport, EditorAuthoringCombinations: 1,
      runtimeOnlyFixAfterThisUIRun: true, uiNotTwelveEditorCases: true };
  });
  await check("First real failure, reversible CSS probe and post-fix twelve-display Runtime behavior", async () => {
    const failureFile = path.join(qa, "player-smoke-01/report.json"), failure = read(failureFile);
    assert.equal(failure.status, "FAILED"); assert(failure.cases[0].error.includes("a797767c"));
    const diagnosticFile = path.join(qa, "player-diagnostic-01/report.json"), diagnostic = read(diagnosticFile);
    assert.equal(diagnostic.status, "REPRODUCED");
    const probe = diagnostic.cases[0].diagnostic;
    assert.equal(probe.frameMode, "image_owned");
    const original = prep.officialFiles.find(f => f.relative === "gui/button/choice_idle_background.png").sha256;
    assert.equal(probe.singleInlinePriorityOverride.sha256, original);
    assert.notEqual(probe.reverted.sha256, original);
    assert.equal(player.status, "PASS"); assert.equal(player.cases.length, 12); assert.equal(player.modelRequests, 0);
    for (const s of player.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
    for (const c of player.cases) {
      assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 4);
      assert(c.checks.every(x => x.status === "PASS")); assert.deepEqual(c.errors, []);
      assert.equal(c.artifact.sha256, ui.cases[0].cartridge.sha256); captureProof(c, c.screenshot);
      assert.equal(c.samples.choiceImage.sha256, original);
      assert(c.samples.fonts.some(f => f.isCustomFont && /DejaVu/.test(f.familyName) && f.glyphCount > 0));
      assert(c.samples.fonts.some(f => !f.isCustomFont && f.glyphCount > 0));
    }
    return { failure: describe(failureFile), diagnostic: describe(diagnosticFile), postFix: describe(playerFile),
      runtimeCombinations: 12, checks: 48, fontProof: player.cases[0].samples.fonts,
      oneUIExportReusedAcrossActualRuntimeDisplays: true, physical4KClaim: false };
  });
  await check("Controlled option/command precedence, inherited states, nine-slice and AgentVN protection", async () => {
    assert.equal(protection.status, "PASS"); assert.equal(protection.cases.length, 12);
    for (const c of protection.cases) {
      assert.equal(c.status, "PASS"); assert.equal(c.probes.length, 5); assert.deepEqual(c.errors, []);
    }
    return { evidence: describe(protectionFile), combinations: 12, probes: 60,
      fixtures: "public live-preview init; DOM selected/disabled intentionally injected",
      realGameplayStateClaim: false };
  });
  await check("Related gates, sequential builds, actual Editor preview and Dev overwrite", async () => {
    report.commands = [];
    for (const [folder, count] of [["related-02", 13], ["build-01", 4], ["dev-01", 1]]) {
      const r = read(path.join(qa, folder, "report.json"));
      assert.equal(r.status, "PASS"); assert.equal(r.steps.length, count);
      for (const s of r.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
      for (const step of r.steps) {
        assert.equal(step.status, "PASS"); assert.equal(step.exitCode, 0);
        const logFile = path.join(qa, folder, `${step.name}.log`);
        report.commands.push({ ...step, logFile, logSha256: sha(logFile) });
      }
      if (folder === "dev-01") { report.dev = r.dev; report.devBefore = r.before; }
    }
    assert.equal(sha(report.dev.path), report.dev.sha256);
    assert.equal(sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), report.dev.sha256);
    assert.notEqual(report.dev.modifiedAt, report.devBefore.modifiedAt); assert(!report.dev.pending);
    return { commands: report.commands.length, dev: report.dev };
  });
  await check("Exact limited product patch, unchanged motion and bundled/compiled Runtime equality", async () => {
    const oldPanel = fs.readFileSync(path.join(checkpoint, "files", changed[0]), "utf8");
    const newPanel = fs.readFileSync(path.join(root, changed[0]), "utf8");
    const added = `? {
            border: 0, boxShadow: "none", backgroundColor: "transparent",
            // The authored option/command image owns its frame in every state.
            // Shared GUI images are inherited fallbacks, not an override.
            "--renpy-choice-authored-image": resolvedOptionStyle.backgroundImage,
          }`;
    assert.equal(oldPanel.replace('? { border: 0, boxShadow: "none", backgroundColor: "transparent" }', added), newPanel);
    const oldCss = fs.readFileSync(path.join(checkpoint, "files", changed[1]), "utf8");
    let expected = oldCss;
    for (const value of [
      "var(--renpy-button-image-normal, none)",
      "var(--renpy-button-image-hover, var(--renpy-button-image-normal, none))",
      "var(--renpy-button-image-selected, var(--renpy-button-image-hover, var(--renpy-button-image-normal, none)))",
      "var(--renpy-button-image-disabled, var(--renpy-button-image-normal, none))",
    ]) expected = expected.replace(`background-image: ${value} !important;`,
      `background-image: var(--renpy-choice-authored-image, ${value}) !important;`);
    assert.equal(expected, fs.readFileSync(path.join(root, changed[1]), "utf8"));
    const unchanged = prep.saved.filter(s => !changed.includes(s.file) && !s.file.startsWith("plans/") && !s.file.startsWith("scripts/"));
    for (const file of unchanged) assert.equal(sha(path.join(root, file.file)), file.sha256);
    report.resources = collectStageResourceEvidence(root, changed);
    report.player = describe(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(report.player.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
    report.compiledResources = [];
    for (const relative of ["GameCli_framework/dist/assets", "editor/dist/gamecli-preview/assets"]) {
      const dir = path.join(root, relative);
      const matches = fs.readdirSync(dir).filter(f => /\.(css|js)$/.test(f)
        && fs.readFileSync(path.join(dir, f), "utf8").includes("--renpy-choice-authored-image"));
      assert(matches.some(f => f.endsWith(".js")) && matches.some(f => f.endsWith(".css")));
      report.compiledResources.push(...matches.map(f => describe(path.join(dir, f))));
    }
    return { changed, unchangedProductFiles: unchanged, noMotionDeclarationsChanged: true };
  });
  await check("Frozen installation and historical failed/QA-failed evidence preserved", async () => {
    const installed = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor";
    const expected = [
      ["agentvn-editor.exe", "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c"],
      ["agentvn-player.exe", "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a"],
      ["creator-backend.exe", "db44bd510997a73aee80ba5419d0c9c55e6f73f9a01ad65003915ea089eb5155"],
    ];
    const originals = expected.map(([file, expectedHash]) => {
      const a = describe(path.join(installed, file)); assert.equal(a.sha256, expectedHash); return a;
    });
    report.failedEvidence = ["editor-smoke-01/report.json", "player-smoke-01/report.json", "related-01/report.json"]
      .map(relative => {
        const file = path.join(qa, relative); assert.equal(read(file).status, "FAILED"); return describe(file);
      });
    return { originals, failedEvidence: report.failedEvidence };
  });
  await check("Owned services and ports absent, cleanup not inferred from browser closing", async () => {
    const files = [
      "editor-smoke-01/report.json", "editor-smoke-02/report.json", "player-smoke-01/report.json",
      "player-diagnostic-01/report.json", "player-green-smoke-01/report.json", "player-full-01/report.json",
      "choice-protection-01/report.json",
    ].map(file => path.join(qa, file));
    const related = read(path.join(qa, "related-02/report.json"));
    for (const step of related.steps) for (const e of step.evidencePaths || []) files.push(path.join(e, "report.json"));
    const build = read(path.join(qa, "build-01/report.json"));
    for (const step of build.steps) for (const e of step.evidencePaths || []) files.push(path.join(e, "report.json"));
    const services = [];
    for (const file of files) {
      const r = read(file), s = r.service || r.server;
      if (r.cleanup) assert.equal(r.cleanup.status, "PASS");
      if (s?.backendPid) services.push({ pid: s.backendPid, url: s.backendUrl, source: file, role: "backend" });
      if (s) services.push({ pid: s.pid || s.frontendPid, url: s.url, source: file, role: "frontend/runtime" });
    }
    assert(services.length >= 10);
    const pids = [...new Set(services.map(s => s.pid))], ports = [...new Set(services.map(s => Number(new URL(s.url).port)))];
    const ps = `$taskPids = @(${pids.join(",")}); $taskPorts = @(${ports.join(",")}); ` +
      `$live = @(Get-Process -Id $taskPids -ErrorAction SilentlyContinue | Select-Object Id,ProcessName); ` +
      `$listening = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $taskPorts -contains $_.LocalPort } | Select-Object LocalPort,OwningProcess); ` +
      `$backends = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^python(w)?\\.exe$' -and $_.CommandLine -like '*backend_launcher.py*' } | Select-Object ProcessId,ParentProcessId,ExecutablePath); ` +
      `@{liveOwnedPids=$live;listeningOwnedPorts=$listening;currentBackendLaunchers=$backends} | ConvertTo-Json -Depth 5 -Compress`;
    const actual = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", ps],
      { windowsHide: true, encoding: "utf8" }));
    assert.equal(actual.liveOwnedPids.length, 0); assert.equal(actual.listeningOwnedPorts.length, 0);
    report.cleanup = { services, actual, backendPidBoundary: "New GUI runner records Python PID; legacy profile-preview runner does not record its separate Python PID" };
    return report.cleanup;
  });
  report.remaining = ["new Dev native UI", "new Release installation", "Windows/Android export/runtime/upgrades",
    "full official template semantic support beyond explicitly mapped/reported subset", "OPACITY-02 decision",
    "avatar position authoring", "other active ledger requirements"];
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(receiptFile, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, receiptFile, error: report.error }));
});
