"use strict";

// Current-candidate adapter for the existing real NSIS upgrade workflow.
// The frozen 1.9.22 -> 1.9.24 source remains untouched; this wrapper adapts
// only its declared paths and version assertions to the current 1.9.8 -> 1.9.28
// candidate and keeps the generated PowerShell adapter as QA evidence.

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const sourceMain = path.join(__dirname, "candidate-1924-editor-upgrade.cjs");
const sourceSession = path.join(__dirname, "candidate-1924-editor-upgrade-session.ps1");
const out = "F:/AgentVN/QA/Editor-Upgrade-1928-20261026-06";
const checkpoint = "F:/AgentVN/Checkpoints/Editor-Upgrade-1928-20261026-06";
const adapterRoot = "F:/AgentVN/QA/Editor-Upgrade-1928-20261026-06-adapter";
const adapterSession = path.join(adapterRoot, "candidate-session.ps1");
const sealedCandidate = path.join(adapterRoot, "candidate-installation.json");
const oldPackage = "D:/AgentVN/releases/editor/AgentVN_Editor_v1.9.8_20260925_101446.exe";
const currentPayload = "F:/AgentVN/QA/Editor-1.9.28-20261026-01";
const currentInstallerReport = path.join(currentPayload, "payload-01", "installer-resource-report.json");
const currentInstallReport = path.join(currentPayload, "install-02", "actual-installation.json");
const currentInstalledRoot = path.join(currentPayload, "install-02", "installed-nsis");
const currentSourceEditor = path.join(currentInstalledRoot, "agentvn-editor.exe");
const currentBackend = "D:/AgentVN/editor/src-tauri/binaries/creator-backend.exe";
const currentPlayer = "D:/AgentVN/editor/src-tauri/binaries/agentvn-player.exe";
const currentVersions = path.join(currentPayload, "payload-01", "nsis-payload", "build-versions.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function descriptor(file, extra = {}) {
  assert(fs.existsSync(file), `Missing current candidate file: ${file}`);
  return { path: file, sha256: sha256(file), bytes: fs.statSync(file).size, ...extra };
}

function replaceOnce(text, before, after) {
  const count = text.split(before).length - 1;
  assert.equal(count, 1, `Expected one replacement for ${before}, got ${count}`);
  return text.replace(before, after);
}

