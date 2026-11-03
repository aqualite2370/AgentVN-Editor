"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { execFileSync } = require("node:child_process");
const { root, qa, out, sources, sha, verifyZip } = require("./layout-resources-source-test.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const fileInfo = file => ({ path: path.resolve(file), sha256: sha(fs.readFileSync(file)), bytes: fs.statSync(file).size,
  generatedAt: fs.statSync(file).mtime.toISOString() });
const fullFile = process.env.AGENTVN_RESOURCES_GREEN, playerFile = process.env.AGENTVN_RESOURCES_PLAYER;
assert(fullFile && playerFile); assert(!fs.existsSync(path.join(out, "receipt.json")));
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [],
  scope: "LAYOUT-RES-01 source export/Runtime browser and full Dev build only; NOT native new Dev UI/Release/Windows/Android",
  installedStatus: "Original frozen 1.9.9 LAYOUT-RES-01 FAILED remains; not rerun", modelRequests: 0,
  editorSourceVersion: read(path.join(root, "editor/src-tauri/tauri.conf.json")).version };
async function check(name, body) {
  const item = { name, status: "RUNNING" }; report.checks.push(item);
  try { item.detail = await body(); item.status = "PASS"; }
  catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
  finally { console.log(`${item.status} ${name}`); }
}
function verifyShot(item) {
  const screenshot = item.screenshot, png = fs.readFileSync(screenshot.path);
  assert.equal(sha(png), screenshot.sha256); assert.deepEqual(screenshot.before, screenshot.after);
  assert.deepEqual(screenshot.before, { width: item.width, height: item.height, dpr: item.dpr, reduced: item.reduced });
  assert.equal(png.readUInt32BE(16), item.width * item.dpr);
  assert.equal(png.readUInt32BE(20), item.height * item.dpr);
}
(async () => {
  const full = read(fullFile), player = read(playerFile), prep = read(path.join(out, "preparation.json"));
  const gates = read(path.join(out, "check-02/report.json")), dev = read(path.join(out, "dev-01/report.json"));
  await check("Fixed-candidate behavior, dependency regression and sequential build gates", () => {
    for (const r of [full, player, gates, dev]) { assert.equal(r.status, "PASS"); assert.equal(r.modelRequests, 0); }
    assert.equal(full.cases.length, 12); assert.equal(new Set(full.cases.map(c => c.key)).size, 12);
    assert.equal(sha(fs.readFileSync(path.join(path.dirname(fullFile), "executed-test.cjs"))), full.testSha256);
    for (const t of full.tools) assert.equal(sha(fs.readFileSync(path.join(root, t.file))), t.sha256);
    const captureTest = read(path.join(qa, "capture-selftest-01/report.json"));
    assert.equal(captureTest.status, "PASS"); assert.equal(captureTest.cases.length, 12);
    assert(captureTest.cases.every(c => c.wrongParameterRejected));
    assert.equal(gates.commands.length, 14); assert.equal(dev.commands.length, 1);
    assert([...gates.commands, ...dev.commands].every(c => c.exitCode === 0));
    const direct = read(path.join(out, "check-02/direct-extended.json"));
    const fonts = read(path.join(out, "check-02/font-reference.json"));
    assert.equal(fonts.status, "PASS"); assert.equal(fonts.cases.length, 2);
    assert.equal(direct.cases.length, 4); assert.equal(direct.extended.length, 21);
    assert([...direct.cases, ...direct.extended].every(c => c.status === "PASS"));
    for (const s of sources) {
      const hash = sha(fs.readFileSync(path.join(root, s)));
      for (const r of [full, gates, dev, direct]) assert.equal(r.sources.find(f => f.file === s).sha256, hash);
    }
    report.commands = [...gates.commands, ...dev.commands];
    return { directCases: 27, editorCombinations: 12, editorBehaviorAssertions: 84, gates: 14, fullDev: 1 };
  });
  await check("36 actual UI cartridges have exactly five resources, original bytes and no ZIP/checksum leaks", async () => {
    const artifacts = [];
    for (const c of full.cases) {
      assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 7); assert(c.checks.every(t => t.status === "PASS"));
      assert.equal(c.cartridges.length, 3); assert.deepEqual(c.pageErrors, []);
      const types = c.geometry; assert.equal(types.length, 2);
      for (let i = 0; i < 2; i++) for (const field of ["x", "y", "width", "height"]) {
        assert(Math.abs(types[0].buttons[i].rect[field] - types[1].buttons[i].rect[field]) <= 1,
          `Type switching changed button ${i} ${field}`);
      }
      const scriptHashes = [];
      for (const a of c.cartridges) {
        const bytes = fs.readFileSync(a.path); assert.equal(sha(bytes), a.sha256);
        await verifyZip(bytes, a.type, prep.resources);
        const zip = await JSZip.loadAsync(bytes), manifest = JSON.parse(await zip.file("manifest.json").async("string"));
        const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
        const checksum = JSON.parse(await zip.file("checksum.json").async("string"));
        const paths = manifest.assets.map(a => a.path).sort();
        assert.deepEqual(Object.values(zip.files).filter(f => !f.dir && f.name.startsWith("assets/")).map(f => f.name).sort(), paths);
        assert.deepEqual(checksum.files.filter(f => f.path.startsWith("assets/")).map(f => f.path).sort(), paths);
        assert.equal(layout.layout_type || "agentvn", a.type); assert.equal(manifest.assets.length, 5);
        assert(!zip.file("project.json") && !layout.runtimeUILayoutProfiles && !layout.profiles);
        const scriptBytes = await zip.file("script.json").async("nodebuffer");
        assert.equal(sha(scriptBytes), a.scriptSha256); scriptHashes.push(a.scriptSha256);
        artifacts.push({ ...fileInfo(a.path), layout: a.type, gameVersion: manifest.version, requiredRuntime: manifest.runtime_version,
          manifestSha256: sha(await zip.file("manifest.json").async("nodebuffer")),
          layoutSha256: sha(await zip.file("ui/layout.json").async("nodebuffer")), scriptSha256: a.scriptSha256 });
      }
      assert.equal(new Set(scriptHashes).size, 1);
    }
    report.cartridges = artifacts; return { artifacts: artifacts.length, resourcesPerCartridge: 5 };
  });
  await check("12 real saved/reimported portable projects retain BOTH layouts and all seven original resources", async () => {
    report.portable = [];
    for (const c of full.cases) {
      assert(c.portable.reimported); const bytes = fs.readFileSync(c.portable.path); assert.equal(sha(bytes), c.portable.sha256);
      const zip = await JSZip.loadAsync(bytes), project = JSON.parse(await zip.file("project.json").async("string"));
      assert.equal(project.asset_manifest.length, 7); assert.equal(Object.keys(project.editor_settings.runtimeUILayoutProfiles.profiles).length, 2);
      for (const r of prep.resources) {
        const asset = project.asset_manifest.find(a => a.asset_id === r.id); assert(asset);
        assert.equal(sha(await zip.file(asset.metadata.project_path).async("nodebuffer")), r.sha256);
      }
      report.portable.push(fileInfo(c.portable.path));
    }
    return { portableProjects: 12, resourcesPerPortable: 7 };
  });
  await check("24 source Runtime file imports actually decode exported artwork and advance original story", () => {
    assert.equal(player.cases.length, 24); assert.equal(new Set(player.cases.map(c => c.key)).size, 24);
    assert.equal(player.source.sha256, sha(fs.readFileSync(fullFile)));
    for (const c of player.cases) {
      assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 3); assert(c.checks.every(t => t.status === "PASS"));
      assert.deepEqual(c.pageErrors, []);
      assert.equal(sha(fs.readFileSync(c.artifact.path)), c.artifact.sha256);
      verifyShot(c);
    }
    for (const s of player.sources) assert.equal(sha(fs.readFileSync(path.join(root, s.file))), s.sha256);
    for (const c of full.cases) verifyShot(c);
    return { runtimeCombinations: 24, runtimeAssertions: 72, originalPNGParametersAndHashes: 36,
      importBoundary: "real web file input; not native picker or installed binary" };
  });
  await check("Dev actually replaced, debug hash equal, shared bundled source equal and frozen install preserved", () => {
    report.dev = fileInfo(path.join(root, "AgentVN Dev.exe"));
    assert.equal(report.dev.sha256, fileInfo(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")).sha256);
    assert.equal(report.dev.sha256, dev.devReplacement.afterSha256);
    assert(!dev.devReplacement.observerError);
    assert(dev.devReplacement.events.some(e => Date.parse(e.at) >= Date.parse(dev.commands[0].startedAt)
      && Date.parse(e.at) <= Date.parse(dev.commands[0].finishedAt)));
    report.devReplacementEvents = dev.devReplacement.events;
    report.player = fileInfo(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(report.player.sha256,
      fileInfo(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")).sha256);
    report.bundled = fileInfo(path.join(root, "editor/src-tauri/bundle-workspace/shared/cartridge/uiLayoutProfiles.ts"));
    assert.equal(report.bundled.sha256, sha(fs.readFileSync(path.join(root, "shared/cartridge/uiLayoutProfiles.ts"))));
    report.editorDistAssets = fs.readdirSync(path.join(root, "editor/dist/assets"))
      .filter(n => /^(ExportCartridgePanel|exportCartridge|RuntimeLayoutDesigner)-.*\.js$/.test(n))
      .map(n => fileInfo(path.join(root, "editor/dist/assets", n)));
    assert(report.editorDistAssets.length > 0);
    const install = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor";
    assert.equal(fileInfo(path.join(install, "agentvn-editor.exe")).sha256,
      "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(fileInfo(path.join(install, "agentvn-player.exe")).sha256,
      "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    for (const f of prep.saved.filter(f => ![...sources, "plans/ACTIVE_TASKS.md", "scripts/runtime-layout-profiles-test.cjs", "AgentVN Dev.exe"].includes(f.file)))
      assert.equal(sha(fs.readFileSync(path.join(root, f.file))), f.sha256);
    return { newNativeDevUiTested: false, frozenInstallUntouched: true };
  });
  await check("Historical failures retained and all owned test services closed", async () => {
    report.history = [];
    const names = ["red-ui-01", "green-ui-smoke-01", "green-ui-full-01", "green-ui-full-02", "green-ui-final-smoke-01",
      "green-ui-final-01", "player-smoke-01", "player-full-01"];
    const runs = names.map(name => ({ name, r: read(path.join(qa, name, "report.json")) }));
    const ids = [...new Set(runs.flatMap(({ r }) => [r.service?.pid, r.service?.frontendPid, r.service?.backendPid])
      .filter(n => Number.isSafeInteger(n) && n > 0))];
    const filter = ids.map(id => `ProcessId = ${id}`).join(" OR ");
    const stdout = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `@(Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { [PSCustomObject]@{pid=$_.ProcessId;path=$_.ExecutablePath;created=$_.CreationDate.ToString('o')} }) | ConvertTo-Json -Compress`],
    { windowsHide: true, encoding: "utf8" }).trim();
    const live = stdout ? [].concat(JSON.parse(stdout) || []) : [];
    report.processAudit = { requestedIds: ids, live };
    for (const { name, r } of runs) {
      const file = path.join(qa, name, "report.json");
      assert.equal(r.modelRequests, 0); assert.equal(r.cleanup.status, "PASS");
      for (const pid of [r.service?.pid, r.service?.frontendPid, r.service?.backendPid].filter(Boolean)) {
        const current = live.find(p => p.pid === pid);
        if (current) assert(Date.parse(current.created) > Date.parse(r.finishedAt),
          `Owned PID remained after run: ${name}/${pid}`);
      }
      if (r.testSha256) assert.equal(sha(fs.readFileSync(path.join(path.dirname(file), "executed-test.cjs"))), r.testSha256);
      const urls = [r.service?.url, r.service?.backendUrl && `${r.service.backendUrl}/api/health`].filter(Boolean);
      for (const url of urls) {
        let responds = false; try { responds = (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
        assert(!responds, `Owned test service is still responding: ${name}`);
      }
      report.history.push({ name, ...fileInfo(file), status: r.status });
    }
    assert.equal(report.history.find(r => r.name === "red-ui-01").status, "FAILED");
    assert.equal(report.history.find(r => r.name === "green-ui-full-01").status, "FAILED");
    return { failuresNotRewritten: true, servicesClosed: true };
  });
  report.sources = sources.map(file => fileInfo(path.join(root, file)));
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  const name = report.status === "PASS" ? "receipt.json" : `closeout-failed-${Date.now()}.json`;
  fs.writeFileSync(path.join(out, name), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, file: path.join(out, name) }));
});
