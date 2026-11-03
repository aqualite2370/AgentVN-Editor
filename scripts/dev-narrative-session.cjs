"use strict";
// Current built Player, explicitly distinct from frozen installed acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateDevNarrativePreparation } = require("./lib/dev-narrative-preparation.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
async function main() {
  const [attempt, exportAttempt] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(exportAttempt, /^\d{2}$/);
  const smoke = process.argv.includes("--smoke");
  const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/dev-narrative-20261024-${attempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), out, smoke, commands: [],
    scope: "CURRENT_DEV_NATIVE_NARRATIVE_NOT_INSTALLED_ACCEPTANCE", productChanges: 0, builds: 0, modelRequests: 0,
    normalCloseClaimed: false, limitations: ["Public import, not native picker", "Explicit Codex temporary physical Roaming",
      "Library, not standalone/setup/Android", "Viewport emulation, not physical4K",
      "Synthetic voice trigger evidence, not a new listening test", "Owned termination, not normal native close"] };
  const save = () => fs.writeFileSync(path.join(out, "session.json"), JSON.stringify(r, null, 2));
  let prepared = false;
  async function command(exe, args, label, env = process.env) {
    const c = { label, command: [exe, ...args], status: "RUNNING", startedAt: new Date().toISOString(),
      log: path.join(out, `${label}.log`) }; r.commands.push(c); save();
    const fd = fs.openSync(c.log, "wx");
    try {
      const child = spawn(exe, args, { cwd: path.resolve(__dirname, ".."), env, windowsHide: true, stdio: ["ignore", fd, fd] });
      c.pid = child.pid; save();
      c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      c.status = c.exitCode === 0 ? "PASS" : "FAILED"; return c;
    } finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
  }
  async function profile(action) {
    const c = await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"],
    `profile-${action.toLowerCase()}`); assert.equal(c.exitCode, 0, c.log);
  }
  try {
    save(); r.checkpoint = desc("F:/AgentVN/Checkpoints/Narrative-Geometry-20261024-01/manifest.json");
    r.build = desc("F:/AgentVN/QA/Narrative-Geometry-Source-20261024-01/build-01/report.json");
    const build = read(r.build.path);
    r.protectedProducts = [desc(build.dev.path), desc(build.preview.path),
      ...build.frozenInstallation.map(f => ({ path: path.resolve(f.file), sha256: f.sha256 }))];
    for (const f of r.protectedProducts) assert.equal(sha(f.path), f.sha256);
    r.exported = desc(`F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${exportAttempt}/report.json`);
    const exported = read(r.exported.path);
    r.fixtureInstallationSource = exported.installation; r.fixture = exported.fixture; r.cartridges = exported.cartridges;
    r.executable = desc(build.preview.path);
    assert.equal(r.fixture.capacityVariant, "mixed-history-v2", "Require positive history-font coverage before any profile change");
    const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
    const prep = { status: "PASS", sessionRoot: out, scope: r.scope,
      defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
      exported: r.exported, build: r.build, fixture: r.fixture, cartridges: r.cartridges,
      executable: r.executable, temporary, webview: path.join(out, "webview") };
    validateDevNarrativePreparation(prep);
    r.tools = [__filename, "scripts/dev-narrative-playwright.cjs", "scripts/dev-narrative-preparation-test.cjs",
      "scripts/lib/dev-narrative-player.cjs", "scripts/lib/dev-narrative-preparation.cjs",
      "scripts/lib/installed-narrative-1922-fixture.cjs", "scripts/lib/voice-runtime-observer.cjs",
      "scripts/lib/current-native-capture.cjs", "scripts/native-dev-preview-profile.ps1",
      "scripts/lib/current-native-editor-session.cjs", "scripts/lib/owned-process-tree.cjs",
      "scripts/lib/owned-process-stop.cjs", "scripts/lib/installed-runtime-session.cjs",
      "scripts/lib/installed-acceptance.cjs"].map(file => {
      const f = desc(file), copy = path.join(out, "tools", path.basename(file));
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(f.path, copy, fs.constants.COPYFILE_EXCL);
      return { ...f, copy };
    });
    const guard = await command(process.execPath, ["scripts/dev-narrative-preparation-test.cjs"], "preparation-guard");
    assert.equal(guard.exitCode, 0, guard.log);
    assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
    if (process.argv.includes("--validate-only")) {
      await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        "scripts/native-dev-preview-profile.ps1", "-Action", "Prepare", "-RunDirectory", out,
        "-CodexCacheView", "-Storage", "NativeRoaming", "-ValidateOnly"], "profile-validation");
      assert.equal(r.commands.at(-1).exitCode, 0);
      r.status = "VALIDATION_ONLY_NO_PRODUCT_START"; return;
    }
    prepared = true; await profile("Prepare");
    const preparationFile = path.join(out, "preparation.json");
    fs.writeFileSync(preparationFile, JSON.stringify(prep, null, 2), { flag: "wx" }); r.preparation = desc(preparationFile);
    r.environment = { AGENTVN_TEST_PROJECT: r.fixture.input, AGENTVN_WORKSPACE_OUTPUT: out }; save();
    const c = await command(process.execPath, ["scripts/dev-narrative-playwright.cjs", preparationFile,
      ...(smoke ? ["--smoke"] : [])], "narrative", { ...process.env, ...r.environment, TEMP: temporary, TMP: temporary });
    r.raw = desc(path.join(out, "player.json")); const raw = read(r.raw.path);
    assert(raw.finishedAt && !raw.cleanupError && !raw.observerError);
    assert(raw.launches.every(l => l.cleanup?.status === "PASS"));
    assert.equal(c.exitCode, 0, JSON.stringify(raw.cells.map(c => ({ name: c.name, error: c.error }))));
    assert.equal(raw.cells.length, smoke ? 2 : 24);
    assert(raw.cells.every(c => c.status === "PASS" && c.checks.length === 5 && c.checks.every(k => k.status === "PASS")));
    r.status = "PASS";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      const rawFile = path.join(out, "player.json");
      if (fs.existsSync(rawFile)) {
        r.raw = desc(rawFile); const raw = read(rawFile);
        assert(raw.finishedAt && !raw.cleanupError); assert(raw.launches.every(l => l.cleanup?.status === "PASS"));
        const all = rows(); r.knownProcesses = raw.knownProcesses;
        assert(!all.some(p => raw.knownProcesses.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
        r.absentPorts = raw.launches.map(l => l.port); assert.deepEqual(listeners(r.absentPorts), []);
      }
      assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
      if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
        await profile("Restore"); r.restoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(r.restoration.path).status, "PASS");
      }
      for (const f of [...r.protectedProducts || [], ...r.tools || []]) assert.equal(sha(f.path), f.sha256);
    } catch (e) { r.status = "FAILED"; r.cleanupError = String(e.stack || e); process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, error: r.error, cleanupError: r.cleanupError }));
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
