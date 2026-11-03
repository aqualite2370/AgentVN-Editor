"use strict";
// Audit retained evidence only; never repeat UI matrices or manufacture an install.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const [authorFile, nativeFile, output] = process.argv.slice(2);
assert(authorFile && nativeFile && output && !fs.existsSync(output));
const root = path.resolve(__dirname, ".."), qa = "F:\\AgentVN\\QA\\Player-Aspect-20261102-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const desc = f => ({ file: f, sha256: sha(f) });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
  scope: "PLAYER_ASPECT_RELEASE_INSTALL_AUTHOR_AND_INSTALLED_PREVIEW_NOT_SETUP_ANDROID_OR_FULL_AUDIT" };
async function check(name, run) { await run(); report.checks.push({ name, status: "PASS" }); }
function fileIdentity(d) {
  const file = d.path || d.file;
  assert.equal(sha(file), d.sha256);
  if (d.bytes !== undefined) assert.equal(fs.statSync(file).size, d.bytes);
}
(async () => {
  const releaseFile = path.join(qa, "release-02/report.json");
  const payloadFile = path.join(qa, "payload-01/installer-resource-report.json");
  const installFile = path.join(qa, "installation-01/installation.json");
  const release = read(releaseFile), payload = read(payloadFile), rawInstall = read(installFile);
  const installation = verifiedInstalledCandidate(installFile);
  const author = read(authorFile), native = read(nativeFile);
  await check("one real EXE-only candidate, actual installed payload and coherent versions", () => {
    for (const r of [release, payload, installation]) assert.equal(r.status, "PASS");
    assert.equal(release.version, "1.9.36"); assert.equal(payload.version, release.version);
    assert.equal(rawInstall.executable.version, release.version); assert.equal(rawInstall.exitCode, 0);
    assert.equal(release.commands.length, 2);
    assert.equal(release.commands.filter(c => c.name === "package-editor").length, 1);
    for (const command of release.commands) {
      assert.equal(command.status, "PASS"); assert.equal(command.exitCode, 0); fileIdentity(command.logIdentity);
    }
    fileIdentity(release.installer); fileIdentity(release.retainedInstaller); fileIdentity(rawInstall.installer);
    assert.equal(release.installer.sha256, rawInstall.installer.sha256);
    assert.equal(release.installer.sha256, payload.installers[0].sha256);
    assert.equal(payload.deployments.length, 1);
    const deployed = payload.deployments[0]; assert.equal(deployed.kind, "NSIS actual payload");
    assert.equal(deployed.executable.sha256, installation.executable.sha256);
    fileIdentity(deployed.executable); fileIdentity(installation.executable);
    for (const resource of installation.resources) fileIdentity(resource);
    for (const f of release.currentVersionSources) fileIdentity(f);
    const versions = read(path.join(installation.installRoot, "build-versions.json"));
    assert.equal(versions.editorVersion, release.version);
    assert.equal(read(path.join(root, "editor/package.json")).version, release.version);
    // Original Dev is deliberately not relabeled as a 1.9.36 build.
    report.devVersionNote = "Dev compiled before patch version bump; no claim of a 1.9.36 Dev rebuild";
  });
  await check("installed Editor author controls, twelve display combinations and restart/reimport", () => {
    assert.equal(author.status, "PASS"); assert.equal(author.cleanup, "PASS");
    assert.equal(author.error, undefined); assert.equal(author.cleanupError, undefined);
    assert.deepEqual(author.errors, []); assert.equal(author.modelRequests, 0);
    fileIdentity(author.testIdentity); fileIdentity(author.installation);
    assert.equal(author.installation.sha256, sha(installFile));
    assert.equal(author.steps.length, 4); assert(author.steps.every(s => s.status === "PASS"));
    assert.equal(author.cases.length, 30); assert(author.cases.every(c => c.status === "PASS"));
    for (const type of ["renpy", "agentvn"]) {
      for (const ratio of ["16:9", "16:10", "4:3"])
        assert(author.cases.some(c => c.name === "real-layout-save" && c.type === type && c.ratio === ratio));
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const c = author.cases.find(c => c.name === "installed-designer-matrix"
          && c.type === type && c.width === width && c.dpr === dpr && c.reduced === reduced);
        assert(c); assert.deepEqual(c.previews.map(p => p.ratio), ["16:9", "16:10", "4:3"]);
      }
    }
    assert.equal(author.launches.length, 3); assert.equal(author.cleanups.length, 3);
    assert(author.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
    for (const launch of author.launches) {
      assert.equal(launch.executable.sha256, installation.executable.sha256);
      assert.equal(launch.backend.sha256, installation.resources.find(r => path.basename(r.path) === "creator-backend.exe").sha256);
      assert.equal(launch.sourceServer, false); assert.equal(launch.manualBackendSpawn, false);
    }
  });
  await check("native project bytes, two actual UI cartridges and explicit B identity fixtures", async () => {
    fileIdentity(author.portable);
    const projectZip = await JSZip.loadAsync(fs.readFileSync(author.portable.path), { checkCRC32: true });
    const project = JSON.parse(await projectZip.file("project.json").async("string"));
    assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, author.expectedProfiles);
    assert.equal(author.cartridges.length, 2); assert.equal(author.inputs.length, 2);
    assert.equal(author.downloads.length, 2);
    for (const input of author.inputs) {
      const cartridge = author.cartridges.find(c => c.type === input.type); assert(cartridge);
      assert.equal(cartridge.path, input.file); assert.equal(cartridge.sha256, input.sha256); fileIdentity(cartridge);
      assert.equal(sha(input.second), input.secondSha256); assert.equal(input.secondIsControlledIdentityFixture, true);
      const zip = await JSZip.loadAsync(fs.readFileSync(input.file), { checkCRC32: true });
      const second = await JSZip.loadAsync(fs.readFileSync(input.second), { checkCRC32: true });
      const skin = await zip.file("ui/layout.json").async("string");
      assert.equal(skin, await second.file("ui/layout.json").async("string"));
      assert.equal(JSON.parse(skin).gameViewport.aspectRatio, "4:3");
      assert.equal(JSON.parse(skin).layout_type ?? "agentvn", input.type);
      const a = JSON.parse(await zip.file("manifest.json").async("string"));
      const b = JSON.parse(await second.file("manifest.json").async("string"));
      assert.equal(a.runtime_version, "0.27.0"); assert.notEqual(a.game_id, b.game_id);
      for (const z of [zip, second]) {
        const manifest = JSON.parse(await z.file("manifest.json").async("string"));
        const script = JSON.parse(await z.file("script.json").async("string"));
        assert.equal(manifest.game_id, script.game_id);
        const checksums = JSON.parse(await z.file("checksum.json").async("string"));
        assert(checksums.files.length > 0);
        for (const f of checksums.files) {
          const bytes = await z.file(f.path).async("nodebuffer");
          assert.equal(bytes.length, f.size_bytes); assert.equal(hash(bytes), f.hash_sha256);
        }
      }
      const download = author.downloads.find(d => d.file.sha256 === input.sha256); assert(download);
      assert(download.events.some(e => e.type === "progress" && e.state === "completed"));
    }
  });
  await check("same installed Player consumes current exports, gameplay override and actual process isolation", () => {
    assert.equal(native.status, "PASS"); assert.equal(native.cleanup, "PASS");
    assert.equal(native.error, undefined); assert.equal(native.cleanupError, undefined);
    assert.deepEqual(native.errors, []); assert.equal(native.modelRequests, 0);
    fileIdentity(native.testIdentity); fileIdentity(native.installation); fileIdentity(native.installedExports);
    assert.equal(native.installedExports.sha256, sha(authorFile));
    assert.equal(native.installation.sha256, sha(installFile));
    const player = installation.resources.find(r => path.basename(r.path) === "agentvn-player.exe"); assert(player);
    assert.equal(native.executable.file, player.path); assert.equal(native.executable.sha256, player.sha256);
    fileIdentity(native.executable);
    const previous = read("F:/AgentVN/QA/Native-Runtime-State-20261020-01/player-aspect-20261102-01/report.json");
    assert.equal(previous.status, "PASS"); assert.equal(previous.executable.sha256, player.sha256);
    assert.equal(previous.cases.length, 26);
    assert.equal(native.cases.length, 4); assert.equal(native.launches.length, 8);
    assert(native.cases.every(c => c.status === "PASS"));
    for (const type of ["renpy", "agentvn"]) {
      const c = native.cases.find(c => c.type === type && c.choices);
      assert.deepEqual(c.choices.map(p => p.value), ["16:9", "16:10", "4:3", "default"]);
      assert(c.choices.every(p => p.geometry.length === 4 && p.geometry.every(g => g.hit)));
      const restart = native.cases.find(c => c.type === type && c.browserProcessRestart);
      assert(restart && restart.storyPositionUnchanged && restart.gameIds[0] !== restart.gameIds[1]);
      assert.deepEqual(native.launches.filter(l => l.type === type).map(l => l.label), ["A", "B", "A-restart", "B-restart"]);
    }
    report.reusedSameByteFullMatrix = desc("F:/AgentVN/QA/Native-Runtime-State-20261020-01/player-aspect-20261102-01/report.json");
    report.installedPlayerScope = "4 smoke cases / 8 launches; not a repeated 24-combination native matrix";
  });
  await check("six screenshots preserve actual viewport/DPR and PNG dimensions", () => {
    assert.equal(author.screenshots.length, 4); assert.equal(native.screenshots.length, 2);
    for (const s of [...author.screenshots, ...native.screenshots]) {
      fileIdentity(s); assert.deepEqual(s.before, s.after);
      const b = fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
    }
  });
  await check("original cache/profile bytes restored, only archived download removed, owned processes/ports absent", () => {
    fileIdentity(author.cacheRestoration); fileIdentity(native.profileRestoration);
    const cache = read(author.cacheRestoration.path), profile = read(native.profileRestoration.file);
    for (const r of [cache, profile]) {
      assert.equal(r.status, "PASS"); assert.equal(r.deletedUserFiles, 0);
    }
    for (const f of cache.originalFiles) assert.equal(sha(path.join(cache.originalDirectory, f.relative)), f.sha256);
    for (const p of profile.restored) for (const f of p.files || [])
      assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
    assert.equal(author.downloadCleanup.status, "PASS"); assert.equal(author.downloadCleanup.deletedUserFiles, 0);
    assert.equal(author.downloadCleanup.removed.sha256, author.portable.sha256);
    assert(!fs.existsSync(author.downloadCleanup.removed.path)); fileIdentity(author.downloadCleanup.retained);
    const processes = [...author.knownProcesses, ...native.knownProcesses];
    const identities = new Set(processes.map(p => `${p.ProcessId}:${p.Created}`));
    assert(!rows().some(p => identities.has(`${p.ProcessId}:${p.Created}`)));
    const ports = [...author.launches.flatMap(l => l.ports), ...native.launches.map(l => l.port)];
    assert.deepEqual(listeners(ports), []); assert(native.launches.every(l => l.cleanup.status === "PASS"));
    report.ownedProcessIdentities = identities.size; report.ports = ports;
    assert.equal(rawInstall.metadataRestoration, "PASS");
    for (const f of rawInstall.protectedFiles) fileIdentity(f);
    for (const f of rawInstall.shortcuts) {
      if (f.existed) fileIdentity(f); else assert(!fs.existsSync(f.path));
    }
  });
  report.inputs = [releaseFile, payloadFile, installFile, authorFile, nativeFile].map(desc);
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
});
