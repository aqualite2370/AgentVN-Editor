"use strict";
// Serial native business matrix. No product changes, generation or rebuilds.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { observeStoryTree } = require("./lib/runtime-story-observer.cjs");
const { validateAbilitiesPreparation } = require("./lib/candidate-1924-abilities-adapter.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt || "", /^\d{2}$/);
const out = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/abilities-installed-1924-${attempt}`);
const candidate = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), out, commands: [], cells: [],
  knownProcesses: [], observerTransients: [], builds: 0, modelRequests: 0, productChanges: 0,
  scope: "INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY",
  normalCloseClaimed: false,
  limitations: ["Historical real UI-exported synthetic fixture, not fresh candidate authoring",
    "Library import via public native command, not a native picker or standalone/setup",
    "Real WebView viewport emulation, not physical 4K or Android",
    "Quick-save retention and cross-layout reads, not invalid-latest/concurrency/write-failure paths",
    "Owned termination for process changes, not normal close or audio listening acceptance"] };
const save = () => fs.writeFileSync(path.join(out, "session.json"), JSON.stringify(report, null, 2));
let protectedProfiles = false;
const known = new Map();
async function command(exe, args, label, env = process.env, rawPath) {
  const item = { command: [exe, ...args], label, status: "RUNNING",
    startedAt: new Date().toISOString(), log: path.join(out, label + ".log") };
  report.commands.push(item); save();
  const fd = fs.openSync(item.log, "wx");
  let timer;
  function sample() {
    if (!rawPath || !fs.existsSync(rawPath)) return;
    let raw; try { raw = read(rawPath); } catch { return; }
    const all = rows();
    for (const launch of raw.launches) {
      const result = observeStoryTree(all, launch, known, report.executable.path);
      if (result.transient) report.observerTransients.push({ ...result, at: new Date().toISOString() });
    }
    report.knownProcesses = [...known.values()]; save();
  }
  try {
    const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
    item.pid = child.pid; save();
    if (rawPath) timer = setInterval(() => {
      try { sample(); } catch (error) { report.observerError = String(error.stack || error); save(); }
    }, 3000);
    item.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    sample(); item.status = item.exitCode === 0 ? "PASS" : "FAILED";
    assert.equal(item.exitCode, 0, item.log);
  } finally { clearInterval(timer); fs.closeSync(fd); item.finishedAt = new Date().toISOString(); save(); }
}
const profile = action => command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out,
  "-CodexCacheView", "-Storage", "NativeRoaming"], `profile-${action.toLowerCase()}`);
async function verifyCartridges(prep) {
  const project = read(prep.fixture.input), scripts = [];
  for (const cartridge of prep.cartridges) {
    const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const script = JSON.parse(await zip.file("script.json").async("string"));
    const skin = await zip.file("ui/layout.json").async("nodebuffer");
    assert.equal(manifest.game_id, prep.fixture.projectId);
    assert.equal(JSON.parse(skin).layout_type || "agentvn", cartridge.layout);
    assert.equal(require("node:crypto").createHash("sha256").update(skin).digest("hex"), cartridge.layoutSha256);
    assert.equal(script.default_dialog_presentation, "nvl");
    assert.equal(script.characters.find(c => c.character_id === "alice").dialog_presentation, "bubble");
    assert.equal(script.characters.find(c => c.character_id === "nvl_person").dialog_presentation, "nvl");
    for (const node of project.nodes.filter(n => n.data?.scene)) {
      const actual = script.scenes.find(s => s.scene_id === node.data.scene.scene_id);
      assert(actual);
      assert.deepEqual(actual.commands, node.data.scene.commands, "Exported commands, inheritance, clear and anchors");
    }
    const sprite = manifest.assets.find(a => a.asset_id === "qa_actor"); assert(sprite && zip.file(sprite.path));
    assert.equal(require("node:crypto").createHash("sha256")
      .update(await zip.file(sprite.path).async("nodebuffer")).digest("hex"), prep.fixture.spriteSha256);
    const digest = require("node:crypto").createHash("sha256")
      .update(await zip.file("script.json").async("nodebuffer")).digest("hex");
    assert.equal(digest, cartridge.scriptSha256); scripts.push(digest);
  }
  assert.equal(scripts[0], scripts[1]); report.fixtureByteValidation = "PASS"; save();
}
(async () => {
  save();
  // Never compete with the already-running narrative/export chain.
  const predecessor = path.join(candidate, `fresh-export-audit-${attempt}/report.json`);
  const previous = read(predecessor);
  assert.equal(previous.status, "PASS"); assert(previous.finishedAt && !previous.cleanupError);
  report.predecessor = desc(predecessor);
  report.installation = desc(path.join(candidate, "installation.json"));
  const installed = read(report.installation.path);
  report.executable = installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
  report.originalExport = desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json");
  const exported = read(report.originalExport.path);
  report.fixture = exported.fixture; report.cartridges = exported.cartridges;
  report.tools = [__filename, "scripts/candidate-1924-abilities-flow.cjs",
    "scripts/candidate-1924-abilities-adapter-test.cjs", "scripts/lib/candidate-1924-abilities-adapter.cjs",
    "scripts/installed-runtime-abilities-playwright.cjs", "scripts/lib/runtime-story-observer.cjs",
    "scripts/lib/current-native-editor-session.cjs", "scripts/lib/current-native-capture.cjs",
    "scripts/lib/installed-acceptance.cjs", "scripts/lib/installed-runtime-session.cjs",
    "scripts/native-dev-preview-profile.ps1"].map(desc);
  for (const item of report.tools) {
    const copy = path.join(out, "tools", path.relative(root, item.path));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(item.path, copy, fs.constants.COPYFILE_EXCL); item.copy = copy;
  }
  const prep = { status: "PASS", scope: report.scope, sessionRoot: out,
    installation: report.installation, executable: report.executable, originalExport: report.originalExport,
    fixture: exported.fixture, cartridges: exported.cartridges, tools: report.tools,
    defaultStorage: "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION",
    webview: path.join(out, "webview"), temporary: path.join(out, "temporary"),
    installId: `qa_abilities_1924_${attempt}_01` };
  validateAbilitiesPreparation(prep);
  await verifyCartridges(prep);
  await command(process.execPath, ["scripts/candidate-1924-abilities-adapter-test.cjs"], "adapter-guard");
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  report.environment = { AGENTVN_TEST_PROJECT: prep.fixture.input, AGENTVN_WORKSPACE_OUTPUT: out };
  fs.mkdirSync(prep.temporary); protectedProfiles = true; await profile("Prepare");
  const journal = read(path.join(out, "profile-protection.json"));
  prep.profiles = journal.records.filter(p => p.existed); prep.allProfiles = journal.records;
  const matrix = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
  for (const [index, viewport] of matrix.entries()) {
    const number = String(index + 1).padStart(2, "0"), cellOut = path.join(out, `cell-${number}`);
    prep.installId = `qa_abilities_1924_${attempt}_${number}`;
    const prepFile = path.join(out, `preparation-${number}.json`);
    fs.writeFileSync(prepFile, JSON.stringify(prep, null, 2), { flag: "wx" });
    const cell = { viewport, status: "RUNNING", preparation: desc(prepFile), out: cellOut };
    report.cells.push(cell); save();
    await command(process.execPath, ["scripts/candidate-1924-abilities-flow.cjs", cellOut,
      "--current-native-preparation", prepFile, "--business-viewport", String(viewport.width),
      String(viewport.height), String(viewport.dpr), String(viewport.reduced),
      "--artifact-root", path.join(out, `artifacts-${number}`)], `business-${number}`,
    { ...process.env, ...report.environment, TEMP: prep.temporary, TMP: prep.temporary },
    path.join(cellOut, "report.json"));
    cell.raw = desc(path.join(cellOut, "report.json")); const raw = read(cell.raw.path);
    assert.equal(raw.status, "PASS"); assert(raw.finishedAt && !raw.cleanupError);
    assert.equal(raw.checks.length, 16); assert(raw.checks.every(c => c.status === "PASS"));
    assert.equal(raw.matrix.length, 2); assert(raw.matrix.every(c => c.status === "PASS"));
    assert.equal(raw.launches.length, 3); assert(raw.launches.every(l => l.cleanup?.status === "PASS"));
    assert(!report.observerError, report.observerError);
    assert.deepEqual(listeners(raw.launches.map(l => l.cdpPort)), []);
    cell.status = "PASS"; save();
    console.log(`PASS installed abilities ${number}/12 ${viewport.width} DPR${viewport.dpr} reduced=${viewport.reduced}`);
  }
  assert.equal(report.cells.length, 12); report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  const cell = report.cells.at(-1); if (cell?.status === "RUNNING") cell.status = "FAILED";
}).finally(async () => {
  try {
    assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
      p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
    if (protectedProfiles && fs.existsSync(path.join(out, "profile-protection.json"))) {
      await profile("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
      assert.equal(read(report.restoration.path).status, "PASS");
    }
    for (const item of report.tools || []) assert.equal(sha(item.path), item.sha256);
    const all = rows();
    for (const item of known.values()) assert(!all.some(p => p.ProcessId === item.ProcessId && p.Created === item.Created));
  } catch (error) {
    report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cells: report.cells.length,
    error: report.error, cleanupError: report.cleanupError }));
});
