"use strict";
// Read-only audit of actual current candidate evidence, not a test replay.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2] || "01";
assert.match(attempt, /^\d{2}$/);
const qa = "F:/AgentVN/QA/Knowledge-Draft-Candidate-1937-20261102-01";
const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/knowledge-draft-1937-20261102-01";
const file = path.join(qa, "audit-" + attempt + ".json"); assert(!fs.existsSync(file));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: hash(f), bytes: fs.statSync(f).size });
const verify = d => { assert.equal(hash(d.path), d.sha256, d.path); if (d.bytes !== undefined) assert.equal(fs.statSync(d.path).size, d.bytes); };
const report = { status: "RUNNING", at: new Date().toISOString(), scope: "READ_ONLY_CANDIDATE_EVIDENCE_AUDIT_NOT_FULL_GOAL",
  checks: [], reports: [], modelRequests: 0, productStarts: 0 };
function load(name) {
  const f = path.join(qa, name); report.reports.push(desc(f)); const value = read(f); assert.equal(value.status, "PASS", f); return value;
}
async function check(name, run) {
  const item = { name, status: "RUNNING" }; report.checks.push(item);
  try { item.detail = await run(); item.status = "PASS"; } catch (error) { item.status = "FAILED"; throw error; }
}
const keys = [1920, 2560, 3840].flatMap(w => [1, 2].flatMap(d => [false, true].map(r => `${w}/${d}/${r}`))).sort();
const key = m => `${m.width}/${m.dpr}/${m.reduced}`;
(async () => {
  const gates = load("gates-01/report.json"), dev = load("dev-01/report.json"), release = load("release-01/report.json");
  const installation = load("installation-01/installation.json"), editor = load("session-01/report.json");
  const playerFile = path.join(playerRoot, "report.json"), player = read(playerFile);
  report.reports.push(desc(playerFile)); assert.equal(player.status, "PASS");
  await check("nonempty-functional-matrix-and-exact-source-boundaries", () => {
    assert.equal(editor.cleanup, "PASS"); assert.equal(editor.cases.length, 26);
    assert(editor.cases.every(c => c.status === "PASS")); assert.deepEqual(editor.errors, []);
    const draft = editor.cases.filter(c => c.name.startsWith("installed-draft-"));
    const knowledge = editor.cases.filter(c => c.name.startsWith("installed-knowledge-"));
    assert.deepEqual(draft.map(c => key(c.detail.display)).sort(), keys);
    assert.deepEqual(knowledge.map(c => key(c.detail.display)).sort(), keys);
    assert.equal(knowledge.flatMap(c => c.detail.topics).length, 48);
    assert.equal(editor.requests.length, 48); assert.equal(editor.blockedModelRequests, 0); assert.equal(editor.modelRequests, 0);
    assert.equal(player.cleanup, "PASS"); assert.equal(player.cases.length, 12); assert.deepEqual(player.errors, []);
    assert.deepEqual(player.cases.map(c => key(c.display)).sort(), keys); assert.equal(player.nativeContentAction.status, "PASS");
    assert.equal(editor.installation.sha256, hash(path.join(qa, "installation-01/installation.json")));
    assert.equal(player.source.sha256, hash(path.join(qa, "session-01/report.json")));
    return { editorDisplays: 12, knowledgeQuestions: 48, nativePlayerDisplays: 12 };
  });
  await check("all-build-commands-and-actual-overwritten-dev-installer-resources", () => {
    for (const stage of [gates, dev, release]) {
      assert(stage.commands.length); assert(stage.commands.every(c => c.status === "PASS" && c.exitCode === 0));
      for (const command of stage.commands) verify(command.logIdentity);
    }
    assert.equal(gates.commands.length, 8); verify(dev.dev);
    assert.equal(hash(path.join(root, "AgentVN Dev.exe")), dev.dev.sha256);
    assert.equal(hash(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), dev.dev.sha256);
    verify(release.installer); verify(release.retainedInstaller); verify(release.releaseExe);
    verify(installation.executable); for (const resource of installation.resources) verify(resource);
    assert.equal(installation.metadataRestoration, "PASS"); assert.equal(installation.version, "1.9.37");
    assert.equal(installation.executable.version, "1.9.37");
    assert.equal(installation.installer.sha256, release.installer.sha256);
    const local = read(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json"));
    assert.equal(local.editorVersion, "1.9.37");
    verify(player.executable); assert.equal(player.executable.sha256,
      installation.resources.find(r => path.basename(r.path) === "agentvn-player.exe").sha256);
    return { commands: gates.commands.length + dev.commands.length + release.commands.length,
      devSHA256: dev.dev.sha256, installerSHA256: release.installer.sha256 };
  });
  await check("all-png-bytes-agree-with-actual-webview-metrics-and-dpr", () => {
    assert.equal(editor.screenshots.length, 12); assert.equal(player.screenshots.length, 3);
    for (const shot of [...editor.screenshots, ...player.screenshots]) {
      verify(shot); assert.deepEqual(shot.before, shot.after);
      const png = fs.readFileSync(shot.path), m = shot.before;
      assert(Math.abs(png.readUInt32BE(16) - m.width * m.dpr) < .01);
      assert(Math.abs(png.readUInt32BE(20) - m.height * m.dpr) < .01);
    }
    return { screenshots: 15 };
  });
  await check("actual-exported-zip-bytes-contain-last-valid-code-and-native-player-uses-the-same-file", async () => {
    assert.equal(editor.cartridges.length, 12);
    for (const cartridge of editor.cartridges) {
      verify(cartridge);
      const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path), { checkCRC32: true });
      const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
      const code = layout.screens.find(s => s.screen_id === "title").components
        .find(c => c.component_id === "title_start_button").presentation;
      assert(code.html.includes('<slot name="content">')); assert(code.css.includes("#315b72"));
      assert(!JSON.stringify(layout).includes("__qaDraftExecuted") && !JSON.stringify(layout).includes("--qa-invalid-draft"));
    }
    assert.equal(player.input.sha256, editor.cartridges.at(-1).sha256); verify(player.input);
    return { cartridges: 12, CRC32: true, actualNativeAction: player.nativeContentAction.status };
  });
  await check("owned-processes-ports-and-original-cache-profiles-restored", () => {
    const known = [...editor.knownProcesses, ...player.knownProcesses], current = rows();
    for (const owned of known) assert(!current.some(p => p.ProcessId === owned.ProcessId && p.Created === owned.Created));
    const ports = [...editor.launches.flatMap(l => l.ports), player.launch.port];
    assert.equal(listeners(ports).length, 0);
    verify(editor.cacheRestoration); assert.equal(read(editor.cacheRestoration.path).status, "PASS");
    verify(player.profileRestoration); assert.equal(read(player.profileRestoration.path).status, "PASS");
    assert(editor.cleanups.every(c => c.status === "PASS"));
    assert(editor.providerCleanup.stopped);
    return { processIdentities: known.length, ports: ports.length, restoreOriginals: "PASS" };
  });
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => {
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, file, error: report.error }));
  });
