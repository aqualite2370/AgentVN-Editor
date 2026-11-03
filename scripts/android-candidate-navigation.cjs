"use strict";
// QA only: retain the actual-touch navigation flow and Activity recreation
// checks, binding them to an explicitly audited installed candidate.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), { execFileSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { allocateAndroidDevicePorts } = require("./lib/android-device-ports.cjs");
const { validateConfig } = require("./installed-editor-android-candidate.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const root = path.resolve("F:/AgentVN/QA/Android-Package-20261021-01");
const historical = path.join(__dirname, "candidate-1924-android-navigation.cjs");
const historicalSha = "087487b0f3ca897b23f668114d87decfa7591659ca05d690909c732ad03361b8";
const replace = (s, a, b, count = 1) => {
  assert.equal(s.split(a).length - 1, count, a); return s.split(a).join(b);
};
function validateCandidate(configFile, auditFile) {
  const c = read(configFile); validateConfig(c);
  const a = require("./android-candidate-device.cjs").auditCandidate(c, configFile, auditFile);
  assert.equal(a.status, "APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN",
    "This flow requires completed normal Editor close and administrator restoration");
  assert(a.checks.length >= 5 && a.checks.every(row => row.status === "PASS"));
  return { c, a };
}
function runnerSource(c, audit, input = fs.readFileSync(historical, "utf8")) {
  assert.equal(sha(historical), historicalSha, "Historical workflow drift");
  assert.equal(require("node:crypto").createHash("sha256").update(input).digest("hex"), historicalSha);
  let wrapper = replace(input, "device-navigation-17-", `device-navigation-${c.attempt}-`, 2);
  wrapper = replace(wrapper, "e4493327d8fdcc48440cb75aa6adff4a9a0720b59de3207f1f2aa0d304115c8e",
    audit.upgradePair.currentApk.sha256);
  wrapper = replace(wrapper, "source = adapt(input);", "source = module.capture(adapt(input));");
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  let generated;
  worker.capture = source => {
    source = replace(source, '  assert.equal(q.sdk, "D:\\\\Android_dev\\\\Sdk");',
      '  assert.equal(q.sdk, "D:\\\\Android_dev\\\\Sdk");\n' +
      '  assert.equal(q.coldBoot.avdHome, "D:\\\\Android_dev\\\\avd");\n' +
      '  assert.equal(q.coldBoot.discoveryRoot, "C:\\\\Users\\\\1\\\\AppData\\\\Local\\\\Temp\\\\avd\\\\running");\n' +
      '  assert.equal(q.coldBoot.mediaVolumeTarget, 13);');
    source = replace(source, '"APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN"',
      '"APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN"');
    source = replace(source, '  assert.equal(audit.publishingWorkflow.normalCloseStatus, "FAILED");',
      '  assert(audit.checks.some(row => row.name.startsWith("Terminal single native UI build and normal close") && row.status === "PASS"));');
    source = replace(source, '  const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));',
      '  r.candidateBinding = q.candidateBinding;\n  const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));');
    // Every screenshot gets actual provider, memory, DOM and image evidence.
    // These are observations; they neither change store nor synthesize input.
    source = replace(source, "    const before = await client.evaluate(expression);",
      `    const diagnostics = {
      webview: text(["shell", "dumpsys", "webviewupdate"]),
      processes: text(["shell", "ps", "-A", "-o", "PID,PPID,NAME,ARGS"]),
      meminfo: text(["shell", "dumpsys", "meminfo", pkg]),
      domCounters: await client.call("Memory.getDOMCounters"),
      images: await client.evaluate(\`[...document.images].map(e=>({src:e.currentSrc,complete:e.complete,
        naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight,rect:e.getBoundingClientRect().toJSON()}))\`),
      page: await client.evaluate(\`({title:document.title,text:document.body.innerText,
        width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
        scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,
        controls:[...document.querySelectorAll("button")].filter(e=>!e.closest("[inert]")).map(e=>{
          const b=e.getBoundingClientRect(),s=getComputedStyle(e),x=b.x+b.width/2,y=b.y+b.height/2,t=document.elementFromPoint(x,y);
          return {label:e.innerText,disabled:e.disabled,display:s.display,visibility:s.visibility,
            opacity:s.opacity,rect:b.toJSON(),hit:e===t||e.contains(t)};
        })})\`),
    };
    diagnostics.pssKb = Number(diagnostics.meminfo.match(/TOTAL PSS:\\s+(\\d+)/)?.[1]);
    assert(Number.isFinite(diagnostics.pssKb) && diagnostics.pssKb > 0);
    const diagnosticsFile = path.join(out, label + "-diagnostics.json");
    fs.writeFileSync(diagnosticsFile, JSON.stringify(diagnostics, null, 2), {flag:"wx"});
    (r.diagnostics ??= []).push({label,...fileEvidence(diagnosticsFile)});
    const before = await client.evaluate(expression);`);
    // A cached Runtime failing to become ready needs native pixels and actual
    // target/DOM evidence before uninstall, without a title-ready precondition.
    source = replace(source, "    client?.close(); const errors = [];",
      `    if (r.status === "FAILED" && installed) {
      r.failureDiagnostics = {};
      for (const [name,args,binary] of [
        ["activity",["shell","dumpsys","activity","activities"],false],
        ["provider",["shell","dumpsys","webviewupdate"],false],
        ["processes",["shell","ps","-A","-o","PID,PPID,NAME,ARGS"],false],
        ["native",["exec-out","screencap","-p"],true]]) {
        try {
          const file=path.join(out,"failure-raw-"+name+(binary?".png":".txt"));
          const value=cmd(args,binary);assert.equal(value.status,0);
          fs.writeFileSync(file,value.stdout,{flag:"wx"});r.failureDiagnostics[name]=fileEvidence(file);
        } catch(e) {r.failureDiagnostics[name]={error:String(e)};}
      }
      try {
        const targets=await (await fetch("http://127.0.0.1:"+q.cdpPort+"/json/list",
          {signal:AbortSignal.timeout(1500)})).json();
        const file=path.join(out,"failure-raw-targets.json");
        fs.writeFileSync(file,JSON.stringify(targets,null,2),{flag:"wx"});
        r.failureDiagnostics.targets=fileEvidence(file);
      }catch(e){r.failureDiagnostics.targets={error:String(e)};}
      try{
        const files=text(["shell","find","/data/user/0/"+pkg,"-type","f","-name","player-desktop.log"]).split(/\\r?\\n/).filter(Boolean);
        assert.equal(files.length,1);assert(files[0].startsWith("/data/user/0/"+pkg+"/")&&!files[0].includes(".."));
        const file=path.join(out,"failure-player.log");
        fs.writeFileSync(file,cmd(["exec-out","cat",files[0]],true).stdout,{flag:"wx"});
        r.failureDiagnostics.player=fileEvidence(file);
      }catch(e){r.failureDiagnostics.player={error:String(e)};}
    }
    client?.close(); const errors = [];`);
    source += "\nmodule.exports.run = main;\n";
    new vm.Script(Module.wrap(source)); generated = source; return source;
  };
  worker._compile(wrapper, __filename);
  assert(generated); return generated;
}
function loadRunner(source) {
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths; worker.qaRun = false;
  worker._compile(source, __filename); return worker.exports;
}
function startSource(startFile, runnerFile) {
  const scriptRoot = __dirname.replaceAll("/", "\\").replaceAll("'", "''");
  return replace(require("./android-candidate-device.cjs").startSource(startFile, runnerFile),
    `(Join-Path '${scriptRoot}' 'android-current-navigation.cjs')`,
    "'" + runnerFile.replaceAll("/", "\\").replaceAll("'", "''") + "'");
}
function bound(bindingFile, expectedSha) {
  assert.equal(sha(bindingFile), expectedSha, "Binding changed");
  const b = read(bindingFile);
  for (const f of b.sources) assert.equal(sha(f.path), f.sha256, f.path);
  validateCandidate(b.config.path, b.audit.path);
  const runner = loadRunner(fs.readFileSync(b.source.path, "utf8"));
  const receipt = { path: path.resolve(bindingFile), sha256: expectedSha };
  function validate(q) {
    assert.deepEqual(q.candidateBinding, receipt);
    assert.equal(path.resolve(q.outputDir), path.join(b.output, "runtime"));
    assert.deepEqual(q.apk, read(b.audit.path).upgradePair.currentApk);
    assert.equal(q.packageAudit.path, b.audit.path);
    assert.equal(q.packageAudit.sha256, b.audit.sha256);
    runner.validateNavigationRequest(q);
  }
  return { b, runner, receipt, validate };
}
async function runPrepared(bindingFile, expectedSha, args) {
  const v = bound(bindingFile, expectedSha), only = args[0] === "--validate";
  assert.equal(args.length, only ? 2 : 1);
  const file = args[only ? 1 : 0]; v.validate(read(file));
  if (!only) await v.runner.run(file);
}
async function launchPrepared(bindingFile, expectedSha, args) {
  assert.deepEqual(args, []);
  const v = bound(bindingFile, expectedSha), { b } = v;
  assert(!fs.existsSync(b.output)); fs.mkdirSync(b.output);
  const reportFile = path.join(b.output, "report.json");
  const r = { status: "RUNNING", scope: "ACTUAL_INSTALLED_CANDIDATE_AGENTVN_NAVIGATION_AND_CACHED_ACTIVITY_REOPEN",
    startedAt: new Date().toISOString(), candidateBinding: v.receipt,
    productChanges: 0, buildInvocations: 0, modelRequests: 0 };
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
  try {
    const [adbPort, cdpPort, bootPort, grpcPort] = await allocateAndroidDevicePorts();
    const a = read(b.audit.path);
    const q = { scope: "installed-current-navigation", package: a.upgradePair.current.packageName,
      apk: a.upgradePair.currentApk, packageAudit: b.audit, sdk: "D:\\Android_dev\\Sdk", serial: "emulator-5554",
      runId: b.runId, candidateBinding: v.receipt, outputDir: path.join(b.output, "runtime"), adbPort, cdpPort,
      coldBoot: { avd: "AgentVN_API35", avdHome: "D:\\Android_dev\\avd", adbPort: bootPort, grpcPort,
        discoveryRoot: "C:\\Users\\1\\AppData\\Local\\Temp\\avd\\running", mediaVolumeTarget: 13 } };
    v.validate(q);
    const requestFile = path.join(b.output, "request.json");
    fs.writeFileSync(requestFile, JSON.stringify(q, null, 2), { flag: "wx" });
    fs.copyFileSync(requestFile, path.join(b.output, "request-submitted.json"), fs.constants.COPYFILE_EXCL);
    save();
    r.launchOutput = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      b.startFile, "-RequestPath", requestFile], { encoding: "utf8", windowsHide: true, timeout: 120000 });
    save();
    const until = Date.now() + 20 * 60000, launchFile = path.join(q.outputDir, "acceptance-launch.json");
    while (Date.now() < until) {
      if (fs.existsSync(launchFile)) {
        let launch; try { launch = read(launchFile); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
        if (launch?.finishedAt) { r.launch = { ...fileEvidence(launchFile), value: launch }; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    assert(r.launch, "Inspect the same owner; never start another attempt on timeout");
    assert.equal(r.launch.value.emulatorCleanupStatus, "PASS");
    const runtimeFile = path.join(q.outputDir, "navigation-report.json");
    assert(fs.existsSync(runtimeFile), "Native launcher did not reach the Runtime");
    const runtime = read(runtimeFile); r.runtime = fileEvidence(runtimeFile);
    for (const key of ["uninstallStatus", "apkCleanupStatus", "adbCleanupStatus"]) assert.equal(runtime[key], "PASS");
    assert.equal(runtime.cleanupError, null);
    r.status = runtime.status; r.cases = runtime.cases.map(({ name, status, error }) => ({ name, status, error }));
    if (r.status === "FAILED") process.exitCode = 1;
    bound(bindingFile, expectedSha);
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.limitations = ["AgentVN three-line asset-free fixture, not Ren'Py/NVL/bubble/resource or audio acceptance",
    "Diagnostics are new evidence; the earlier upgrade report and warning BLOCKED remain unchanged",
    "API35 emulator physical 2400x1080, not the desktop DPR matrix or a physical phone"];
  r.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify(r, null, 2));
}
function prepare(configFile, auditAttempt, navigationAttempt) {
  const c = read(configFile);
  for (const n of [auditAttempt, navigationAttempt]) assert.match(n, /^\d{2}$/);
  const auditFile = path.join(root, `native-upgrade-audit-${c.attempt}-${auditAttempt}`, "report.json");
  const { a } = validateCandidate(configFile, auditFile);
  const out = path.resolve(path.dirname(configFile), `android-navigation-${c.attempt}-${navigationAttempt}`);
  const output = path.join(root, `device-navigation-${c.attempt}-${navigationAttempt}`);
  assert(!fs.existsSync(out) && !fs.existsSync(output));
  const runnerFile = path.join(out, "runner.cjs"), startFile = path.join(out, "start.ps1");
  const source = runnerSource(c, a), start = startSource(startFile, runnerFile);
  require("./android-candidate-device.cjs").validateStartSyntax(start);
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, "executed-runner.cjs"), source, { flag: "wx" });
  fs.writeFileSync(startFile, start, { flag: "wx" });
  const b = { config: fileEvidence(configFile), audit: fileEvidence(auditFile), output,
    runId: `android-navigation-${c.attempt}-${navigationAttempt}`,
    startFile, source: fileEvidence(path.join(out, "executed-runner.cjs")),
    sources: [__filename, historical, path.join(__dirname, "android-current-navigation.cjs"),
      path.join(__dirname, "android-candidate-device.cjs"), path.join(__dirname, "start-android-acceptance.ps1"),
      path.join(__dirname, "android-cold-boot.ps1"), path.join(__dirname, "android-acceptance-preflight.ps1"),
      path.join(__dirname, "lib/current-android-navigation-exit.cjs"), path.join(__dirname, "android-exit-device.cjs"),
      path.join(__dirname, "lib/android-activity-exit.cjs"), path.join(__dirname, "lib/android-adb-root-recovery.cjs"),
      path.join(__dirname, "android-runtime-log-analysis.cjs"), path.join(__dirname, "visible-control-geometry.cjs"),
      configFile, auditFile, path.join(out, "executed-runner.cjs"), startFile].map(fileEvidence) };
  const bindingFile = path.join(out, "binding.json");
  fs.writeFileSync(bindingFile, JSON.stringify(b, null, 2), { flag: "wx" });
  for (const [name, method] of [["runner.cjs", "runPrepared"], ["launch.cjs", "launchPrepared"]]) {
    const call = `require(${JSON.stringify(__filename)}).${method}(${JSON.stringify(bindingFile)},` +
      `${JSON.stringify(sha(bindingFile))},process.argv.slice(2))`;
    fs.writeFileSync(path.join(out, name),
      `Promise.resolve().then(()=>${call}).catch(e=>{console.error(e);process.exitCode=1});\n`, { flag: "wx" });
  }
  return { status: "PREPARED_NOT_LAUNCHED", binding: fileEvidence(bindingFile), launchFile: path.join(out, "launch.cjs") };
}
module.exports = { validateCandidate, runnerSource, loadRunner, startSource, prepare, runPrepared, launchPrepared };
if (require.main === module) {
  assert.equal(process.argv[2], "prepare");
  console.log(JSON.stringify(prepare(...process.argv.slice(3)), null, 2));
}
