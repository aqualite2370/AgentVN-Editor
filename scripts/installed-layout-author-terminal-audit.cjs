"use strict";
// Independent review of the actual installed authoring evidence; never a new
// product execution or a substitute for missing authoring/runtime workflows.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = `${root}/output/installed-layout-author-review-20261019-01`;
const attempt = process.argv[2] || "01";
const includeOrdinary = process.argv.includes("--with-ordinary");
const includePlayer = process.argv.includes("--with-player") || includeOrdinary;
assert(/^\d{2}$/.test(attempt));
const out = path.join(run, `terminal-audit-${attempt}.json`);
assert(!fs.existsSync(out), "Never replace prior audit evidence");
const report = { status: "RUNNING", productConclusion: "FAILED", at: new Date().toISOString(),
  scope: "EVIDENCE_REVIEW_AND_LIVE_RESTORATION_CHECK_NOT_NEW_PRODUCT_TESTS",
  checks: [], sources: [], screenshots: 0, newProductTests: 0, newBuilds: 0, modelRequests: 0,
  incomplete: ["ordinary-dialogue/full-choice/quick-bar authoring workflow",
    "all six roles and four states actually consumed by Runtime",
    "native project-file pickers", "independent Windows setup and Android"],
  error: null };
const sha = p => sha256(fs.readFileSync(p));
function read(p) {
  report.sources.push({ path: p, sha256: sha(p) });
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}
const source = p => read(path.join(run, p));
async function check(name, operation) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await operation(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
const profiles = p => p.settings.runtimeUILayoutProfiles;
async function main() {
  const phases = ["fixture-01", "edit-01", "inherited-opacity-01", "explicit-opacity-01",
    "roles-01", "matrix-01", "matrix-02", "role-consumption-01", "dialogue-confirmation-01",
    "save-01", "reopen-01", "export-01", "portable-reimport-01"];
  const raw = Object.fromEntries(phases.map(p => [p, source(`${p}/report.json`)]));
  const prep = source("preparation.json"), first = source("launch.json"), second = source("launch-02.json");
  const authored = raw["save-01"].authored;
  await check("Original inherited-opacity failure remains FAILED; explicit setting is not a repair", () => {
    const failure = raw["inherited-opacity-01"], oldMatrix = raw["matrix-01"];
    assert.equal(failure.status, "FAILED"); assert.equal(oldMatrix.status, "FAILED");
    assert.equal(failure.opacityEvidence.displayed, "1");
    assert.equal(failure.opacityEvidence.source, "主题继承");
    assert.equal(failure.opacityEvidence.background, "rgba(36, 56, 76, 0.78)");
    assert.equal(failure.opacityEvidence.savedStyle.opacity, undefined);
    assert.equal(raw["explicit-opacity-01"].status, "PASS");
    return { productFailure: "Editor inherited opacity=1, actual Runtime alpha=0.78",
      productFixApplied: false, explicitOverrideContinuationOnly: true };
  });
  await check("Actual editing and limited Runtime consumption have nonempty evidence and honest boundaries", () => {
    for (const [phase, r] of Object.entries(raw)) {
      if (["inherited-opacity-01", "matrix-01"].includes(phase)) continue;
      assert.equal(r.status, "PASS", phase); assert(r.checks.length > 0, phase);
      assert(r.checks.every(c => c.status === "PASS"), phase);
      assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0);
      assert.deepEqual(r.pageErrors, []); assert.equal(r.nativePickerClaim, false);
    }
    const roles = raw["roles-01"].checks[0].detail;
    assert.equal(roles.length, 24);
    assert.equal(new Set(roles.map(c => `${c.role}/${c.state}`)).size, 24);
    for (const role of roles) assert.equal(profiles(authored).profiles.renpy.renpy.shared
      .buttonRoles[role.role].states[role.state].textColor, role.textColor);
    assert.deepEqual(profiles(authored).profiles.agentvn, raw["edit-01"].agentBaseline);
    const consumed = raw["role-consumption-01"].checks[0].detail;
    assert.equal(consumed.disabledStateRuntimeTest, "NOT_RUN");
    assert.equal(consumed.otherRoleRuntimeStates, "NOT_RUN");
    assert.equal(raw["dialogue-confirmation-01"].checks[0].detail.length, 2);
    return { authoredRoleStates: 24, actualRoleStateSamples: ["title normal", "title hover", "navigation selected"],
      ordinaryDialogueChoiceQuickBarAuthoring: "NOT_RUN", comprehensiveRuntimeRoleStates: "NOT_RUN" };
  });
  await check("Twelve distinct actual WebView combinations contain seven reachable authored-page previews each", () => {
    const matrix = raw["matrix-02"].matrix;
    assert.equal(matrix.length, 12);
    const keys = new Set();
    for (const row of matrix) {
      assert.equal(row.status, "PASS"); assert.equal(row.pages.length, 7);
      const v = row.viewport; keys.add([v.width, v.height, v.dpr, v.reduced].join("/"));
      assert.equal(new Set(row.pages.map(p => p.id)).size, 7);
      for (const p of row.pages) {
        const a = p.author, r = p.runtime;
        assert(a.hit && !a.clipped && a.overflow <= 1 && a.opacity > 0);
        assert(a.rect.left >= -1 && a.rect.top >= -1 && a.rect.right <= v.width + 1 && a.rect.bottom <= v.height + 1);
        assert(r.horizontalOverflow <= 1 && r.contentOverflow <= 1);
        assert(r.buttons.length > 0 && r.buttons.every(b => b.hit && !b.clipped));
      }
    }
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const d of [1, 2]) for (const r of [false, true]) assert(keys.has([w, h, d, r].join("/")));
    return { actualWebviewEmulationNotPhysicalDisplay: true, combinations: keys.size, pagePreviews: 84,
      inheritanceDefectStillPresent: true };
  });
  await check("Saved portable bytes, new native process and public-backend reimport preserve both layouts", async () => {
    const saved = raw["save-01"].savedPackage;
    assert.equal(sha(saved.retained), saved.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(saved.retained), { checkCRC32: true });
    const p = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles, profiles(authored));
    assert(!JSON.stringify(p).includes(prep.workRoot));
    assert.notEqual(first.editorPid, second.editorPid);
    assert.deepEqual(profiles(raw["reopen-01"].authored), profiles(authored));
    assert.equal(raw["portable-reimport-01"].checks[0].detail.bothLayoutsMatch, true);
    return { portable: saved, editorPids: [first.editorPid, second.editorPid],
      reimportMethod: "public packaged backend, not native file picker" };
  });
  await check("Actual exported cartridge CRC/bytes independently match active authored values", async () => {
    const c = raw["export-01"].cartridge, fixture = source("fixtures.json");
    assert.equal(sha(c.path), c.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(c.path), { checkCRC32: true });
    const bytes = await zip.file("ui/layout.json").async("nodebuffer");
    assert.equal(sha256(bytes), c.layoutSha256);
    const layout = JSON.parse(bytes), manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    assert.equal(manifest.game_id, fixture.projectId); assert.equal(layout.layout_type, "renpy");
    const active = profiles(authored).profiles.renpy;
    for (const key of ["renpy", "dialogueLayouts", "confirmationLayout"]) assert.deepEqual(layout[key], active[key]);
    for (const id of ["title", "preferences", "save_load", "history", "about", "help", "gallery"]) {
      const actual = layout.screens.find(s => s.screen_id === id), expected = active.screens.find(s => s.screen_id === id);
      assert(actual && expected);
      assert.deepEqual(actual.components.map(c => c.style), expected.components.map(c => c.style));
    }
    return { ...c, independentPlayerRunOfThisCartridge: "NOT_RUN", windowsAndroidBuildClaim: false };
  });
  await check("Raw screenshot bytes match actual pre/post viewport, DPR and PNG dimensions", () => {
    for (const r of Object.values(raw)) for (const s of r.screenshots) {
      const b = fs.readFileSync(s.path); assert.equal(sha256(b), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr); report.screenshots++;
    }
    assert.equal(report.screenshots, 25);
    return { screenshots: report.screenshots, OSFilePickerEvidenceClaim: false };
  });
  await check("Four original profiles and55 original/independent backup hashes restored", () => {
    const restored = source(includeOrdinary ? "profile-restoration-04.json"
      : includePlayer ? "profile-restoration-03.json" : "profile-restoration.json");
    assert.equal(restored.status, "PASS");
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) {
        assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++;
      }
    }
    assert.equal(count, 55); return { originalProfiles: 4, files: count };
  });
  await check("Frozen installation and560 product source identities match, except seven prior authorized Editor changes", () => {
    assert.equal(sha(path.join(first.installRoot, "agentvn-editor.exe")), first.executableSha256);
    assert.equal(first.executableSha256, second.executableSha256);
    assert.equal(sha(`${root}/AgentVN Dev.exe`), prep.originalDevSha256);
    const candidate = read(`${root}/output/full-regression-20261017-01/candidate-02/manifest.json`);
    const allowed = read(`${root}/output/editor-selection-mask-20261019-01/terminal-audit-02.json`);
    const changes = new Map(allowed.sources.map(f => [path.resolve(root, f.file), f.sha256]));
    assert.equal(changes.size, 7); assert.equal(candidate.source.length, 560);
    for (const file of candidate.source) assert.equal(sha(file.path), changes.get(path.resolve(file.path)) || file.sha256, file.path);
    return { frozenInstalledSha256: first.executableSha256, currentDevSha256: prep.originalDevSha256,
      sourceFiles: 560, priorAuthorizedChanges: 7, newChanges: 0 };
  });
  let player;
  if (includePlayer) {
    player = source("authored-player-01/report.json");
    await check("Actual installed Player consumes untouched UI export at12 parameter combinations,72 page states", () => {
      assert.equal(player.status, "PASS"); assert.equal(player.checks.length, 2);
      assert(player.checks.every(c => c.status === "PASS")); assert.deepEqual(player.pageErrors, []);
      assert.equal(player.source.sha256, raw["export-01"].cartridge.sha256);
      assert.equal(sha(player.source.path), player.source.sha256);
      assert.equal(player.launches.length, 1); assert.equal(player.launches[0].cleanup.status, "PASS");
      assert.equal(player.matrix.length, 12);
      const keys = new Set();
      for (const r of player.matrix) {
        const v = r.viewport; keys.add([v.width, v.height, v.dpr, v.reduced].join("/"));
        assert.equal(r.status, "PASS"); assert.equal(r.pages.length, 6);
        assert.equal(new Set(r.pages.map(p => p.id)).size, 6);
        for (const p of r.pages) assert(p.actual.buttons.length > 0 && p.actual.buttons.every(b => b.hit && !b.clipped));
      }
      assert.equal(keys.size, 12); assert.equal(player.screenshots.length, 12);
      for (const s of player.screenshots) {
        const b = fs.readFileSync(s.path); assert.equal(sha256(b), s.sha256); assert.deepEqual(s.before, s.after);
        assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
        assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
      }
      return { actualPlayerCombinations: 12, pageStates: 72, screenshots: 12,
        gallery: "NOT_AVAILABLE_IN_FIXTURE", independentWindowsSetupOrAndroid: false,
        comprehensiveRoleStates: "NOT_RUN", nativePickerClaim: false };
    });
    await check("Only this session's owned Downloads package removed; SHA-verified retained bytes remain recoverable", () => {
      const receipt = source("download-retention.json"), saved = raw["save-01"].savedPackage;
      assert.equal(receipt.status, "PASS"); assert(receipt.sourceRemoved && receipt.copyVerified);
      assert.equal(receipt.source, saved.original); assert.equal(receipt.retained, saved.retained);
      assert.equal(receipt.sha256, saved.sha256); assert(!fs.existsSync(receipt.source));
      assert.equal(sha(receipt.retained), receipt.sha256);
      return receipt;
    });
  }
  let ordinary;
  if (includeOrdinary) {
    const phases = ["fixture-01","author-01","save-01","reopen-01","reimport-01","export-01","consume-03"];
    ordinary = Object.fromEntries(phases.map(p => [p, source(`ordinary-${p}/report.json`)]));
    await check("Ordinary authoring has nonempty actual controls,12 previews, native save and distinct-process recovery", async () => {
      for (const r of Object.values(ordinary)) {
        assert.equal(r.status, "PASS"); assert(r.checks.length > 0 && r.checks.every(c => c.status === "PASS"));
        assert.deepEqual(r.pageErrors, []); assert.equal(r.productChanges, 0); assert.equal(r.modelRequests, 0);
        assert.equal(r.nativePickerClaim, false);
      }
      const edit = ordinary["author-01"], saved = ordinary["save-01"], reopened = ordinary["reopen-01"];
      assert.equal(edit.checks.length, 4); assert.equal(edit.matrix.length, 12);
      assert.equal(new Set(edit.matrix.map(r => [r.width,r.height,r.dpr,r.reduced].join("/"))).size, 12);
      for (const r of edit.matrix) {
        assert.equal(r.actual.left, "12%"); assert.equal(r.actual.width, "76%");
        assert.equal(r.actual.color, "rgb(240, 208, 128)"); assert.equal(r.actual.radius, "17px");
        assert(r.controls.length === 2 && r.controls.every(c => c.hit && !c.clipped));
      }
      assert.deepEqual(profiles(saved.authored), profiles(edit.authored));
      assert.deepEqual(profiles(reopened.authored), profiles(saved.authored));
      assert.deepEqual(profiles(ordinary["reimport-01"].authored), profiles(saved.authored));
      assert.notEqual(saved.launch.editorPid, reopened.launch.editorPid);
      const zip = await JSZip.loadAsync(fs.readFileSync(saved.savedPackage.retained), { checkCRC32: true });
      assert.equal(sha(saved.savedPackage.retained), saved.savedPackage.sha256);
      const portable = JSON.parse(await zip.file("project.json").async("string"));
      assert.deepEqual(portable.editor_settings.runtimeUILayoutProfiles, profiles(saved.authored));
      return { actualAuthorCombinations:12, actualNativeDefaultDirectorySave:true, newEditorProcess:true,
        customDirectoryOrNativeImportPickerClaim:false };
    });
    await check("New ordinary exported cartridge and12 actual-player state/branch combinations match authored data", async () => {
      const exported = ordinary["export-01"], consumed = ordinary["consume-03"];
      const c = exported.cartridge; assert.equal(sha(c.path), c.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(c.path), { checkCRC32:true });
      const bytes = await zip.file("ui/layout.json").async("nodebuffer");
      assert.equal(sha256(bytes), c.layoutSha256);
      const active = profiles(exported.authored).profiles.renpy, skin = JSON.parse(bytes);
      assert.deepEqual(skin.screens, active.screens); assert.deepEqual(skin.renpy, active.renpy);
      assert.equal(consumed.playerMatrix.length,12);
      assert.equal(new Set(consumed.playerMatrix.map(r => Object.values(r.viewport).join("/"))).size,12);
      for (const r of consumed.playerMatrix) {
        assert.equal(r.status,"PASS");
        assert.deepEqual(r.states,{disabled:"rgb(129, 144, 156)",normal:"rgb(104, 196, 183)",
          hover:"rgb(247, 214, 140)",selected:"rgb(255, 173, 204)"});
        assert.equal(r.choice.left,"42%"); assert.deepEqual(r.choice.labels,["继续","重看"]);
        assert.equal(r.choice.color,"rgb(223, 201, 91)"); assert.equal(r.choice.hover,"rgb(230, 246, 255)");
      }
      assert.equal(consumed.launches.length,1); assert.equal(consumed.launches[0].cleanup.status,"PASS");
      return {cartridge:c,actualPlayerCombinations:12,quickStates:4,choiceStates:2,
        sixRoleFullStateClaim:false,independentWindowsSetupAndroid:false};
    });
    await check("Two original tooling failures retained; ordinary PNG bytes/parameters and exact Downloads cleanup verified", () => {
      const failures = ["01","02"].map(a => source(`ordinary-consume-${a}/report.json`));
      assert(failures.every(r=>r.status==="FAILED" && r.playerMatrix.length===1 && r.playerMatrix[0].status==="PASS"));
      let count=0;
      for(const r of [...Object.values(ordinary),...failures]) for(const s of r.screenshots){
        const b=fs.readFileSync(s.path);assert.equal(sha256(b),s.sha256);assert.deepEqual(s.before,s.after);
        assert.equal(b.readUInt32BE(16),s.before.width*s.before.dpr);assert.equal(b.readUInt32BE(20),s.before.height*s.before.dpr);count++;
      }
      assert.equal(count,30);
      const receipt=source("ordinary-download-retention.json"),saved=ordinary["save-01"].savedPackage;
      assert.equal(receipt.status,"PASS");assert(receipt.sourceRemoved&&receipt.copyVerified);
      assert.equal(receipt.source,saved.original);assert.equal(receipt.retained,saved.retained);
      assert(!fs.existsSync(receipt.source));assert.equal(sha(receipt.retained),saved.sha256);
      report.incomplete=report.incomplete.filter(s=>!s.startsWith("ordinary-dialogue/"));
      return {ordinaryScreenshots:count,toolFailuresPreserved:2,
        naturalFirstMatrixProductChecksPassed:true,downloads:receipt};
    });
  }
  await check("Owned stops are attributable; no current AgentVN processes or any of five session ports", () => {
    for (const name of ["restart-stop.json", "final-stop.json"]) {
      const s = source(name); assert.equal(s.status, "PASS"); assert.equal(s.after.length, 0);
      assert.equal(s.normalWindowClose, "NOT_RUN");
    }
    const morePorts=[];
    if(includeOrdinary){
      for(const name of ["launch-03.json","launch-04.json"]){const l=source(name);morePorts.push(l.cdpPort,l.playerCdpPort)}
      for(const name of ["ordinary-restart-stop.json","ordinary-final-stop.json"]){
        const s=source(name);assert.equal(s.status,"PASS");assert.equal(s.after.length,0);assert.equal(s.normalWindowClose,"NOT_RUN");
      }
      for(const name of ["ordinary-consume-01/report.json","ordinary-consume-02/report.json","ordinary-consume-03/report.json"])
        morePorts.push(...source(name).launches.map(l=>l.port));
    }
    const ports = [...new Set([8278, first.cdpPort, first.playerCdpPort, second.cdpPort, second.playerCdpPort,
      ...(player?.launches.map(p => p.port) || []),...morePorts])];
    const text = execFileSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 4
    `], { windowsHide: true, encoding: "utf8", timeout: 20000 });
    const state = JSON.parse(text.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { portsChecked: ports, ...state, normalCloseClaim: false };
  });
  report.status = "PASS";
}
main().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, productConclusion: report.productConclusion,
    checks: report.checks.length, screenshots: report.screenshots, error: report.error, out }));
});
