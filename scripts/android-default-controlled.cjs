"use strict";
// QA only. Reuse the installed UI build with one directory response and an
// explicit programmatic native-close request. Neither is physical input proof.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const base = require("./installed-editor-android-candidate.cjs");
const auditBase = require("./android-candidate-package-audit.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file) });
function replace(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, "Exact QA integration seam required");
  return source.replace(before, after);
}
function validateSelection(b, source) {
  assert.equal(b.nativeOutput, undefined);
  assert.equal(b.nativePickerStatus, "NOT_RUN_CONTROLLED_INPUT");
  assert.equal(b.normalUIExportStatus, "PASS_UI_CONTROLLED_DIRECTORY");
  const s = b.controlledOutput;
  assert.equal(s.status, "CONTROLLED_DIRECTORY_INJECTED");
  assert.equal(s.nativePickerTested, false); assert.equal(s.productModified, false);
  assert.equal(s.persistedHook, false); assert.equal(s.command, "select_package_output_dir");
  assert.equal(s.ownerPid, b.launches[0].pid);
  assert.equal(path.resolve(s.selectedPath), path.resolve(source, "Android 输出"));
  assert.equal(s.result.calls, 1); assert.equal(s.result.restored, true);
  assert.equal(s.cleanup.restored, true);
}
function validateClose(b) {
  const c = b.normalClose;
  assert.equal(c.method, "NATIVE_IPC_CLOSE"); assert.equal(c.command, "plugin:window|close");
  assert.equal(c.physicalInput, false); assert.equal(c.ownerPid, b.launches[0].pid);
  assert.equal(typeof c.label, "string"); assert(c.label.length > 0);
  assert.equal(c.observedHostAndPortsGone, true);
  assert.equal(b.cleanups.length, 1); assert.equal(b.cleanups[0].status, "PASS");
  assert.deepEqual(b.cleanups[0].killed, []);
}
function config(file) {
  const c = read(file); base.validateConfig(c);
  assert.equal(c.fixtureKind, undefined, "Default AgentVN fixture only");
  assert.equal(c.outputDirectoryMode, "controlled-once");
  return c;
}
function business(c) {
  let s = base.build("business", c).source;
  const start = s.indexOf('    await step("Normal native elevated Editor close"');
  const end = s.indexOf('    assert.equal(report.steps.length, 4);', start);
  assert(start > 0 && end > start);
  const close = `    await step("Programmatic native Editor close; physical input NOT_RUN", async () => {
      const launch = host.current;
      const label = await page.evaluate(() => window.__TAURI_INTERNALS__.metadata.currentWindow.label);
      assert.equal(typeof label, "string"); assert(label);
      report.stage = "WAIT_PROGRAMMATIC_NATIVE_EDITOR_CLOSE";
      report.nativeCloseInput = { method: "NATIVE_IPC_CLOSE", physicalInput: false,
        command: "plugin:window|close", label, ownerPid: launch.pid };
      save();
      let disconnect;
      try {
        await page.evaluate(label => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label }), label);
      } catch (error) {
        disconnect = String(error);
        assert(/closed|disconnected|Target page|Execution context was destroyed/i.test(disconnect), disconnect);
      }
      await until(() => !rows().some(p => p.ProcessId === launch.pid && p.Created === launch.created)
        && listeners(launch.ports).length === 0, "native IPC normal Editor/backend exit", 30000);
      await host.stop("Programmatic native close observed; no physical input claim");
      assert.deepEqual(report.cleanups.at(-1).killed, []);
      report.normalClose = { ...report.nativeCloseInput, observedHostAndPortsGone: true,
        response: "RESOLVED_OR_WINDOW_DISCONNECTED", ...(disconnect ? { disconnect } : {}) };
      return report.normalClose;
    });
`;
  s = s.slice(0, start) + close + s.slice(end);
  new vm.Script(Module.wrap(s)); return s;
}
function prepare(c, file) {
  // Base prepare seals the existing launcher/cache and all original source
  // identities. Finalize this new, never-run preparation before any launch.
  base.prepare(c, file);
  const target = path.join(c.preparation, "business.cjs");
  fs.writeFileSync(target, business(c));
  const bindingFile = path.join(c.preparation, "binding.json"), b = read(bindingFile);
  b.sources = b.sources.map(f => desc(f.path));
  b.sources.push(desc(__filename), desc(path.join(__dirname, "android-default-controlled-test.cjs")));
  b.inputBoundary = { directory: "CONTROLLED_ONCE", close: "NATIVE_IPC_CLOSE", physicalInput: false };
  fs.writeFileSync(bindingFile, JSON.stringify(b, null, 2));
  return { status: "PREPARED_NOT_PRODUCT_TESTED", binding: desc(bindingFile),
    preparation: c.preparation, productLaunches: 0, apkBuilds: 0 };
}
function terminal(c, v, artifactOnly) {
  assert.equal(artifactOnly, false, "This adapter requires successful native close, not artifact-only fallback");
  const { build: b, admin: a, origin: o, task: t, restored: r } = v;
  assert.equal(b.version, c.version); assert.equal(b.status, "PASS"); assert(b.finishedAt);
  assert.equal(b.currentNativeUI, true); assert.equal(b.builds, 1);
  assert.equal(b.featureStatus, "PASS"); assert.equal(b.sourceBuilderInvocation, false);
  assert.equal(b.productChanges, 0); assert.equal(b.modelRequests, 0); assert.deepEqual(b.errors, []);
  assert.equal(b.steps.length, 4); assert(b.steps.every(s => s.status === "PASS"));
  assert.equal(b.protectedUnchanged, true); assert.equal(b.cleanupError, undefined);
  validateSelection(b, path.join("F:/AgentVN/QA/Android-Package-20261021-01", `editor-${c.attempt}`));
  validateClose(b);
  assert.equal(o.originIsElevated, false); assert.equal(o.taskEngine, true);
  assert.equal(a.isElevated, true); assert.equal(a.taskEngine, true);
  assert.equal(a.originProcessId, o.originProcessId); assert.equal(a.userSid, o.userSid);
  assert(a.probe?.isElevated && a.probe.success); assert.equal(a.error, null); assert(a.finishedAt);
  assert.equal(a.policyRestoration, "PASS"); assert.equal(a.physicalProtectionRestoration, "PASS");
  assert.equal(a.status, "BUILD_PASS_DEVICE_PENDING"); assert.equal(a.exitCode, 0);
  assert.equal(t.status, "TERMINAL"); assert.equal(t.cleanup, "PASS"); assert(t.finishedAt);
  assert.equal(r.status, "PASS"); assert.equal(r.deletedUserFiles, 0);
  assert.equal(r.rows.length, 4); assert(r.rows.every(row => row.physicalTestCache === true));
}
function audit(c, file, number) {
  assert.match(number, /^\d{2}$/);
  const adapted = auditBase.adapt(c, file);
  let s = replace(adapted.source, 'assert.equal(build.normalUIExportStatus, "PASS_NATIVE_UI");',
    'assert.equal(build.normalUIExportStatus, "PASS_UI_CONTROLLED_DIRECTORY");');
  const start = s.indexOf("        const selected = build.nativeOutput;");
  const end = s.indexOf('        assert(build.cleanups.length === 1', start);
  assert(start > 0 && end > start);
  s = s.slice(0, start) + "        module.validateSelection(build, source);\n        module.validateClose(build);\n" + s.slice(end);
  s = replace(s, "Actual elevated host, manual native directory and Computer Use observation",
    "Actual elevated host, one controlled directory and programmatic native close; physical input NOT_RUN");
  new vm.Script(Module.wrap(s));
  const original = path.join(__dirname, "android-native-upgrade-package-audit.cjs");
  const validatorFile = path.join(__dirname, "lib/android-upgrade-package-evidence.cjs");
  const validator = new Module(validatorFile, module);
  validator.filename = validatorFile; validator.paths = module.paths;
  validator._compile(adapted.validator, validatorFile);
  const worker = new Module(original, module), originalRequire = worker.require.bind(worker);
  worker.filename = original; worker.paths = module.paths;
  worker.require = id => id === "./lib/android-upgrade-package-evidence.cjs" ? validator.exports : originalRequire(id);
  Object.assign(worker, { qaRun: true, validateSelection, validateClose,
    validateTerminal: (value, artifactOnly) => terminal(c, value, artifactOnly),
    snapshots: { ...adapted.snapshots, "executed-audit.cjs": s,
      "controlled-adapter.cjs": fs.readFileSync(__filename, "utf8") },
    candidateBinding: { config: desc(file), adapter: desc(__filename), editor: c.version,
      game: c.gameVersion, code: c.versionCode,
      inputBoundary: { directory: "CONTROLLED_ONCE", close: "NATIVE_IPC_CLOSE", physicalInput: false } } });
  process.argv = [process.argv[0], original, c.attempt, number, "--apk-terminal"];
  worker._compile(s, original);
}
module.exports = { validateSelection, validateClose, business, terminal };
if (require.main === module) {
  try {
    const [mode, file, number] = process.argv.slice(2), c = config(file);
    if (mode === "self-test") {
      business(c);
      console.log(JSON.stringify({ status: "PASS", exactBusinessSeam: true,
        physicalInput: "NOT_RUN", productLaunches: 0, apkBuilds: 0 }));
    } else if (mode === "prepare") console.log(JSON.stringify(prepare(c, file)));
    else { assert.equal(mode, "audit"); audit(c, file, number); }
  } catch (error) { console.error(error); process.exitCode = 1; }
}
