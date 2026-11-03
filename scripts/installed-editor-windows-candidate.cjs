"use strict";
// Reuse the established native publishing workflow with an explicit actual
// installation receipt. No source builder or fabricated installer provenance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { ps } = require("./lib/current-native-editor-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const original = path.join(__dirname, "installed-windows-native-ui-current.cjs");
const originalSHA = "14114bdbee4c6373f69c2c0ae934c0a4ee402238fb42a002490dd03ecee75c08";
const [action, configFile, attempt] = process.argv.slice(2);
assert(["prepare", "run"].includes(action)); assert(configFile); assert.match(attempt || "", /^\d{2}$/);
const c = read(configFile), actual = read(c.actualInstallation.path);
assert.match(c.version, /^\d+\.\d+\.\d+$/);
assert.equal(sha(c.actualInstallation.path), c.actualInstallation.sha256);
assert.equal(actual.status, "PASS"); assert.equal(actual.exitCode, 0); assert.equal(actual.registryRestored, true);
assert.equal(sha(actual.installer.path), c.installerSHA256);
assert.equal(actual.installer.sha256, c.installerSHA256);
assert.equal(sha(actual.executable.path), actual.executable.sha256);
assert.equal(ps(`(Get-Item -LiteralPath '${actual.executable.path.replaceAll("'", "''")}').VersionInfo.ProductVersion`), c.version);
const prep = path.join(path.dirname(configFile), `windows-preparation-${attempt}`);
const receipt = path.join(prep, "installation.json"), generated = path.join(prep, "run.cjs");
assert.equal(sha(original), originalSHA);
const sealed = { status: "PASS", version: c.version, metadataRestoration: "PASS",
  scope: "Derived actual NSIS installation identity; not a new installation or clean-machine acceptance",
  actualInstallation: c.actualInstallation, installRoot: actual.installRoot,
  executable: actual.executable,
  resources: ["creator-backend.exe", "agentvn-player.exe", "build-versions.json"]
    .map(n => describe(path.join(actual.installRoot, n))),
  protectedFiles: [describe(c.actualInstallation.path), actual.installer, actual.executable,
    ...(c.protectedFiles || [])] };
for (const f of [...sealed.resources, ...sealed.protectedFiles]) assert.equal(sha(f.path), f.sha256);
function adapt(input) {
  let code = input;
  const one = (before, after) => {
    assert.equal(code.split(before).length - 1, 1, before);
    code = code.replace(before, () => after);
  };
  one('"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"', JSON.stringify(receipt));
  one('assert.equal(sealed.version,"1.9.22")', `assert.equal(sealed.version,${JSON.stringify(c.version)})`);
  one('ACTUAL_INSTALLED_1_9_22_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD',
    `ACTUAL_INSTALLED_${c.version.replaceAll(".", "_")}_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD`);
  one(',"-CodexCacheView"]', "]");
  // Keep the environment cache physical. Only the package build cache is
  // protected and redirected; default-path environment evidence is separate.
  one('  cache("installed-layout-cache-session.ps1","SelfTest");cache("windows-package-cache-session.ps1","SelfTest");',
    '  cache("windows-package-cache-session.ps1","SelfTest");');
  one('  cache("installed-layout-cache-session.ps1","Prepare");cachePrepared=true;', '  cachePrepared=false;');
  one('    if(cachePrepared){cache("installed-layout-cache-session.ps1","Restore");report.cacheRestoration=read(path.join(out,"native-cache-restoration.json"));}', '');
  one('      if(await check.count()){await check.click();return false;}',
    '      if(await check.count()){throw new Error("Installed Windows environment check did not pass");}');
  one('read("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json").protectedFiles', 'sealed.protectedFiles');
  one('read(f.path).editorVersion==="1.9.22"', `read(f.path).editorVersion===${JSON.stringify(c.version)}`);
  one('AVN Native Windows 1922 ${attempt}', `AVN Native Windows ${c.version} \${attempt}`);
  one('fs.copyFileSync(__filename,path.join(out,"executed.cjs"),fs.constants.COPYFILE_EXCL);',
    `fs.copyFileSync(${JSON.stringify(generated)},path.join(out,"executed.cjs"),fs.constants.COPYFILE_EXCL);`);
  one('sourceBuilderInvocation:false,installation:desc(installation),',
    `sourceBuilderInvocation:false,installation:desc(installation),\n  bindingSources:${JSON.stringify([__filename, configFile, original].map(describe))},`);
  new vm.Script(Module.wrap(code));
  return code;
}
const source = fs.readFileSync(original, "utf8"), code = adapt(source);
if (action === "prepare") {
  assert(!fs.existsSync(prep)); fs.mkdirSync(prep);
  const out = path.resolve(`F:/AgentVN/QA/Windows-Package-20261021-01/editor-${attempt}`);
  assert(!fs.existsSync(out));
  assert.throws(() => adapt(source.replace('assert.equal(sealed.version,"1.9.22")', '')), "Missing source guard must fail closed");
  fs.writeFileSync(receipt, JSON.stringify(sealed, null, 2), { flag: "wx" });
  fs.writeFileSync(generated, code, { flag: "wx" });
  fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify({
    status: "PREPARED_NOT_PRODUCT_TESTED", out, config: c,
    sources: [__filename, configFile, original, receipt, generated,
      path.join(__dirname, "windows-package-cache-session.ps1"),
      path.join(__dirname, "lib/installed-release-session.cjs")].map(describe),
    productLaunches: 0, modelRequests: 0
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "PASS", out, productLaunches: 0, modelRequests: 0 }));
} else {
  const binding = read(path.join(prep, "binding.json"));
  assert.deepEqual(binding.config, c);
  for (const f of binding.sources) assert.equal(sha(f.path), f.sha256);
  assert.deepEqual(read(receipt), sealed);
  assert.equal(fs.readFileSync(generated, "utf8"), code);
  process.argv.splice(2, process.argv.length - 2, attempt);
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths;
  worker._compile(code, __filename);
}
