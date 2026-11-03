"use strict";
// Independent audit of the normal installed publishing flow. No product launch
// or mutation; historical controlled-IPC evidence has a separate validator.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateUpgradeFixture } = require("./lib/windows-game-upgrade-fixture.cjs");
const base = "F:/AgentVN/QA/Windows-Package-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const steps = [
  "actual-installed-editor-and-public-fixture-import",
  "real-publish-settings-and-native-output-picker",
  "single-real-ui-windows-build-and-result",
  "normal-native-editor-close",
];
function validate(r, { editorVersion = "1.9.22", environmentCacheRedirected = true, expectedUpgradeFixture } = {}) {
  if (expectedUpgradeFixture) assert(r.upgradeFixture, "Bound upgrade fixture must be present");
  if (r.upgradeFixture) {
    if (expectedUpgradeFixture) assert.deepEqual(r.upgradeFixture, expectedUpgradeFixture);
    else validateUpgradeFixture(r.upgradeFixture);
    assert.equal(r.projectId, r.upgradeFixture.project.project_id);
  }
  assert.equal(r.status, "PASS"); assert.equal(r.featureStatus, "PASS");
  assert.equal(r.scope, `ACTUAL_INSTALLED_${editorVersion.replaceAll(".", "_")}_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD`);
  assert(r.finishedAt && !r.error && !r.cleanupError);
  assert.equal(r.productChanges, 0); assert.equal(r.modelRequests, 0); assert.equal(r.builds, 1);
  assert.equal(r.sourceBuilderInvocation, false);
  assert.equal(r.nativeChooserClaim, true); assert.equal(r.normalCloseClaim, true);
  assert.equal(r.protectedUnchanged, true); assert.equal(r.cleanupStatus, "PASS");
  assert.deepEqual(r.errors, []); assert.deepEqual(r.steps.map(s => s.name), steps);
  assert(r.steps.every(s => s.status === "PASS" && s.at && s.finishedAt));
  assert.equal(r.launches.length, 1); assert.equal(r.cleanups.length, 1);
  assert.equal(r.cleanups[0].status, "PASS"); assert.deepEqual(r.cleanups[0].killed, []);
  assert.equal(r.packageRestoration.status, "PASS"); assert.equal(r.packageRestoration.deletedUserFiles, 0);
  if (environmentCacheRedirected) {
    assert.equal(r.cacheRestoration.status, "PASS"); assert.equal(r.cacheRestoration.deletedUserFiles, 0);
  } else assert.equal(r.cacheRestoration, undefined, "Physical environment cache is not claimed as redirected/restored");
  assert.equal(r.initialEnvironment.phase, "completed");
  assert.equal(r.steps[1].detail.environment, "passed");
  const { request, result } = r.nativeOutput;
  assert.equal(request.ownerPid, r.launches[0].pid);
  assert.equal(request.name, "windows-output-select"); assert.equal(request.cancel, false);
  assert.equal(result.status, "INPUT_COMPLETED"); assert.equal(result.requestId, request.requestId);
  assert.equal(result.ownerPid, request.ownerPid); assert.equal(result.cancelled, false);
  assert.equal(path.resolve(result.selectedPath), path.resolve(request.selectedPath));
  assert(result.interaction.includes("Computer Use"));
  const closing = r.steps[3].detail;
  assert.equal(closing.request.ownerPid, r.launches[0].pid);
  assert.equal(closing.receipt.status, "INPUT_COMPLETED");
  assert.equal(closing.receipt.requestId, closing.request.requestId);
  assert.equal(closing.receipt.ownerPid, closing.request.ownerPid);
  assert(closing.receipt.interaction.includes("Computer Use"));
  assert(r.resultText.includes("Windows 软件构建成功"));
  assert(r.knownBuildProcesses.some(p => p.Name === "cargo.exe"));
  assert(r.knownBuildProcesses.some(p => p.Name === "rustc.exe"));
  assert(r.observations.length > 0 && r.observations.at(-1).result === true);
  assert(r.artifacts.length >= 2 && r.windowsInstaller && r.windowsPortable);
  assert.notEqual(r.windowsInstaller.path, r.windowsPortable.path);
  for (const a of [r.windowsInstaller, r.windowsPortable]) {
    assert(a.bytes > 0 && /^[a-f0-9]{64}$/.test(a.sha256) && a.generatedAt);
    assert(r.artifacts.some(f => f.path === a.path && f.sha256 === a.sha256));
    const relative = path.relative(request.selectedPath, a.path);
    assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  }
  assert(!r.artifacts.some(a => /\.msi$/i.test(a.path)));
  assert.equal(r.screenshots.length, 2);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after);
    assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080);
    assert(Math.abs(s.before.dpr - 1) < 1e-6); assert.equal(s.before.reduced, false);
    assert.equal(s.png.width, 1920); assert.equal(s.png.height, 1080);
  }
  return { normalUI: true, nativePicker: true, nativeClose: true,
    builds: 1, displayScope: "1920x1080 DPR1 normal publishing only; runtime matrix separate" };
}
function selfTest(r, options = {}) {
  validate(r, options);
  const bad = [
    x => { x.status = "RUNNING"; }, x => { x.featureStatus = "FAILED"; },
    x => { x.scope = "CONTROLLED_IPC"; }, x => { delete x.finishedAt; },
    x => { x.cleanupError = "restore failed"; }, x => { x.productChanges = 1; },
    x => { x.modelRequests = 1; }, x => { x.builds = 2; },
    x => { x.sourceBuilderInvocation = true; }, x => { x.nativeChooserClaim = false; },
    x => { x.normalCloseClaim = false; }, x => { x.protectedUnchanged = false; },
    x => { x.steps = []; }, x => { x.steps[1].status = "NOT_RUN"; },
    x => { x.errors.push("uncaught"); }, x => { x.cleanups[0].killed.push("forced"); },
    x => { x.packageRestoration.status = "FAILED"; },
    x => {
      if (options.environmentCacheRedirected === false) x.cacheRestoration = { status: "PASS", deletedUserFiles: 0 };
      else x.cacheRestoration.deletedUserFiles = 1;
    },
    x => { x.nativeOutput.result.requestId = "other-request"; },
    x => { x.nativeOutput.result.ownerPid++; },
    x => { x.nativeOutput.result.selectedPath += "-wrong"; },
    x => { x.nativeOutput.result.cancelled = true; },
    x => { x.steps[3].detail.receipt.ownerPid++; },
    x => { x.steps[3].detail.receipt.interaction = "forced process stop"; },
    x => { x.knownBuildProcesses = []; }, x => { x.observations = []; },
    x => { x.windowsPortable.sha256 = ""; },
    x => { x.artifacts.push({ path: "stale.msi" }); },
    x => { x.screenshots.pop(); }, x => { x.screenshots[0].png.width = 3840; },
    x => { x.screenshots[0].before.dpr = 2; },
    x => { x.steps[1].detail.environment = "failed"; },
  ];
  for (const mutate of bad) {
    const copy = structuredClone(r); mutate(copy); assert.throws(() => validate(copy, options));
  }
  return bad.length;
}
function validateRewrittenJson(before, after, name) {
  const input = JSON.parse(before.toString("utf8")), output = JSON.parse(after.toString("utf8"));
  assert.deepEqual(output, input, `${name} data changed`);
  assert.deepEqual(after, Buffer.from(JSON.stringify(input, null, 2) + "\n"),
    `${name} differs from the installed release serializer`);
}
async function main() {
  const attempt = process.argv[2] || "03", audit = process.argv[3] || "01";
  assert(/^\d{2}$/.test(attempt) && /^\d{2}$/.test(audit));
  const run = path.join(base, `editor-${attempt}`), source = path.join(run, "report.json");
  const r = read(source);
  const bindingArg = process.argv.find(a => a.startsWith("--candidate-binding="));
  let options = {}, expectedRunner = path.join(__dirname, "installed-windows-native-ui-current.cjs"), bindingEvidence;
  if (bindingArg) {
    const bindingFile = path.resolve(bindingArg.slice("--candidate-binding=".length));
    assert(path.relative(path.resolve("F:/AgentVN/QA"), bindingFile).split(path.sep)[0] !== "..");
    const binding = read(bindingFile), c = binding.config;
    assert.equal(binding.status, "PREPARED_NOT_PRODUCT_TESTED");
    assert.equal(path.resolve(binding.out), path.resolve(run));
    for (const f of binding.sources) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(c.actualInstallation.path), c.actualInstallation.sha256);
    const actual = read(c.actualInstallation.path), sealedFile = path.join(path.dirname(bindingFile), "installation.json");
    assert.equal(actual.status, "PASS"); assert.equal(actual.exitCode, 0); assert.equal(actual.registryRestored, true);
    assert.equal(sha(actual.installer.path), c.installerSHA256);
    assert.equal(sha(actual.executable.path), actual.executable.sha256);
    assert.equal(ps(`(Get-Item -LiteralPath '${actual.executable.path.replaceAll("'", "''")}').VersionInfo.ProductVersion`), c.version);
    assert.equal(path.resolve(r.installation.path), path.resolve(sealedFile));
    const sealed = read(sealedFile);
    assert.equal(path.resolve(sealed.installRoot), path.resolve(actual.installRoot));
    assert.deepEqual(sealed.executable, actual.executable);
    assert.deepEqual(r.bindingSources, binding.sources.slice(0, 3));
    options = { editorVersion: c.version, environmentCacheRedirected: false };
    if (binding.upgradeFixture) {
      const expected = require("./installed-editor-windows-upgrade-candidate.cjs").fixtureFor(c.version);
      assert.deepEqual(binding.upgradeFixture, expected);
      options.expectedUpgradeFixture = expected;
    }
    expectedRunner = path.join(path.dirname(bindingFile), "run.cjs");
    bindingEvidence = { path: bindingFile, sha256: sha(bindingFile), actualInstallation: c.actualInstallation };
  }
  assert.notEqual(r.status, "RUNNING", "Do not audit a live run as terminal");
  const out = path.join(base, `native-ui-audit-${audit}`); fs.mkdirSync(out);
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(),
    source: { path: source, sha256: sha(source) }, groups: [], modelRequests: 0, productChanges: 0,
    ...(bindingEvidence ? { candidateBinding: bindingEvidence } : {}) };
  async function group(name, fn) {
    const item = { name, status: "RUNNING" }; report.groups.push(item);
    try { item.detail = await fn(); item.status = "PASS"; }
    catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
  }
  try {
    await group("terminal-flow-and-negative-evidence", () => ({
      ...validate(r, options), rejectedEvidenceVariants: selfTest(r, options),
    }));
    await group("installed-candidate-and-generated-artifact-hashes", () => {
      for (const f of [r.installation, r.input, ...r.protectedFiles, ...r.artifacts, ...r.observedFiles])
        assert.equal(sha(f.path), f.sha256, f.path);
      const installed = read(r.installation.path);
      assert.equal(installed.version, options.editorVersion || "1.9.22");
      assert.equal(sha(installed.executable.path), installed.executable.sha256);
      for (const resource of installed.resources) assert.equal(sha(resource.path), resource.sha256);
      assert.equal(sha(path.join(run, "executed.cjs")), sha(expectedRunner));
      for (const [prefix, file] of [
        ["builder-", "scripts/build-runtime-standalone-windows.cjs"],
        ["runtime-", "GameCli_framework/src-tauri/src/lib.rs"],
      ]) assert(r.observedFiles.some(f => path.basename(f.path).startsWith(prefix)
        && f.sha256 === sha(path.join(installed.installRoot, file))));
      assert(r.observedFiles.some(f => path.basename(f.path).startsWith("versions-")
        && read(f.path).editorVersion === (options.editorVersion || "1.9.22")));
      const pe = JSON.parse(ps(`$v=(Get-Item -LiteralPath '${r.windowsPortable.path.replace(/'/g, "''")}').VersionInfo;` +
        "@{fileVersion=$v.FileVersion;productVersion=$v.ProductVersion;productName=$v.ProductName}|ConvertTo-Json -Compress"));
      assert.equal(pe.fileVersion, r.upgradeFixture?.version || "1.0.0");
      return { editorVersion: installed.version, playerPE: pe, artifacts: r.artifacts.length };
    });
    await group("observed-input-cartridge-and-embedded-bytes", async () => {
      const sourceCartridges = r.observedFiles.filter(f => path.basename(f.path).startsWith("source-cartridge-"));
      assert.equal(sourceCartridges.length, 1);
      const zip = await JSZip.loadAsync(fs.readFileSync(sourceCartridges[0].path), { checkCRC32: true });
      const embedded = path.join(path.dirname(r.windowsPortable.path), "embedded-cartridge"), entries = [];
      const inputNames = Object.values(zip.files).filter(e => !e.dir).map(e => e.name).sort();
      const jsonNames = ["manifest.json", "script.json", "gallery.json", "ui/layout.json"];
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        assert(!path.isAbsolute(name) && !name.split(/[\\/]/).includes(".."));
        const file = path.join(embedded, name), bytes = await entry.async("nodebuffer");
        const actual = fs.readFileSync(file);
        if (jsonNames.includes(name)) {
          validateRewrittenJson(bytes, actual, name);
          const corrupted = JSON.parse(actual.toString("utf8")); corrupted.__auditCorruption = true;
          assert.throws(() => validateRewrittenJson(bytes, Buffer.from(JSON.stringify(corrupted, null, 2) + "\n"), name));
          assert.throws(() => validateRewrittenJson(bytes, Buffer.from(JSON.stringify(JSON.parse(bytes), null, 2)), name));
        } else if (name !== "checksum.json") assert.deepEqual(actual, bytes, name);
        entries.push({ name, inputBytes: bytes.length, outputBytes: actual.length,
          inputSha256: crypto.createHash("sha256").update(bytes).digest("hex"), outputSha256: sha(file),
          rule: jsonNames.includes(name) ? "UNCHANGED_DATA_EXACT_PRETTY_JSON_PLUS_LF"
            : name === "checksum.json" ? "REBUILT_FROM_FINAL_BYTES_CHECKED_BELOW" : "BYTE_EXACT" });
      }
      const manifest = read(path.join(embedded, "manifest.json"));
      const script = read(path.join(embedded, "script.json"));
      assert.equal(manifest.game_id, r.projectId);
      assert.equal(manifest.version, r.upgradeFixture?.version || "1.0.0");
      for (const i of [0, 1, 2]) assert(JSON.stringify(script).includes(`${r.upgradeFixture?.marker || "QA_WINDOWS_NATIVE"}_${i}`));
      if (r.upgradeFixture) assert.deepEqual(read(r.input.path), r.upgradeFixture.project);
      assert(entries.some(e => e.name === "ui/layout.json"));
      // The actual fixture has no media. All input entries other than checksum
      // must remain, and the release pipeline adds exactly startup-index.json.
      assert.deepEqual(manifest.assets, []);
      const layout = read(path.join(embedded, "ui/layout.json")); assert.deepEqual(layout.assets, []);
      const originalChecksum = JSON.parse(await zip.file("checksum.json").async("string"));
      const checksum = read(path.join(embedded, "checksum.json"));
      const { files: oldFiles, algorithm: oldAlgorithm, checksum_version: oldVersion, ...oldRest } = originalChecksum;
      const { files: newFiles, algorithm, checksum_version: version, ...newRest } = checksum;
      assert.deepEqual(newRest, oldRest); assert.equal(algorithm, "sha256");
      assert.equal(version, oldVersion ?? "1.0.0");
      const expectedPaths = inputNames.filter(name => name !== "checksum.json");
      assert.deepEqual(newFiles.map(f => f.path), expectedPaths);
      for (const file of newFiles) {
        const bytes = fs.readFileSync(path.join(embedded, file.path));
        assert.equal(file.size_bytes, bytes.length);
        assert.equal(file.hash_sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
      }
      assert.deepEqual(fs.readFileSync(path.join(embedded, "checksum.json")), Buffer.from(JSON.stringify(checksum, null, 2) + "\n"));
      const startup = read(path.join(embedded, "startup-index.json"));
      assert.equal(startup.contentId, sha(path.join(embedded, "checksum.json")));
      assert.deepEqual(startup.files, {}); assert.deepEqual(startup.entrySceneAssets, []);
      assert.deepEqual(startup.titleAssets, []);
      const actualNames = [];
      const walk = (dir, prefix = "") => {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          assert(!item.isSymbolicLink());
          const name = prefix + item.name;
          if (item.isDirectory()) walk(path.join(dir, item.name), name + "/");
          else actualNames.push(name);
        }
      };
      walk(embedded); assert.deepEqual(actualNames.sort(), [...inputNames, "startup-index.json"].sort());
      const installed = read(r.installation.path);
      const serializer = path.join(installed.installRoot, "scripts/build-release-runtime-assets.cjs");
      assert(fs.readFileSync(serializer, "utf8").includes('`${JSON.stringify(value, null, 2)}\\n`'));
      return { sourceCartridge: sourceCartridges[0], manifest, entries,
        serializer: { path: serializer, sha256: sha(serializer) }, checksum, startup,
        rejectedByteAndDataCorruptions: jsonNames.length * 2 };
    });
    await group("actual-png-and-webview-parameters", () => r.screenshots.map(s => {
      // Capture helper stores a source-verified PNG dimension record; decode the
      // file header again here instead of trusting that record.
      const file = s.path, bytes = fs.readFileSync(file);
      assert.equal(bytes.subarray(1, 4).toString(), "PNG");
      const png = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
      assert.equal(png.width, s.png.width); assert.equal(png.height, s.png.height);
      return { path: file, sha256: sha(file), png, before: s.before, after: s.after };
    }));
    await group("cache-restoration-and-native-receipts", () => {
      assert.deepEqual(read(path.join(run, "package-cache-restoration.json")), r.packageRestoration);
      if (options.environmentCacheRedirected !== false)
        assert.deepEqual(read(path.join(run, "native-cache-restoration.json")), r.cacheRestoration);
      else assert(!fs.existsSync(path.join(run, "native-cache-restoration.json")));
      assert.deepEqual(read(r.nativeOutput.request.completion), r.nativeOutput.result);
      assert.deepEqual(read(r.steps[3].detail.request.completion), r.steps[3].detail.receipt);
      assert.deepEqual(fs.readdirSync(path.join(run, "package-cache")), []);
      return { userFilesDeleted: 0, nativeChooser: true, normalClose: true };
    });
    await group("owned-process-and-port-terminal", () => {
      const live = rows(), known = [...r.knownProcesses, ...r.knownBuildProcesses];
      assert(!known.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created)));
      const ports = r.launches.flatMap(l => l.ports); assert.deepEqual(listeners(ports), []);
      return { identities: new Set(known.map(p => `${p.ProcessId}:${p.Created}`)).size, ports };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, groups: report.groups.map(g => ({ name: g.name, status: g.status })),
    error: report.error }, null, 2));
}
module.exports = { validate, selfTest };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
