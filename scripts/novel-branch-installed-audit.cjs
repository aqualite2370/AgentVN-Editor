"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Novel-Branch-Completion-20261103-01", [run, attempt] = process.argv.slice(2);
assert(/^\d{2}$/.test(run || "") && /^\d{2}$/.test(attempt || ""));
const output = path.join(qa, `installed-audit-${attempt}.json`); assert(!fs.existsSync(output));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const file = path.join(qa, `installed-${run}/report.json`), r = read(file);
const audit = { status: "RUNNING", at: new Date().toISOString(), report: { path: file, sha256: sha(file) }, checks: [],
  scope: "ACTUAL_INSTALLED_EDITOR_AUTHOR_CHAIN_LOCAL_MODEL_HTTP_1080P",
  notCovered: ["Fresh paid novel generation", "Coverage upgrade/default database", "Installed Player matrix", "Android", "Final user project"] };
async function check(name, action) {
  try { audit.checks.push({ name, status: "PASS", detail: await action() }); }
  catch (e) { audit.checks.push({ name, status: "FAILED", error: String(e.stack || e) }); }
}
(async () => {
  await check("exact-1.9.39-builds-actual-installation-and-restored-user-metadata", () => {
    for (const mode of ["gates", "dev", "release"]) {
      const p = read(path.join(qa, `${mode}-01/report.json`));
      assert.equal(p.status, "PASS"); assert.equal(p.version, "1.9.39");
      assert(p.commands.length && p.commands.every(c => c.status === "PASS" && c.exitCode === 0));
      for (const c of p.commands) assert.equal(sha(c.log.path), c.log.sha256);
    }
    const p = verifiedInstalledCandidate(path.join(qa, "installation-01/installation.json"));
    assert.equal(p.executable.version, "1.9.39"); assert.equal(p.metadataRestoration, "PASS");
    assert.equal(r.owner.installation.executable.sha256, p.executable.sha256);
    for (const launch of r.launches) {
      assert.equal(launch.executable.sha256, p.executable.sha256);
      assert.equal(launch.manualBackendSpawn, false); assert.equal(launch.sourceServer, false);
      assert.equal(launch.backend.sha256, p.resources.find(f => path.basename(f.path) === "creator-backend.exe").sha256);
    }
    return { installation: p.installRoot, actualLaunches: r.launches.length, defaultUserDataProtected: true };
  });
  await check("four-actual-installed-author-stages-and-only-twenty-loopback-requests", () => {
    assert.equal(r.status, "PASS"); assert.equal(r.scope, "ACTUAL_INSTALLED_EDITOR_AND_BUNDLED_BACKEND_CONTROLLED_MODEL");
    assert.equal(r.cases.length, 4); assert(r.cases.every(c => c.status === "PASS"));
    assert.equal(r.model.length, 20); assert(r.model.every(m => !m.error)); assert.equal(r.paidRequests, 0);
    assert.equal(r.launches.length, 2);
    if (r.continuation) {
      const source = r.continuation.source;
      assert.equal(sha(source.path), source.sha256);
      const previous = read(source.path);
      assert.equal(previous.scope, r.scope); assert.equal(previous.cleanup, "PASS");
      assert.equal(previous.cases[2].status, "FAILED", "Retain the previous failed download conclusion");
      assert.equal(r.continuation.inheritedCases, 2);
      assert.equal(r.continuation.inheritedLocalModelRequests, 20);
      assert.equal(r.newModelRequests, 0);
      assert.deepEqual(r.model, previous.model); assert.deepEqual(r.saved, previous.saved);
      assert.deepEqual(r.connected, previous.connected);
      assert.equal(r.owner.installation.executable.sha256, previous.owner.installation.executable.sha256);
      for (let index = 0; index < 2; index++) {
        const { inheritedFrom, ...item } = r.cases[index];
        assert.deepEqual(inheritedFrom, source);
        assert.deepEqual(item, previous.cases[index]);
      }
    }
    return { cases: 4, inheritedCases: r.continuation?.inheritedCases || 0,
      paidRequests: 0, localHttpRequests: 20, newLocalHttpRequests: r.continuation ? 0 : 20,
      nativePickerClaimed: false };
  });
  await check("saved-portable-and-UI-exported-cartridge-have-real-intermediate-and-terminal-links", async () => {
    assert.equal(sha(r.saved.path), r.saved.sha256); assert.equal(sha(r.exported.file.path), r.exported.file.sha256);
    const projectZip = await JSZip.loadAsync(fs.readFileSync(r.saved.path), { checkCRC32: true });
    const project = JSON.parse(await projectZip.file("project.json").async("string"));
    assert.deepEqual(project.nodes, r.connected.nodes); assert.deepEqual(project.edges, r.connected.edges);
    const zip = await JSZip.loadAsync(fs.readFileSync(r.exported.file.path), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
    assert.deepEqual(script, r.exported.script);
    const download = r.exported.file.cdp;
    assert(download?.guid, "Record a real CDP download, not reconstructed Blob bytes");
    const terminal = download.progress.filter(event => event.type === "progress" &&
      event.guid === download.guid && event.state === "completed");
    assert(terminal.length > 0);
    assert.equal(terminal.at(-1).receivedBytes, r.exported.file.bytes);
    assert.equal(terminal.at(-1).totalBytes, r.exported.file.bytes);
    const choices = script.scenes.filter(s => s.commands.some(c => c.type === "choice")); assert.equal(choices.length, 2);
    for (const scene of choices) {
      assert.equal(scene.commands[0].choices.length, 2);
      for (const choice of scene.commands[0].choices) assert(script.scenes.some(s => s.scene_id === choice.target_scene_id));
    }
    const last = script.scenes.find(s => s.scene_id === "qa_multi_scene_2");
    assert(!last.is_ending && last.next_scene_id);
    const lastChoice = script.scenes.find(s => s.scene_id === last.next_scene_id).commands[0];
    const target = lastChoice.choices.find(c => c.choice_id === "mainline").target_scene_id;
    assert(script.scenes.find(s => s.scene_id === target)?.is_ending);
    return { packageCRC: true, cartridgeCRC: true, choices: 2, terminalTarget: target };
  });
  await check("source-matrix-reference-actual-installed-PNG-and-owned-cleanup", () => {
    assert.equal(read(path.join(qa, "audit-01.json")).status, "PASS");
    assert.equal(r.screenshots.length, 1);
    const screenshot = r.screenshots[0], png = fs.readFileSync(screenshot.path);
    assert.equal(sha(screenshot.path), screenshot.sha256); assert.deepEqual(screenshot.before, screenshot.after);
    assert.equal(png.readUInt32BE(16), screenshot.before.width * screenshot.before.dpr);
    assert.equal(png.readUInt32BE(20), screenshot.before.height * screenshot.before.dpr);
    assert.equal(r.testCredentialCleanup, "PASS_EMPTY_SYNTHETIC_SECRET_CHANNEL");
    assert.equal(r.cleanup, "PASS"); assert.deepEqual(r.remainingPorts, []);
    const id = p => `${p.ProcessId}:${p.Created}`, known = new Set(r.knownProcesses.map(id));
    assert.equal(rows().filter(p => known.has(id(p))).length, 0);
    assert.equal(listeners(r.launches.flatMap(l => l.ports)).length, 0);
    return { installedPNGs: 1, referencedBrowserCells: 12, remainingProcesses: 0 };
  });
  audit.status = audit.checks.length === 4 && audit.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  fs.writeFileSync(output, JSON.stringify(audit, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: audit.status, output, checks: audit.checks.map(c => [c.name, c.status]) }));
  if (audit.status !== "PASS") process.exitCode = 1;
})();
