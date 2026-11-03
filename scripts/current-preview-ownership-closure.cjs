"use strict";
// Distinct QA-owned Player with identical executable/root must survive the
// Editor's close-preview action. No user Player is ever attached or terminated.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-control-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const qa = "F:/AgentVN/QA/Preview-1.9.35-20261102-01";
const work = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-02";
const originalFile = path.join(__dirname, "installed-preview-ownership-current.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
function build(original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  change('"installed-01/report.json"', '"installed-35/report.json"');
  change('"1.9.14"', '"1.9.35"');
  change('installationFile: path.join(qa, "installation.json")', `installationFile: ${JSON.stringify(receipt)}`);
  change('report.tools = ["scripts/lib/installed-release-session.cjs"',
    'report.qaBinding = module.qaBinding;\n  report.builds = 0; report.productChanges = 0;\n' +
    '  report.tools = ["scripts/lib/installed-release-session.cjs"');
  new vm.Script(Module.wrap(source)); return { source, edits };
}
function audit() {
  const r = read(path.join(work, "ownership-35/report.json")), installed = descriptor();
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [],
    source: desc(path.join(work, "ownership-35/report.json")), modelRequests: 0, builds: 0,
    productChanges: 0, productStarts: 0, scope: "EXACT_INSTALLED_PREVIEW_PROCESS_OWNERSHIP_NO_MATRIX_REPLAY" };
  const check = (name, fn) => {
    const item = { name, status: "RUNNING" }; report.cases.push(item);
    try { item.detail = fn(); item.status = "PASS"; }
    catch (error) { item.status = "FAILED"; throw error; }
  };
  const out = path.join(qa, "ownership-audit-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  try {
    check("Exact binaries, complete three-step behavior and independently advancing identical Player", () => {
      assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError);
      assert.deepEqual(r.errors, []); assert.equal(r.version, "1.9.35");
      assert.equal(r.steps.length, 3); assert(r.steps.every(s => s.status === "PASS"));
      assert.equal(r.modelRequests, 0); assert.equal(r.builds, 0); assert.equal(r.productChanges, 0);
      assert.equal(r.launches.length, 1);
      assert.equal(r.launches[0].executable.sha256, installed.executable.sha256);
      assert.equal(r.owned.process.ParentProcessId, r.launches[0].pid);
      assert.notEqual(r.sentinel.process.ParentProcessId, r.launches[0].pid);
      assert.notEqual(r.sentinel.process.ProcessId, r.owned.process.ProcessId);
      assert.equal(r.owned.previewRoot, r.sentinel.previewRoot);
      assert.equal(path.resolve(r.owned.executable.path), path.resolve(r.sentinel.executable.path));
      const player = installed.resources.find(p => path.basename(p.path) === "agentvn-player.exe");
      assert.equal(r.owned.executable.sha256, player.sha256); assert.equal(r.sentinel.executable.sha256, player.sha256);
      assert(r.steps[2].result.actualIndependentStoryAdvance && r.steps[2].result.sameExecutableAndRoot);
      return { ownedClosed: true, independentStillAdvanced: true, productNamesNotUsedAsOwnership: true };
    });
    check("Frozen executable code and screenshots match recorded parameters and bytes", () => {
      assert.equal(sha(r.qaBinding.path), r.qaBinding.sha256);
      const binding = read(r.qaBinding.path);
      for (const file of [binding.original, binding.adapter, binding.executed]) assert.equal(sha(file.path), file.sha256);
      assert.equal(sha(r.source.path), r.source.sha256);
      assert.equal(r.screenshots.length, 1);
      for (const image of r.screenshots) {
        assert.equal(sha(image.path), image.sha256); assert.deepEqual(image.before, image.after);
        validateNativeViewport(image.before, { width: 1920, height: 1080, dpr: 1, reduced: false });
        const png = fs.readFileSync(image.path);
        assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
      }
      return { png: 1, screenshotScope: "Editor status; actual independent progression asserted separately" };
    });
    check("Three original profile/cache directories restored and all QA identities/ports gone", () => {
      const journal = read(path.join(work, "ownership-35/profile-protection.json"));
      assert.equal(sha(r.profileRestoration.path), r.profileRestoration.sha256);
      const restored = read(r.profileRestoration.path);
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert.equal(journal.records.length, 3); assert.equal(restored.restored.length, 3);
      for (const p of journal.records) {
        assert(!fs.existsSync(p.held)); const actual = restored.restored.find(x => x.original === p.original);
        assert(actual); assert.deepEqual(actual.files, p.files); assert.equal(actual.directoryId, p.directoryId);
        if (p.directoryId) {
          const actualId = ps(`$v=(& fsutil.exe file queryfileid '${p.original}'|Out-String);` +
            `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'Missing ID'};$Matches[0].ToLowerInvariant()`);
          assert.equal(actualId, p.directoryId);
        }
        for (const file of p.files) assert.equal(sha(path.join(p.original, file.relative)), file.sha256);
      }
      const id = p => `${p.ProcessId}:${p.Created}`;
      const known = new Set(r.observedProcesses.map(id)); assert(known.size > 0);
      assert(!rows().some(p => known.has(id(p))));
      const ports = [...r.launches[0].ports, ...r.ports]; assert.deepEqual(listeners(ports), []);
      assert.equal(r.cleanups.length, 1); assert.equal(r.cleanups[0].status, "PASS");
      for (const file of r.protectedFiles) assert.equal(sha(file.path), file.sha256);
      return { identities: known.size, ports, originalProfilesRestored: 3, deletedUserFiles: 0 };
    });
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, groups: report.cases.length, out, error: report.error }));
  }
}
function main(mode) {
  if (mode === "audit") return audit();
  const installed = descriptor(), original = fs.readFileSync(originalFile, "utf8"), result = build(original);
  if (mode === "self-test") {
    let reversed = result.source;
    for (const e of [...result.edits].reverse()) reversed = reversed.replaceAll(e.after, () => e.before);
    assert.equal(reversed, original); assert.throws(() => build(""));
    return console.log(JSON.stringify({ status: "PASS", reversibleAdapter: true, productStarts: 0 }));
  }
  assert.equal(mode, "run");
  const bindingDir = path.join(qa, "ownership-binding"); assert(!fs.existsSync(bindingDir)); fs.mkdirSync(bindingDir);
  fs.writeFileSync(path.join(bindingDir, "executed.cjs"), result.source, { flag: "wx" });
  fs.copyFileSync(__filename, path.join(bindingDir, "frozen-adapter.cjs"), fs.constants.COPYFILE_EXCL);
  const bindingFile = path.join(bindingDir, "binding.json");
  fs.writeFileSync(bindingFile, JSON.stringify({ original: desc(originalFile), adapter: desc(__filename),
    executed: desc(path.join(bindingDir, "executed.cjs")), edits: result.edits,
    installation: desc(receipt), products: [installed.executable, ...installed.resources],
    builds: 0, modelRequests: 0, productChanges: 0 }, null, 2), { flag: "wx" });
  process.argv = [process.execPath, originalFile, "35"];
  const worker = new Module(originalFile, module);
  Object.assign(worker, { filename: originalFile, paths: Module._nodeModulePaths(__dirname), qaBinding: desc(bindingFile) });
  worker._compile(result.source, originalFile);
}
if (require.main === module) main(process.argv[2]);
