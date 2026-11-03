"use strict";
// Current installed Player, complete story business flows at each requested
// viewport. Native library insertion is the only controlled preparation seam.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { observeStoryTree, validateResume } = require("./lib/runtime-story-observer.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
async function main() {
  const [attempt, exportAttempt] = process.argv.slice(2);
  const physicalRoaming = process.argv.includes("--physical-roaming");
  const resumedAttempt = process.argv.find(a => a.startsWith("--resume-cells="))?.split("=")[1];
  if (resumedAttempt) { assert.match(resumedAttempt, /^\d{2}$/); assert(physicalRoaming); }
  assert.match(attempt, /^\d{2}$/); assert.match(exportAttempt, /^\d{2}$/);
  const out = path.join(base, `installed-story-1922-${attempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), out, cells: [], commands: [],
    scope: "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_CURRENT_UI_EXPORT_COMPLETE_STORY_MATRIX",
    productChanges: 0, builds: 0, modelRequests: 0, normalCloseClaimed: false, knownProcesses: [],
    notClaimed: ["standalone/setup", "Android", "native library file picker", "physical4K", "normal native close",
      "voice replay without audio fixture", "all full-project acceptance"],
    physicalRoaming };
  const save = () => fs.writeFileSync(path.join(out, "session.json"), JSON.stringify(report, null, 2));
  let prepared = false;
  const known = new Map();
  async function command(exe, args, label, environment = process.env, childReport = undefined) {
    const c = { label, command: [exe, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
      log: path.join(out, `${label}.log`) };
    report.commands.push(c); save();
    const fd = fs.openSync(c.log, "wx");
    let timer;
    const observe = () => {
      if (!childReport || !fs.existsSync(childReport)) return;
      let raw; try { raw = read(childReport); } catch { return; }
      const processes = rows();
      for (const launch of raw.launches || []) {
        const result = observeStoryTree(processes, launch, known, report.executable.path);
        if (result.transient) (report.observerTransients ??= []).push({
          ...result, at: new Date().toISOString(), reason: "Previously verified same identity has no path during exit",
        });
      }
      report.knownProcesses = [...known.values()]; save();
    };
    try {
      const child = spawn(exe, args, { cwd: path.resolve(__dirname, ".."), env: environment,
        windowsHide: true, stdio: ["ignore", fd, fd] });
      c.pid = child.pid; save();
      if (childReport) timer = setInterval(() => {
        try { observe(); } catch (e) { report.observerError = String(e.stack || e); save(); }
      }, 3000);
      c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      c.status = c.exitCode === 0 ? "PASS" : "FAILED"; observe();
    } finally { clearInterval(timer); fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
    return c;
  }
  const profile = async action => {
    const c = await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out, "-CodexCacheView",
      ...(physicalRoaming ? ["-Storage", "NativeRoaming"] : [])],
    `profile-${action.toLowerCase()}`);
    assert.equal(c.exitCode, 0, c.log);
  };
  try {
    save();
    report.checkpoint = desc("F:/AgentVN/Checkpoints/Installed-Runtime-Story-1922-20261023-01/report.json");
    report.protectedProducts = read(report.checkpoint.path).products;
    for (const f of report.protectedProducts) assert.equal(sha(f.path), f.sha256);
    report.installation = desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json");
    const installation = read(report.installation.path);
    assert.equal(installation.version, "1.9.22"); assert.equal(installation.status, "PASS");
    for (const f of [installation.executable, ...installation.resources, installation.originalAudit, installation.originalInstallation])
      assert.equal(sha(f.path), f.sha256);
    report.executable = desc(path.join(installation.installRoot, "agentvn-player.exe"));
    assert.equal(report.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
    report.originalExport = desc(`F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${exportAttempt}/report.json`);
    const exported = read(report.originalExport.path);
    assert.equal(exported.status, "PASS"); assert.equal(exported.steps.length, 3);
    assert(exported.steps.every(c => c.status === "PASS")); assert.equal(exported.cartridges.length, 2);
    assert.equal(exported.restoration.sha256, sha(exported.restoration.path));
    assert.equal(read(exported.restoration.path).status, "PASS");
    assert.equal(exported.cleanups.length, 1); assert.equal(exported.cleanups[0].status, "PASS");
    assert.equal(exported.scope, "ACTUAL_1922_INSTALLED_EDITOR_FRESH_UI_STORY_EXPORT_FROM_CONTROLLED_HISTORICAL_FIXTURE");
    report.cartridges = exported.cartridges; report.fixture = exported.fixture;
    for (const f of report.cartridges) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(report.fixture.input), report.fixture.inputSha256);
    report.tools = [__filename, "scripts/installed-runtime-abilities-playwright.cjs",
      "scripts/lib/current-native-capture.cjs", "scripts/native-dev-preview-profile.ps1",
      "scripts/lib/runtime-story-observer.cjs"].map(f => {
      const source = desc(f), copy = path.join(out, "tools", path.basename(f));
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source.path, copy, fs.constants.COPYFILE_EXCL);
      return { ...source, copy };
    });
    report.environment = { AGENTVN_TEST_PROJECT: report.fixture.input, AGENTVN_WORKSPACE_OUTPUT: out };
    let reused;
    if (resumedAttempt) {
      const source = desc(path.join(base, `installed-story-1922-${resumedAttempt}`, "session.json"));
      const prior = read(source.path); validateResume(prior, report);
      assert.equal(sha(prior.restoration.path), prior.restoration.sha256);
      assert.equal(read(prior.restoration.path).status, "PASS");
      for (const f of prior.tools) assert.equal(sha(f.copy), f.sha256);
      for (const c of prior.cells) {
        assert.equal(sha(c.report.path), c.report.sha256);
        const raw = read(c.report.path);
        assert.equal(raw.status, "PASS"); assert(raw.finishedAt && !raw.cleanupError);
        assert.equal(raw.checks.length, 15); assert(raw.checks.every(s => s.status === "PASS"));
        assert.equal(raw.matrix.length, 2); assert(raw.matrix.every(s => s.status === "PASS"));
        assert(raw.launches.every(l => l.cleanup?.status === "PASS")); assert.deepEqual(raw.pageErrors, []);
        for (const f of [...raw.screenshots.map(s => ({ path: s.path, sha256: s.sha256 })),
          ...raw.nativeSaves.map(s => ({ path: s.retained, sha256: s.sha256 }))]) assert.equal(sha(f.path), f.sha256);
      }
      reused = prior;
      report.reusedCells = { source, count: prior.cells.length, originalStatus: prior.status,
        originalObserverError: prior.observerError, businessOnly: true, rerunCompletedCells: false };
      for (const p of prior.knownProcesses) known.set(`${p.ProcessId}:${p.Created}`, p);
      report.knownProcesses = [...known.values()]; save();
    }
    const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
    const artifacts = path.join(out, "artifacts"); fs.mkdirSync(artifacts);
    assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev|creator-backend)\.exe$/i.test(p.Name)));
    prepared = true; await profile("Prepare");
    const journal = read(path.join(out, "profile-protection.json"));
    let lastPrep;
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const name = `${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}`;
        const old = reused?.cells.find(c => c.name === name);
        if (old) {
          const expected = reused.cells[report.cells.length]; assert.equal(expected?.name, name);
          report.cells.push({ ...old, reusedFrom: report.reusedCells.source });
          const commandRow = reused.commands.find(c => c.label === name); assert(commandRow);
          report.commands.push({ ...commandRow, inheritedFrom: report.reusedCells.source });
          save(); console.log(`REUSED ${name} (original business evidence; no new execution)`); continue;
        }
        const cell = { name, width, height, dpr, reduced, status: "RUNNING",
          out: path.join(out, name), artifacts: path.join(artifacts, name) };
        report.cells.push(cell); save(); console.log(`START ${name}`);
        const prep = { status: "PASS", sessionRoot: out, executable: report.executable, current1922Library: true,
          defaultStorage: physicalRoaming ? "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION"
            : "CODEX_EXPLICIT_PROFILE_JUNCTION_LIBRARY",
          originalExport: report.originalExport, fixture: report.fixture, cartridges: report.cartridges,
          profiles: journal.records.filter(p => p.existed), installId: `qa_story_1922_${attempt}_${report.cells.length}`,
          webview: path.join(out, `webview-${name}`), temporary };
        const prepFile = path.join(out, `preparation-${name}.json`);
        fs.writeFileSync(prepFile, JSON.stringify(prep, null, 2), { flag: "wx" }); lastPrep = prepFile;
        const commandRow = await command(process.execPath, ["scripts/installed-runtime-abilities-playwright.cjs", cell.out,
          "--current-native-preparation", prepFile, "--business-viewport", String(width), String(height), String(dpr),
          String(reduced), "--artifact-root", cell.artifacts], name,
        { ...process.env, ...report.environment, TEMP: temporary, TMP: temporary }, path.join(cell.out, "report.json"));
        const rawFile = path.join(cell.out, "report.json"); assert(fs.existsSync(rawFile));
        const raw = read(rawFile); cell.report = desc(rawFile); cell.status = raw.status;
        cell.checks = raw.checks.map(c => ({ name: c.name, layout: c.layout, status: c.status, error: c.error }));
        cell.matrix = raw.matrix; save();
        assert(raw.finishedAt && !raw.cleanupError);
        assert(raw.launches.length > 0 && raw.launches.every(l => l.cleanup?.status === "PASS"));
        assert(!report.observerError, report.observerError);
        assert.equal(commandRow.exitCode, 0, JSON.stringify(cell.checks.filter(c => c.status !== "PASS")));
        assert.equal(raw.status, "PASS"); assert.equal(raw.checks.length, 15);
        assert(raw.checks.every(c => c.status === "PASS")); assert.equal(raw.matrix.length, 2);
        assert(raw.matrix.every(m => m.status === "PASS")); assert.deepEqual(raw.pageErrors, []);
        for (const f of report.tools) assert.equal(sha(f.path), f.sha256);
        console.log(`PASS ${name}`);
      }
    assert.equal(report.cells.length, 12);
    const rawCells = report.cells.map(c => read(c.report.path));
    const aggregate = { status: "PASS", scope: "DERIVED_ACTUAL_CURRENT_STORY_MATRIX_NOT_NEW_EXECUTION",
      sources: report.cells.map(c => c.report), source: rawCells[0].source, exe: rawCells[0].exe,
      matrix: rawCells.flatMap(c => c.matrix), screenshots: rawCells.flatMap(c => c.screenshots) };
    assert.equal(aggregate.matrix.length, 24);
    const matrixFile = path.join(out, "derived-matrix.json");
    fs.writeFileSync(matrixFile, JSON.stringify(aggregate, null, 2), { flag: "wx" });
    const cross = path.join(out, "cross-layout");
    const commandRow = await command(process.execPath, ["scripts/installed-runtime-abilities-playwright.cjs", cross,
      "--current-native-preparation", lastPrep, "--native-matrix-source", matrixFile, "--cross-layout-only"],
    "cross-layout", { ...process.env, ...report.environment, TEMP: temporary, TMP: temporary }, path.join(cross, "report.json"));
    report.crossLayout = desc(path.join(cross, "report.json")); const result = read(report.crossLayout.path);
    assert.equal(commandRow.exitCode, 0); assert.equal(result.status, "PASS");
    assert.equal(result.checks.length, 1); assert.equal(result.checks[0].status, "PASS");
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
      if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
        await profile("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(report.restoration.path).status, "PASS");
      }
      for (const f of [...report.protectedProducts || [], ...report.tools || [], ...report.cartridges || []])
        assert.equal(sha(f.path), f.sha256);
      const ports = report.cells.flatMap(c => fs.existsSync(path.join(c.out, "report.json"))
        ? read(path.join(c.out, "report.json")).launches.map(l => l.cdpPort) : []);
      if (report.crossLayout) ports.push(...read(report.crossLayout.path).launches.map(l => l.cdpPort));
      assert.deepEqual(listeners(ports), []); report.absentPorts = ports;
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, cells: report.cells.length,
      error: report.error, cleanupError: report.cleanupError }));
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
