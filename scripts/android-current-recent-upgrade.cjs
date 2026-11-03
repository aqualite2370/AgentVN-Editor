"use strict";
// QA only. A real retained 1.9.34 export -> frozen 1.9.35 export.
// Original early-version/device reports remain unchanged; no APK is rebuilt.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), { execFileSync } = require("node:child_process");
const candidateFile = require.resolve("./android-candidate-device.cjs");
const candidate = require(candidateFile);
const { enrich } = require("./android-current-upgrade-capture.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { parseIdentity } = require("./lib/android-upgrade-package-evidence.cjs");
const root = "F:/AgentVN/QA/Android-Package-20261021-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file) });
const oldSha = "62dedf208b1abac52039e9f68394714f17b71749e71cd017c3ce1e6710ec801c";
function one(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, "Exact QA seam required: " + before);
  return source.replace(before, () => after);
}
function recentRunner(c) {
  let source = enrich(candidate.runnerSource(c));
  source = one(source, 'assert.equal(request.upgradePair.old.versionName, "0.1.0");',
    'assert.equal(request.upgradePair.old.versionName, "0.1.4");');
  source = one(source, 'assert.equal(request.upgradePair.old.versionCode, 1000);',
    'assert.equal(request.upgradePair.old.versionCode, 1004);');
  source = one(source, '"504ea034c14f393465b44160898516a7875d3031c65d108779ecb51897b5de5b"',
    JSON.stringify(oldSha));
  for (const n of [0, 1]) source = one(source, `.startsWith("QA_ANDROID_${n}：")`,
    `.startsWith("QA_ANDROID_UPGRADE_NEW_${n}：")`);
  source = one(source, '"Snapshot UI-created old saves; keep independently observed old exit failure"',
    '"Snapshot actual recent saves; old natural exit NOT_RUN, Home-resume route explicit"');
  const begin = source.indexOf('      const exitReport = read(path.join(path.dirname(path.dirname(out)),');
  const end = source.indexOf('      r.oldAutoCreation = baseline.some', begin);
  assert(begin > 0 && end > begin);
  source = source.slice(0, begin) +
    '      r.oldExitObservation = { status: "NOT_RUN", scope: "Recent 0.1.4 normal exit not exercised; no 0.1.0 finding transferred" };\n' +
    source.slice(end);
  source = one(source, '"Actual available old saves load old snapshots, next advance consumes new script"',
    '"Recent old snapshots load; current package bytes verified, authored text intentionally unchanged"');
  const verifyInstalled = label => `
      const installedPath = text(["shell", "pm", "path", pkg]).match(/^package:(\\/data\\/app\\/[^\\r\\n]+\\.apk)$/m)?.[1];
      assert(installedPath && !installedPath.includes(".."));
      const installedSha = text(["shell", "sha256sum", installedPath]).split(/\\s+/)[0];
      assert.equal(installedSha, q.${label === "old" ? "oldApk" : "apk"}.sha256);
      (r.installedPackageBytes ??= []).push({ label: "${label}", path: installedPath, sha256: installedSha });
`;
  source = one(source, 'preservationWindow = true; installed = true; assert.match(text(["install", staged[0]]), /Success/);',
    'preservationWindow = true; installed = true; assert.match(text(["install", staged[0]]), /Success/);' + verifyInstalled("old"));
  source = one(source, '      assert.match(text(["install", "-r", staged[1]]), /Success/);',
    '      assert.match(text(["install", "-r", staged[1]]), /Success/);' + verifyInstalled("current"));
  new vm.Script(Module.wrap(source)); return source;
}
function recentLaunch(start, runner) {
  let source = candidate.launchSource(start, runner);
  source = one(source, '"editor-10/report.json"', '"editor-32/report.json"');
  source = one(source, 'a.kind === "android_apk_signed"', 'a.kind === "android_apk"');
  source = one(source, '"Recent retained signed sample only; not the pre-save-mechanism old binary"',
    '"Actual 0.1.4 to 0.1.5; same authored lines, changed installed native/package bytes verified; no new-story claim"');
  new vm.Script(Module.wrap(source)); return source;
}
function adapter() {
  let source = fs.readFileSync(candidateFile, "utf8");
  source = one(source, '"executed-runner.cjs": runnerSource(c),',
    '"executed-runner.cjs": module.recentRunner(c),');
  source = one(source, '"executed-launch.cjs": launchSource(startFile, runnerFile)',
    '"executed-launch.cjs": module.recentLaunch(startFile, runnerFile)');
  source = one(source, 'sources: [...preserved(), desc(__filename), desc(configFile), desc(auditFile),',
    'sources: [...preserved(), desc(__filename), desc(module.recentFile), desc(module.captureFile), desc(configFile), desc(auditFile),');
  const worker = new Module(candidateFile, module);
  worker.filename = candidateFile; worker.paths = module.paths;
  Object.assign(worker, { recentRunner, recentLaunch, recentFile: __filename,
    captureFile: require.resolve("./android-current-upgrade-capture.cjs") });
  worker._compile(source, candidateFile); return worker.exports;
}
async function audit(configFile, number) {
  assert.match(number, /^\d{2}$/);
  const c = read(configFile), out = path.join(root, `native-upgrade-audit-${c.attempt}-${number}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], sources: [desc(__filename)],
    scope: "REAL_RECENT_SIGNED_PAIR_ONLY_NOT_DEVICE_OR_OLD_EDITOR_CLOSE_ACCEPTANCE",
    apkBuilds: 0, deviceOperations: 0, modelRequests: 0 };
  const load = file => { r.sources.push(desc(file)); return read(file); };
  const check = async (name, fn) => {
    const row = { name, status: "RUNNING" }; r.checks.push(row);
    try { row.evidence = await fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  };
  try {
    const currentAudit = path.join(root, `native-upgrade-audit-${c.attempt}-02/report.json`);
    candidate.auditCandidate(c, configFile, currentAudit);
    const current = load(currentAudit), old = load(path.join(root, "native-upgrade-audit-32-03/report.json"));
    assert.equal(old.status, "APK_ARTIFACT_PAIR_PASS_EDITOR_CLOSE_FAILED_DEVICE_NOT_RUN");
    assert(old.checks.length >= 5 && old.checks.every(x => x.status === "PASS"));
    const pair = [old.upgradePair.currentApk, current.upgradePair.currentApk];
    assert.equal(pair[0].sha256, oldSha);
    await check("Actual retained signed package pair, same signer and increasing version", async () => {
      const tools = "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain";
      const java = path.join(tools, "jdk-17/bin/java.exe");
      const jar = path.join(tools, "Sdk/build-tools/35.0.0/lib/apksigner.jar");
      const aapt = path.join(tools, "Sdk/build-tools/35.0.0/aapt2.exe");
      r.sources.push(...[java, jar, aapt].map(desc));
      const identities = pair.map((apk, n) => {
        assert.equal(sha(apk.path), apk.sha256); r.sources.push(desc(apk.path));
        const run = (exe, args, label) => {
          const text = execFileSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
          const file = path.join(out, `${n}-${label}.log`);
          fs.writeFileSync(file, text, { flag: "wx" }); r.sources.push(desc(file)); return text;
        };
        return parseIdentity(run(java, ["-jar", jar, "verify", "--verbose", "--print-certs", apk.path], "signature"),
          run(aapt, ["dump", "badging", apk.path], "badging"));
      });
      assert.deepEqual(identities[0], old.upgradePair.current);
      assert.deepEqual(identities[1], current.upgradePair.current);
      assert.equal(identities[0].signerSha256, identities[1].signerSha256);
      assert(identities[0].versionCode < identities[1].versionCode);
      r.upgradePair = { old: identities[0], current: identities[1], currentApk: pair[1] };
      return identities;
    });
    await check("Actual project, cartridge and native-byte differences; equal story bytes disclosed", async () => {
      const JSZip = require("../editor/node_modules/jszip");
      const hash = b => require("node:crypto").createHash("sha256").update(b).digest("hex");
      const builds = [32, c.attempt].map(n => load(path.join(root, `editor-${n}/report.json`)));
      const scripts = builds.map(b => { assert.equal(sha(b.cartridge.path), b.cartridge.sha256);
        assert.equal(sha(b.input.path), b.input.sha256); return b.cartridge.scriptSha256; });
      assert.equal(builds[0].version, "1.9.34"); assert.equal(builds[1].version, c.version);
      assert.equal(scripts[0], scripts[1]);
      const zips = await Promise.all(pair.map(p => JSZip.loadAsync(fs.readFileSync(p.path), { checkCRC32: true })));
      const names = ["lib/x86_64/libagentvn_player_lib.so", "assets/embedded-cartridge/manifest.json"];
      const changed = [];
      for (const name of names) {
        const bytes = await Promise.all(zips.map(z => { assert(z.file(name)); return z.file(name).async("nodebuffer"); }));
        assert(!bytes[0].equals(bytes[1])); changed.push({ name, old: hash(bytes[0]), current: hash(bytes[1]) });
      }
      r.authoredTextChanged = false; return { identicalScriptSha256: scripts[0], changed };
    });
    r.candidateBinding = { ...current.candidateBinding, adapter: desc(__filename) };
    r.publishingWorkflow = current.publishingWorkflow;
    r.limitations = ["Retained 1.9.34 Editor normal close FAILED remains unchanged",
      "Package signature/bytes only here; actual installation and data preservation NOT_RUN",
      "Same authored text; no invented new-content acceptance"];
    r.status = "APK_UPGRADE_PAIR_PASS_DEVICE_NOT_RUN";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: r.status, out, checks: r.checks, error: r.error }, null, 2));
}
function selfTest(configFile) {
  const c = read(configFile), source = recentRunner(c);
  const worker = new Module(candidateFile, module); worker.filename = candidateFile; worker.paths = module.paths;
  worker._compile(source, candidateFile);
  const oldRequest = read(path.join(root, "device-upgrade-34-02/request-submitted.json"));
  assert.throws(() => worker.exports.validateRequest(oldRequest));
  assert(source.includes('assert.equal(installedSha, q.apk.sha256)'));
  assert(source.includes('assert.deepEqual(after.map'));
  assert(source.includes('assert.deepEqual(await settings(), pref)'));
  assert(source.includes('assertPreservedUpgradeData(args, preservationWindow, cleanup)'));
  assert(source.includes('r.evidenceGaps?.length ? "BLOCKED_NONZERO_EXIT" : "PASS"'));
  recentLaunch("F:/unused/start.ps1", "F:/unused/runner.cjs");
  console.log(JSON.stringify({ status: "PASS", historicalPairRejected: true,
    installedBytesChecked: true, preservationAssertionsRetained: true,
    deviceOperations: 0, builds: 0, productChanges: 0 }));
}
if (require.main === module) {
  const [mode, configFile, auditNumber, deviceNumber] = process.argv.slice(2);
  if (mode === "self-test") selfTest(configFile);
  else if (mode === "audit") audit(configFile, auditNumber).catch(e => { console.error(e); process.exitCode = 1; });
  else { assert.equal(mode, "prepare");
    console.log(JSON.stringify(adapter().prepare(configFile, auditNumber, deviceNumber))); }
}
