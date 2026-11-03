"use strict";
// QA binding of the existing six-flow real-NSIS/default-profile upgrade.
// No rebuilt "old" package, no manual backend, no new model calls.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { ps, rows } = require("./lib/current-native-editor-session.cjs");
const base = path.resolve("F:/AgentVN/QA/Editor-1.9.30-20261026-01");
const out = "F:/AgentVN/QA/Editor-Upgrade-1930-20261026-01";
const checkpoint = "F:/AgentVN/Checkpoints/Editor-Upgrade-1930-20261026-01";
const prep = path.join(base, "upgrade-preparation-01");
const receipt = path.join(base, "derived-components-installation-01.json");
const sealed = path.join(prep, "candidate-installation.json");
const session = path.join(prep, "session.ps1");
const old = "D:/AgentVN/releases/editor/AgentVN_Editor_v1.9.29_20261026_080949.exe";
const originals = {
  business: ["candidate-1924-editor-upgrade.cjs", "e1f4b9f0c040595d1e84dfc6117c7609d7c7e288308e9907ac67a1c64eb1fcb1"],
  session: ["candidate-1924-editor-upgrade-session.ps1", "46bbca490bcc316d467b97d34dd5ca3c5624db881caeddee9995aec23bc2dbd7"],
  audit: ["candidate-1924-editor-upgrade-audit.cjs", "ab1f654bf7f83f54083889a42a8f95b41538e8119b51b3da4096d054f032f6b4"],
};
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
function original(kind) {
  const [name, hash] = originals[kind], file = path.join(__dirname, name);
  assert.equal(sha(file), hash, "Recorded full-flow source changed");
  return fs.readFileSync(file, "utf8");
}
function build(kind, input, originalInstall) {
  let source = input; const changes = [];
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, `${kind}: ${before}`);
    source = source.replace(before, () => after); changes.push({ before, after });
  };
  one("F:/AgentVN/QA/Editor-Upgrade-1924-20261025-05", out);
  if (kind === "business") {
    one('"scripts/candidate-1924-editor-upgrade-session.ps1"', JSON.stringify(session));
    one('scope:"REAL_NSIS_1_9_22_TO_1_9_24_DEFAULT_PATHS_ON_DEVELOPMENT_HOST"',
      'scope:"REAL_NSIS_1_9_29_TO_1_9_30_DEFAULT_PATHS_ON_DEVELOPMENT_HOST"');
    for (const [label, version] of [["old","1.9.29"],["new","1.9.30"],["restart","1.9.30"]])
      one(`await launch("${label}","${label === "old" ? "1.9.22" : "1.9.24"}");`, `await launch("${label}","${version}");`);
    one('.fill("Editor升级1924临时工程")', '.fill("Editor升级1930临时工程")');
    const begin = source.indexOf("async function saveProject(label){"), end = source.indexOf("async function checkEnvironment", begin);
    assert(begin > 0 && end > begin);
    one(source.slice(begin,end), `async function saveProject(label){
  const before=await snapshot(),directory="C:/Users/1/Downloads";
  const existing=new Set(fs.readdirSync(directory));
  await page.getByRole("button",{name:"保存工程",exact:true}).click();
  const dialog=page.getByTestId("project-save-confirmation");await dialog.waitFor({timeout:60000});
  assert(!/失败|无权限|不可写/.test(await dialog.innerText()),"Native project save must actually succeed");
  const JSZip=require("../editor/node_modules/jszip"),matches=[];
  for(const name of fs.readdirSync(directory).filter(n=>!existing.has(n)&&n.endsWith(".vnproj"))){
    const file=path.join(directory,name),zip=await JSZip.loadAsync(fs.readFileSync(file));
    const project=JSON.parse(await zip.file("project.json").async("string"));
    if(project.project_id===before.metadata.projectId)matches.push(file);
  }
  assert.equal(matches.length,1,"Exactly one newly saved package for the current project required");
  const f=matches[0],retained=path.join(out,label+".vnproj");fs.copyFileSync(f,retained,fs.constants.COPYFILE_EXCL);
  const hash=sha(f);assert.equal(sha(retained),hash);
  (report.downloads??=[]).push({source:f,retained,sha256:hash,bytes:fs.statSync(f).size,removed:false});save();
  await dialog.getByRole("button",{name:"OK",exact:true}).click();await dialog.waitFor({state:"detached"});
  return snapshot();
}
`);
    // Both actual versions already share the current serializer schema.
    // Preserve all original project/theme/cache equality assertions unchanged.
    new vm.Script(Module.wrap(source));
  } else if (kind === "session") {
    // PowerShell source uses backslashes, so the initial POSIX replacement above
    // is handled separately by the caller (this branch is not used).
    throw Error("Use buildSession for the PowerShell source");
  } else {
    one('actualVersion,"1.9.22"', 'actualVersion,"1.9.29"');
    one('actualVersion,"1.9.24"', 'actualVersion,"1.9.30"');
    one('old:"1.9.22",current:"1.9.24"', 'old:"1.9.29",current:"1.9.30"');
    one('old.cacheEditorVersion,"1.9.22"', 'old.cacheEditorVersion,"1.9.29"');
    one('next.cacheEditorVersion,"1.9.24"', 'next.cacheEditorVersion,"1.9.30"');
    new vm.Script(Module.wrap(source));
  }
  return { source, changes };
}
function buildSession(input, originalInstall) {
  let source = input; const changes = [];
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after); changes.push({ before, after });
  };
  one("$run='F:\\AgentVN\\QA\\Editor-Upgrade-1924-20261025-05'", `$run='${out.replaceAll("/","\\")}'`);
  one("$checkpoint='F:\\AgentVN\\Checkpoints\\Editor-Upgrade-1924-20261025-05'",
    `$checkpoint='${checkpoint.replaceAll("/","\\")}'`);
  one("$old='D:\\AgentVN\\releases\\editor\\AgentVN_Editor_v1.9.22_20261022_122816.exe'",
    `$old='${old.replaceAll("/","\\")}'`);
  one("$sealed='F:\\AgentVN\\QA\\Editor-1.9.24-20261024-01\\installation.json'", `$sealed='${sealed}'`);
  one("$originalInstall='F:\\AgentVN\\QA\\AgentVN-QA-HostUpgrade-20261018-02\\installed-editor'",
    `$originalInstall='${originalInstall}'`);
  one("if((Read $sealed).executable.version -cne '1.9.24'){throw 'Wrong frozen candidate'}",
    "if((Read $sealed).executable.version -cne '1.9.30'){throw 'Wrong frozen candidate'}");
  one("if($candidate.status -cne 'PASS' -or $candidate.executable.version -cne '1.9.24'){throw 'Wrong sealed candidate'}",
    "if($candidate.status -cne 'PASS' -or $candidate.executable.version -cne '1.9.30'){throw 'Wrong sealed candidate'}");
  one("$version=if($Action -ceq 'InstallOld'){'1.9.22'}else{'1.9.24'}",
    "$version=if($Action -ceq 'InstallOld'){'1.9.29'}else{'1.9.30'}");
  one("VersionInfo.ProductVersion -cne '1.9.22'", "VersionInfo.ProductVersion -cne '1.9.29'");
  // Journal suffix changes are mechanical and cannot broaden the roots.
  const occurrences = source.split("editor-upgrade-1924-20261025-05").length - 1;
  assert.equal(occurrences, 2);
  source = source.replaceAll("editor-upgrade-1924-20261025-05", "editor-upgrade-1930-20261026-01");
  changes.push({ before: "editor-upgrade-1924-20261025-05", after: "editor-upgrade-1930-20261026-01", count: 2 });
  // The generated file's script directory differs from the repository script.
  one("(Join-Path $PSScriptRoot 'candidate-1924-editor-upgrade.cjs')",
    "'D:\\AgentVN\\scripts\\candidate-1930-editor-upgrade.cjs'");
  return { source, changes };
}
function registeredInstallation() {
  const registered = JSON.parse(ps(
    "$k=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor';" +
    "$p=([string]$k.InstallLocation).Trim('\"');" +
    "[PSCustomObject]@{path=$p;version=$k.DisplayVersion}|ConvertTo-Json -Compress"));
  assert(path.resolve(registered.path).startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
  assert(fs.existsSync(path.join(registered.path, "agentvn-editor.exe")));
  assert(!registered.path.includes("'"));
  return registered;
}
function prepare() {
  if (fs.existsSync(prep)) {
    const binding = read(path.join(prep, "binding.json"));
    for (const f of binding.files) assert.equal(sha(f.path), f.sha256);
    return binding;
  }
  const current = require("./candidate-1930-exit.cjs").validateInstallation(receipt);
  assert.equal(sha(old), "4c116fc63fdd40aa10a2ddb8bc52a6b07e4e1be8249d19367afd0958b704454a");
  const registered = registeredInstallation();
  const business = build("business", original("business")), audit = build("audit", original("audit"));
  const powershell = buildSession(original("session"), registered.path);
  assert(!fs.existsSync(out) && !fs.existsSync(checkpoint)); fs.mkdirSync(prep);
  const candidate = { ...current, executable: { ...current.executable, version: "1.9.30" },
    package: current.protectedFiles.find(f => path.extname(f.path) === ".exe" && f.path.includes("releases")) };
  assert(candidate.package);
  fs.writeFileSync(sealed, JSON.stringify(candidate,null,2), {flag:"wx"});
  fs.writeFileSync(session, powershell.source, {flag:"wx"});
  fs.writeFileSync(path.join(prep,"business.cjs"), business.source, {flag:"wx"});
  fs.writeFileSync(path.join(prep,"audit.cjs"), audit.source, {flag:"wx"});
  const binding = { status:"PREPARED_NOT_TESTED", oldVersion:"1.9.29", currentVersion:"1.9.30",
    registered, productChanges:0, modelRequests:0,
    files:[__filename, receipt, old, sealed, session, path.join(prep,"business.cjs"),path.join(prep,"audit.cjs"),
      ...Object.values(originals).map(([name])=>path.join(__dirname,name))].map(desc),
    adaptations:{business:business.changes,session:powershell.changes,audit:audit.changes} };
  fs.writeFileSync(path.join(prep,"binding.json"),JSON.stringify(binding,null,2),{flag:"wx"});
  return binding;
}
function selfTest() {
  const registered = registeredInstallation(); let rejected = 0;
  for (const kind of ["business","session","audit"]) {
    const source = original(kind), builder = text => kind === "session"
      ? buildSession(text,registered.path) : build(kind,text);
    const built = builder(source);
    for (const c of built.changes.filter(c=>!c.count)) {
      assert.throws(()=>builder(source.replace(c.before,""))); rejected++;
    }
  }
  const binding = prepare();
  const result = spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",session,"-Action","SelfTest"],
    {windowsHide:true,encoding:"utf8",timeout:20000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  fs.writeFileSync(path.join(prep,"self-test.json"),JSON.stringify({status:"PASS",sourceDriftRejected:rejected,
    originalInstall:binding.registered,exactInstallBoundaryNegatives:8,nativeApps:0,modelRequests:0},null,2),{flag:"wx"});
  console.log(JSON.stringify({status:"PASS",sourceDriftRejected:rejected,nativeApps:0,modelRequests:0,prep}));
}
function main() {
  if (process.argv[2] === "--self-test") return selfTest();
  assert(["run","audit"].includes(process.argv[2])); assert.equal(process.argv.length,3);
  const binding = prepare(), action = process.argv[2];
  assert(!rows().some(p=>/^(AgentVN Dev|agentvn-editor|agentvn-player|creator-backend)\.exe$/i.test(p.Name)));
  if(action==="run"){
    assert.equal(read(path.join(base,"hide-audit-01/report.json")).status,"PASS");
    assert.deepEqual(registeredInstallation(),binding.registered);
  }
  const source = fs.readFileSync(path.join(prep,action==="run"?"business.cjs":"audit.cjs"),"utf8");
  process.argv.splice(2,process.argv.length-2,action==="run"?"run":"01");
  const worker = new Module(__filename,module); worker.filename=__filename; worker.paths=module.paths;
  worker._compile(source,__filename);
}
if(require.main===module)main();
module.exports={build,buildSession};