function prepareAdapterFiles() {
  assert(!fs.existsSync(out), `Fresh output required: ${out}`);
  assert(!fs.existsSync(checkpoint), `Fresh checkpoint required: ${checkpoint}`);
  assert(fs.existsSync(oldPackage), `Missing old installer: ${oldPackage}`);

  if (fs.existsSync(adapterRoot)) {
    assert(fs.existsSync(adapterSession), `Incomplete existing adapter: ${adapterSession}`);
    assert(fs.existsSync(sealedCandidate), `Incomplete existing adapter: ${sealedCandidate}`);
    const candidate = readJson(sealedCandidate);
    assert.equal(candidate.scope,
      "CURRENT_1_9_8_TO_1_9_28_REAL_NSIS_SAME_DIRECTORY_UPGRADE");
    assert.equal(candidate.executable.version, "1.9.28");
    return {
      sourceMain: descriptor(sourceMain),
      sourceSession: descriptor(sourceSession),
      adapterSession: descriptor(adapterSession),
      sealedCandidate: descriptor(sealedCandidate),
      oldPackage: descriptor(oldPackage),
      currentInstaller: descriptor(currentInstallerReport),
      currentInstalledEditor: descriptor(currentSourceEditor, { version: "1.9.28" }),
    };
  }

  const installerReport = readJson(currentInstallerReport);
  const actualInstall = readJson(currentInstallReport);
  assert.equal(installerReport.status, "PASS");
  assert.equal(installerReport.version, "1.9.28");
  assert.equal(actualInstall.status, "PASS");
  assert.equal(actualInstall.executable.sha256, sha256(currentSourceEditor));

  fs.mkdirSync(adapterRoot, { recursive: true });
  const candidate = {
    status: "PASS",
    package: descriptor(installerReport.installers[0].path, {
      modifiedUtc: installerReport.installers[0].modifiedAt,
    }),
    executable: descriptor(currentSourceEditor, { version: "1.9.28" }),
    resources: [
      descriptor(currentBackend),
      descriptor(currentPlayer),
      descriptor(currentVersions),
    ],
    protectedFiles: [
      descriptor(installerReport.installers[0].path),
      descriptor(currentSourceEditor, { version: "1.9.28" }),
      descriptor(currentBackend),
      descriptor(currentPlayer),
      descriptor(currentVersions),
    ],
    sourceInstallation: actualInstall,
    scope: "CURRENT_1_9_8_TO_1_9_28_REAL_NSIS_SAME_DIRECTORY_UPGRADE",
  };
  fs.writeFileSync(sealedCandidate, JSON.stringify(candidate, null, 2), { flag: "wx" });

  let session = fs.readFileSync(sourceSession, "utf8");
  session = replaceOnce(session,
    "$run='F:\\AgentVN\\QA\\Editor-Upgrade-1924-20261025-05'",
    `$run='${out.replaceAll("/", "\\")}'`);
  session = replaceOnce(session,
    "$checkpoint='F:\\AgentVN\\Checkpoints\\Editor-Upgrade-1924-20261025-05'",
    `$checkpoint='${checkpoint.replaceAll("/", "\\")}'`);
  session = replaceOnce(session,
    "$old='D:\\AgentVN\\releases\\editor\\AgentVN_Editor_v1.9.22_20261022_122816.exe'",
    `$old='${oldPackage.replaceAll("/", "\\")}'`);
  session = replaceOnce(session,
    "$sealed='F:\\AgentVN\\QA\\Editor-1.9.24-20261024-01\\installation.json'",
    `$sealed='${sealedCandidate.replaceAll("/", "\\")}'`);
  session = replaceOnce(session,
    "if((Read $sealed).executable.version -cne '1.9.24'){throw 'Wrong frozen candidate'}",
    "if((Read $sealed).executable.version -cne '1.9.28'){throw 'Wrong current candidate'}");
  session = replaceOnce(session,
    "if($candidate.status -cne 'PASS' -or $candidate.executable.version -cne '1.9.24'){throw 'Wrong sealed candidate'}",
    "if($candidate.status -cne 'PASS' -or $candidate.executable.version -cne '1.9.28'){throw 'Wrong sealed current candidate'}");
  session = replaceOnce(session,
    "$version=if($Action -ceq 'InstallOld'){'1.9.22'}else{'1.9.24'}",
    "$version=if($Action -ceq 'InstallOld'){'1.9.8'}else{'1.9.28'}");
  session = replaceOnce(session,
    "if((Get-Item -LiteralPath (Join-Path $install 'agentvn-editor.exe')).VersionInfo.ProductVersion -cne '1.9.22'){",
    "if((Get-Item -LiteralPath (Join-Path $install 'agentvn-editor.exe')).VersionInfo.ProductVersion -cne '1.9.8'){");
  const legacySuffix = "editor-upgrade-1924-20261025-05";
  const currentSuffix = "editor-upgrade-1928-20261026-06";
  assert(session.includes(legacySuffix), `Missing legacy profile suffix: ${legacySuffix}`);
  session = session.replaceAll(legacySuffix, currentSuffix);
  fs.writeFileSync(adapterSession, session, { flag: "wx" });
  fs.copyFileSync(sourceMain, path.join(adapterRoot, "candidate-1924-editor-upgrade.cjs"));

  return {
    sourceMain: descriptor(sourceMain),
    sourceSession: descriptor(sourceSession),
    adapterSession: descriptor(adapterSession),
    sealedCandidate: descriptor(sealedCandidate),
    oldPackage: descriptor(oldPackage),
    currentInstaller: descriptor(installerReport.installers[0].path),
    currentInstalledEditor: descriptor(currentSourceEditor, { version: "1.9.28" }),
  };
}

