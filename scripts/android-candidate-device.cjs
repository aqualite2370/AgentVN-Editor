"use strict";
// QA only. Bind the preserved real-touch/install-r/finally workflow to an audited
// candidate; historical runners and their FAILED reports remain immutable.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), vm = require("node:vm"), Module = require("node:module");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateConfig } = require("./installed-editor-android-candidate.cjs");
const { ps } = require("./lib/current-native-editor-session.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const qa = "F:/AgentVN/QA/Android-Package-20261021-01";
const originals = [
  ["android-native-upgrade-device.cjs", "d62dcab26fae9c13a8bee4134fb51df5d0365bb6f96ec1433a9f39d7d3b1a953"],
  ["android-native-upgrade-device-launch.cjs", "7a2b47e62a8c96240e3d9b1b23daca4728f56390b0cb66dfaee968d57a1f19fd"],
  ["start-android-acceptance.ps1", "f41e5bb022c394435336130d95f42fe4cec818e2c36484c8697e78912c750c0e"],
];
function desc(file) { return { path: path.resolve(file), sha256: sha(file) }; }
function preserved() {
  return originals.map(([name, digest]) => {
    const file = path.join(__dirname, name); assert.equal(sha(file), digest, name); return desc(file);
  });
}
function replace(source, before, after, count = 1) {
  assert.equal(source.split(before).length - 1, count, before);
  return source.split(before).join(after);
}
function version(c) {
  assert.match(c.gameVersion, /^\d+\.\d+\.\d+$/);
  const parts = c.gameVersion.split(".").map(Number);
  assert(parts[1] < 1000 && parts[2] < 1000);
  assert(Number.isSafeInteger(c.versionCode) && c.versionCode > 1000);
  assert.equal(c.versionCode, parts[0] * 1000000 + parts[1] * 1000 + parts[2]);
}
function runnerSource(c) {
  preserved(); version(c);
  let source = fs.readFileSync(path.join(__dirname, originals[0][0]), "utf8");
  source = replace(source, '"0.1.1"', JSON.stringify(c.gameVersion));
  source = replace(source, "1001", String(c.versionCode), 2);
  source = replace(source, String.raw`0\.1\.1`, c.gameVersion.replaceAll(".", String.raw`\.`));
  source = replace(source, "if (require.main === module)", "if (module.qaRun)");
  source += "\nmodule.exports.run = main;\n";
  // Read-only instrumentation records whether the actual ADB touches reached
  // controls. It neither dispatches DOM events nor changes Runtime state.
  const observation = `(() => {
    if (window.__avnUpgradeInputLog) return;
    window.__avnUpgradeInputLog = [];
    for (const type of ["pointerdown", "pointerup", "click"]) {
      document.addEventListener(type, event => {
        const e = event.target, b = e?.closest?.("button");
        window.__avnUpgradeInputLog.push({ type, trusted: event.isTrusted, at: performance.now(),
          x: event.clientX, y: event.clientY, tag: e?.tagName,
          button: b?.getAttribute("aria-label") || b?.textContent,
          disabled: b?.disabled, inert: Boolean(b?.closest("[inert]")) });
        if (window.__avnUpgradeInputLog.length > 120) window.__avnUpgradeInputLog.shift();
      }, true);
    }
    return true;
  })()`;
  source = replace(source, "    await idle();\n    const hit = await wait(",
    `    await idle();\n    await client.evaluate(${JSON.stringify(observation)});\n    const hit = await wait(`);
  source = replace(source, "    // Observe actual render turns, not a fixed delay that may inspect the old idle page.",
    '    r.inputObservations ??= [];\n' +
    '    r.inputObservations.push({label, at:new Date().toISOString(), events:await client.evaluate("window.__avnUpgradeInputLog")});\n' +
    "    // Observe actual render turns, not a fixed delay that may inspect the old idle page.");
  source = replace(source, "  const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));",
    "  r.candidateBinding = module.candidateBinding;\n" +
    "  const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));");
  new vm.Script(Module.wrap(source)); return source;
}
function loadRunner(c, binding, source = runnerSource(c)) {
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  worker.candidateBinding = binding; worker.qaRun = false;
  worker._compile(source, __filename); return worker.exports;
}
function auditCandidate(c, configFile, auditFile) {
  const audit = read(auditFile);
  assert(["APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN",
    "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN"].includes(audit.status),
  "A completed actual APK artifact audit is required; prebuild evidence cannot launch a device");
  const binding = audit.candidateBinding;
  assert(binding, "Current candidate audit binding required");
  assert.equal(path.resolve(binding.config.path), path.resolve(configFile));
  assert.equal(binding.config.sha256, sha(configFile));
  assert.equal(binding.editor, c.version); assert.equal(binding.game, c.gameVersion);
  assert.equal(binding.code, c.versionCode);
  assert.equal(audit.upgradePair.current.versionName, c.gameVersion);
  assert.equal(audit.upgradePair.current.versionCode, c.versionCode);
  assert(audit.upgradePair.current.versionCode > audit.upgradePair.old.versionCode);
  assert.equal(sha(audit.upgradePair.currentApk.path), audit.upgradePair.currentApk.sha256);
  return audit;
}
function launchSource(startFile, runnerFile) {
  let source = fs.readFileSync(path.join(__dirname, originals[1][0]), "utf8");
  source = replace(source,
    'const { validateRequest } = require("./android-native-upgrade-device.cjs");',
    "const { validateRequest } = module.runner;");
  source = replace(source, 'path.join(__dirname, "start-android-acceptance.ps1")',
    JSON.stringify(startFile), 2);
  source = replace(source, "const request = { runId:", "const request = { candidateBinding: module.candidateBinding, runId:");
  source = replace(source, "    r.tools = tools.map(file => {",
    `    tools.push(${JSON.stringify(runnerFile)}, module.launchFile,\n` +
    '      path.join(__dirname, "start-android-acceptance.ps1"),\n' +
    '      path.join(__dirname, "android-native-upgrade-device-launch.cjs"));\n' +
    "    r.tools = tools.map(file => {");
  source = replace(source, "if (require.main === module)", "if (module.qaRun)");
  new vm.Script(Module.wrap(source)); return source;
}
function startSource(startFile, runnerFile) {
  let source = fs.readFileSync(path.join(__dirname, originals[2][0]), "utf8");
  source = replace(source, "(Join-Path $PSScriptRoot 'android-native-upgrade-device.cjs')",
    "'" + runnerFile.replaceAll("/", "\\") + "'");
  source = source.replaceAll("$PSCommandPath", "'" + startFile.replaceAll("/", "\\") + "'")
    .replaceAll("$PSScriptRoot", "'" + __dirname.replaceAll("/", "\\") + "'");
  // Validate the binding before RunAs and before the original cold-boot helper.
  source = replace(source, "$ErrorActionPreference = 'Stop'",
    "$ErrorActionPreference = 'Stop'\n" +
    `& node '${runnerFile.replaceAll("/", "\\")}' --validate $RequestPath\n` +
    "if ($LASTEXITCODE -ne 0) { throw 'CANDIDATE_BINDING_INVALID' }");
  return source;
}
function validateStartSyntax(source) {
  const encoded = Buffer.from(source).toString("base64");
  assert.equal(ps("$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + encoded + "'));" +
    "$tokens=$null;$errors=$null;" +
    "$null=[Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$errors);" +
    "if($errors.Count){throw ($errors|Out-String)};'PASS'"), "PASS");
}
function validateBinding(bindingFile, expectedSha) {
  assert.equal(sha(bindingFile), expectedSha, "Prepared candidate binding changed");
  const b = read(bindingFile);
  for (const source of b.sources) assert.equal(sha(source.path), source.sha256, source.path);
  const c = read(b.config.path); validateConfig(c);
  auditCandidate(c, b.config.path, b.audit.path);
  assert.equal(c.attempt, b.attempt); return { b, c };
}
function boundRunner(bindingFile, expectedSha) {
  const { b, c } = validateBinding(bindingFile, expectedSha);
  const receipt = { path: path.resolve(bindingFile), sha256: expectedSha };
  const runner = loadRunner(c, receipt, fs.readFileSync(b.runnerSource, "utf8"));
  const validateRequest = request => {
    assert.deepEqual(request.candidateBinding, receipt, "Request belongs to a different candidate");
    assert.equal(request.packageAudit.path, b.audit.path);
    assert.equal(request.packageAudit.sha256, b.audit.sha256);
    assert.equal(request.upgradePair.current.packageName, request.package);
    assert.equal(request.upgradePair.old.packageName, request.package);
    runner.validateRequest(request);
  };
  return { b, c, receipt, runner, validateRequest };
}
async function runPrepared(bindingFile, expectedSha, args) {
  const bound = boundRunner(bindingFile, expectedSha);
  const validateOnly = args[0] === "--validate";
  assert.equal(args.length, validateOnly ? 2 : 1);
  const request = read(args[validateOnly ? 1 : 0]); bound.validateRequest(request);
  if (validateOnly) return;
  return bound.runner.run(args[0]);
}
function launchPrepared(bindingFile, expectedSha, args) {
  const bound = boundRunner(bindingFile, expectedSha);
  assert.deepEqual(args, [bound.c.attempt, bound.b.auditAttempt, bound.b.deviceAttempt, "--background-auto"]);
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths; worker.qaRun = true;
  worker.runner = { validateRequest: bound.validateRequest };
  worker.candidateBinding = bound.receipt; worker.launchFile = bound.b.launchFile;
  worker._compile(fs.readFileSync(bound.b.launchSource, "utf8"), __filename);
}
function prepare(configFile, auditAttempt, deviceAttempt) {
  const c = read(configFile); preserved(); validateConfig(c);
  for (const value of [auditAttempt, deviceAttempt]) assert.match(value, /^\d{2}$/);
  const auditFile = path.join(qa, `native-upgrade-audit-${c.attempt}-${auditAttempt}`, "report.json");
  auditCandidate(c, configFile, auditFile); // Fail before making directories or launching anything.
  const out = path.join(path.dirname(configFile), `android-device-${c.attempt}-${deviceAttempt}`);
  const deviceOut = path.join(qa, `device-upgrade-${c.attempt}-${deviceAttempt}`);
  assert(!fs.existsSync(out) && !fs.existsSync(deviceOut), "Never reuse an existing device attempt");
  const runnerFile = path.join(out, "runner.cjs"), startFile = path.join(out, "start.ps1");
  const launchFile = path.join(out, "launch.cjs"), bindingFile = path.join(out, "binding.json");
  const files = { "executed-runner.cjs": runnerSource(c), "start.ps1": startSource(startFile, runnerFile),
    "executed-launch.cjs": launchSource(startFile, runnerFile) };
  validateStartSyntax(files["start.ps1"]);
  fs.mkdirSync(out);
  for (const [name, text] of Object.entries(files))
    fs.writeFileSync(path.join(out, name), text, { flag: "wx" });
  const binding = { attempt: c.attempt, auditAttempt, deviceAttempt, config: desc(configFile), audit: desc(auditFile),
    runnerSource: path.join(out, "executed-runner.cjs"), launchSource: path.join(out, "executed-launch.cjs"),
    launchFile, sources: [...preserved(), desc(__filename), desc(configFile), desc(auditFile),
      ...Object.keys(files).map(name => desc(path.join(out, name)))] };
  fs.writeFileSync(bindingFile, JSON.stringify(binding, null, 2), { flag: "wx" });
  const call = method => `require(${JSON.stringify(__filename)}).${method}(${JSON.stringify(bindingFile)},` +
    `${JSON.stringify(sha(bindingFile))},process.argv.slice(2))`;
  for (const [file, method] of [[runnerFile, "runPrepared"], [launchFile, "launchPrepared"]])
    fs.writeFileSync(file, `Promise.resolve().then(()=>${call(method)}).catch(e=>{console.error(e);process.exitCode=1});\n`, { flag: "wx" });
  return { status: "PREPARED_NOT_LAUNCHED", binding: desc(bindingFile), launchFile,
    args: [c.attempt, auditAttempt, deviceAttempt, "--background-auto"], deviceOperations: 0 };
}
module.exports = { runnerSource, loadRunner, auditCandidate, launchSource, startSource, validateStartSyntax,
  runPrepared, launchPrepared, prepare };
if (require.main === module) {
  const [mode, config, audit, device] = process.argv.slice(2);
  assert.equal(mode, "prepare", "Use prepare CONFIG AUDIT_ATTEMPT DEVICE_ATTEMPT");
  console.log(JSON.stringify(prepare(config, audit, device), null, 2));
}