function adaptMain() {
  let main = fs.readFileSync(sourceMain, "utf8");
  main = replaceOnce(main,
    'const out="F:/AgentVN/QA/Editor-Upgrade-1924-20261025-05";',
    `const out=${JSON.stringify(out)};`);
  main = replaceOnce(main,
    '"scripts/candidate-1924-editor-upgrade-session.ps1"',
    JSON.stringify(adapterSession));
  main = replaceOnce(main, 'await launch("old","1.9.22");', 'await launch("old","1.9.8");');
  main = replaceOnce(main, 'await launch("new","1.9.24");', 'await launch("new","1.9.28");');
  main = replaceOnce(main, 'await launch("restart","1.9.24");', 'await launch("restart","1.9.28");');
  main = replaceOnce(main,
    'scope:"REAL_NSIS_1_9_22_TO_1_9_24_DEFAULT_PATHS_ON_DEVELOPMENT_HOST"',
    'scope:"REAL_NSIS_1_9_8_TO_1_9_28_DEFAULT_PATHS_ON_DEVELOPMENT_HOST"');
  main = replaceOnce(main, "Editor升级1924临时工程", "Editor升级1928临时工程");

  const saveClick = '  await page.getByRole("button",{name:"保存工程",exact:true}).click();';
  const saveClickIndex = main.indexOf(saveClick);
  assert(saveClickIndex >= 0, "Save button source not found");
  main = main.slice(0, saveClickIndex) +
    '  const saveStartedAt=Date.now();\n' + saveClick +
    main.slice(saveClickIndex + saveClick.length);

  const savePathMarker = "  const text=await dialog.innerText(),f=text.match";
  const savePathIndex = main.indexOf(savePathMarker);
  assert(savePathIndex >= 0, "Save path source not found");
  const savePathEnd = main.indexOf("\n", savePathIndex);
  assert(savePathEnd >= 0, "Save path line terminator not found");
  const savePathFallback = `  const text=await dialog.innerText();
  const recent=fs.readdirSync("C:/Users/1/Downloads",{withFileTypes:true})
    .filter(e=>e.isFile()&&e.name.endsWith(".vnproj"))
    .map(e=>path.join("C:/Users/1/Downloads",e.name))
    .filter(f=>fs.statSync(f).mtimeMs>=saveStartedAt-1000)
    .sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
  const f=recent[0];
  report.saveDialogText=text;`;
  main = main.slice(0, savePathIndex) + savePathFallback + main.slice(savePathEnd);

  const forceCleanupMarker = "async function forceCleanup(){";
  const forceCleanupIndex = main.indexOf(forceCleanupMarker);
  assert(forceCleanupIndex >= 0, "Force cleanup source not found");
  const leakClose = `async function closeLeakyForUpgrade(label){
  remember();
  const request={status:"WAITING",label,pid:current.pid,created:current.created,
    exe:current.exe,requestedAt:new Date().toISOString(),
    completion:path.join(out,label+"-close-completed.json")};
  fs.writeFileSync(path.join(out,"computer-use-request.json"),JSON.stringify(request,null,2));
  report.stage="WAIT_NATIVE_CLOSE";report.nativeRequest=request;save();
  console.log("COMPUTER_USE_CLOSE",JSON.stringify(request));
  await until(()=>fs.existsSync(request.completion),"actual Computer Use normal close receipt",600000);
  const receipt=read(request.completion);
  assert.equal(receipt.pid,current.pid);assert.equal(receipt.label,label);
  assert.equal(receipt.method,"Computer Use Alt+F4");
  await until(()=>!rows().some(p=>p.ProcessId===current.pid&&p.Created===current.created),
    "old Editor window exit",30000);
  await browser.close();browser=null;
  const remaining=listeners(current.ports);
  if(remaining.length){
    report.oldBackendLeak={status:"FAILED",label,ports:current.ports,
      remaining,reason:"Old 1.9.8 backend remained after native Editor close"};
    await forceCleanup();
  }else{
    child=null;
    report.cleanups.push({label,status:"PASS",normalClose:true,killed:[],ports:current.ports});
  }
  save();
}

`;
  main = main.slice(0, forceCleanupIndex) + leakClose + main.slice(forceCleanupIndex);
  main = replaceOnce(main, 'await closeNormally("old");', 'await closeLeakyForUpgrade("old");');
  main = replaceOnce(main, 'report.status="PASS";', 
    'report.status=report.oldBackendLeak?"PARTIAL_PASS_OLD_BACKEND_LEAK":"PASS";');
  return main;
}

function run() {
  const evidence = prepareAdapterFiles();
  fs.writeFileSync(path.join(adapterRoot, "adapter-manifest.json"), JSON.stringify({
    status: "PASS",
    createdAt: new Date().toISOString(),
    source: evidence,
    scope: "1.9.8 -> 1.9.28",
    productChanges: 0,
    modelRequests: 0,
  }, null, 2), { flag: "wx" });

  const adapted = adaptMain();
  process.argv = [process.argv[0], sourceMain, process.argv[2] || "run"];
  const worker = new Module(sourceMain, module);
  worker.filename = sourceMain;
  worker.paths = module.paths;
  worker._compile(adapted, sourceMain);
}

if (process.argv[2] === "--self-test") {
  const evidence = prepareAdapterFiles();
  assert.equal(evidence.currentInstalledEditor.version, "1.9.28");
  assert.equal(evidence.oldPackage.sha256, sha256(oldPackage));
  assert.equal(readJson(sealedCandidate).scope,
    "CURRENT_1_9_8_TO_1_9_28_REAL_NSIS_SAME_DIRECTORY_UPGRADE");
  console.log(JSON.stringify({
    status: "PASS",
    scope: "1.9.8 -> 1.9.28",
    productLaunches: 0,
    modelRequests: 0,
    adapterRoot,
  }, null, 2));
} else {
  run();
}

