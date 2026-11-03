"use strict";
// Read-only historical binary + real UI-authored artifacts. No Runtime/store/version mocks.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), net = require("node:net");
const { spawn, execFileSync, spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip"), { chromium } = require("../editor/node_modules/playwright");
const root = path.resolve(__dirname, ".."), label = "Portrait-Old-Runtime-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/portrait-old-runtime-20261020-01");
const mode = process.argv[2], iteration = process.argv[3] || "01";
assert(["prepare", "run", "audit", "selftest"].includes(mode)); assert(/^\d{2}$/.test(iteration));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { flag: "wx" });
const pause = ms => new Promise(r => setTimeout(r, ms));
const prepFile = path.join(summary, "preparation.json");
const author = "F:/AgentVN/QA/Dialog-Portrait-Authoring-20261020-01/green-editor-smoke-04";
const frozenExe = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-player.exe";
const controlsFile = path.join(root, "output/old-runtime-refusal-20261018-01/fixtures-02.json");
const stateSource = ["scripts/portrait-old-runtime.cjs", "scripts/portrait-old-runtime-profile.ps1",
  "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"];
function assertDisplay(actual, expected) {
  assert.equal(actual.width, expected.width); assert.equal(actual.height, expected.height);
  assert.equal(actual.reduced, expected.reduced);
  // WebView2 exposes binary floating-point roundoff for integral CDP scale.
  // Retain raw DPR; reject real scale mismatches rather than rounding them away.
  assert([1,2].includes(expected.dpr)); assert(Math.abs(actual.dpr-expected.dpr)<=1e-6, `DPR ${actual.dpr} != ${expected.dpr}`);
}
async function viewport(page, expected) {
  const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
    reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
  assertDisplay(actual,expected); return actual;
}
async function capture(page,cdp,file,expected) {
  const before=await viewport(page,expected);
  const b=Buffer.from((await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data,"base64");
  const after=await viewport(page,expected);assert.deepEqual(after,before);
  const png={width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
  assert.equal(png.width,expected.width*expected.dpr);assert.equal(png.height,expected.height*expected.dpr);
  fs.writeFileSync(file,b,{flag:"wx"});return {...describe(file),before,after,expected,png};
}
function selftest() {
  const expected={width:1920,height:1080,dpr:1,reduced:false};
  const tests=[
    ["exact",expected,true],["binary-roundoff",{...expected,dpr:1.0000000149011612},true],
    ["wrong-scale",{...expected,dpr:1.25},false],["other-integral-scale",{...expected,dpr:2},false],
    ["wrong-width",{...expected,width:1919},false],["wrong-media",{...expected,reduced:true},false],
    ["excess-roundoff",{...expected,dpr:1.00001},false]
  ];
  for(const [name,value,pass]of tests){
    if(pass)assert.doesNotThrow(()=>assertDisplay(value,expected),name);
    else assert.throws(()=>assertDisplay(value,expected),undefined,name);
  }
  const result={status:"PASS",cases:tests.length,rawDprRetained:true,tolerance:1e-6};
  write(path.join(qa,`display-selftest-${iteration}.json`),result);console.log(JSON.stringify(result));
}
async function prepare() {
  const resume = process.argv.includes("--resume-preparation");
  assert(!fs.existsSync(prepFile), "Never replace a complete preparation");
  for (const dir of [qa, checkpoint, summary]) {
    if (resume) assert(fs.existsSync(dir), "Only resume the exact incomplete preparation");
    else { assert(!fs.existsSync(dir)); fs.mkdirSync(dir, { recursive: true }); }
  }
  const saved = stateSource.map(file => {
    const source = path.join(root, file), target = path.join(checkpoint, file);
    if (!resume) {
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(target));
    } else assert(fs.existsSync(target));
    return { file, sha256: sha(target) };
  });
  const sourceReceipt = read(path.join(root, "output/dialog-portrait-authoring-20261020-01/receipt-01.json"));
  assert.equal(sourceReceipt.status, "SOURCE_AND_DEV_PASS");
  const originals = sourceReceipt.cartridges;
  assert(Array.isArray(originals) && originals.length === 2);
  const historical = read(controlsFile), control = historical.fixtures.find(f => f.id === "legacy-control");
  assert.equal(historical.status, "PASS"); assert.equal(sha(control.path), control.sha256);
  assert.equal(sha(frozenExe), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
  const copiedExe = path.join(qa, "old-player/agentvn-player.exe");
  if (!resume) {
    fs.mkdirSync(path.dirname(copiedExe));
    fs.copyFileSync(frozenExe, copiedExe, fs.constants.COPYFILE_EXCL);
  } else assert(fs.existsSync(copiedExe));
  assert.equal(sha(copiedExe), sha(frozenExe));
  const currentPlayer = path.join(root, "editor/src-tauri/binaries/agentvn-player.exe");
  const artifacts = [];
  for (const [layout, name] of [["agentvn", "agentvn.vncart"], ["renpy", "renpy.vncart"]]) {
    const file = path.join(author, name), declared = originals.find(f => path.resolve(f.path) === path.resolve(file));
    assert(declared, `UI-authored receipt does not bind ${file}`); assert.equal(sha(file), declared.sha256);
    const z = await JSZip.loadAsync(fs.readFileSync(file)), m = JSON.parse(await z.file("manifest.json").async("string"));
    const skin = JSON.parse(await z.file("ui/layout.json").async("string"));
    assert.equal(m.runtime_version, "0.22.0"); assert(Object.keys(skin.dialogPortrait).length);
    artifacts.push({ layout, ...describe(file), title: m.title, manifest: m,
      portrait: skin.dialogPortrait, expected: "REJECT_0_22_PROTOCOL", source: "Actual Editor author/save/export smoke-04 bytes unchanged" });
  }
  artifacts.unshift({ layout: "legacy-control", ...describe(control.path), title: control.title,
    minimumRuntimeVersion: control.minimumRuntimeVersion, sentinel: control.sentinel, expected: "PLAY_CONTROL" });
  const prep = { status: "PASS", at: new Date().toISOString(), saved, qa, checkpoint,
    frozen: describe(frozenExe), executedCopy: describe(copiedExe),
    binaryOrigin: "Exact copy of historical installed Player, not rebuilt or newly installed",
    currentPlayer: describe(currentPlayer), dev: describe(path.join(root, "AgentVN Dev.exe")),
    artifacts, authorReceipt: describe(path.join(root, "output/dialog-portrait-authoring-20261020-01/receipt-01.json")),
    historicalControlReceipt: describe(controlsFile), modelRequests: 0, productChanges: 0 };
  write(prepFile, prep); console.log(JSON.stringify({ status: prep.status, artifacts: artifacts.length, qa }));
}
function inspectProcess(pid) {
  const s = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}'|Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate|ConvertTo-Json -Compress`],
  { encoding: "utf8", windowsHide: true });
  return s.trim() ? JSON.parse(s.replace(/^\uFEFF/, "")) : null;
}
async function run() {
  const prep = read(prepFile);
  assert.equal(sha(prep.executedCopy.path), prep.frozen.sha256);
  assert(fs.existsSync("C:/Users/1/AppData/Roaming/com.agentvn.player.qa-hold-portrait-old-runtime-20261020-01"),
    "Protect original player data before any launch");
  const out = path.join(qa, `run-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", at: new Date().toISOString(), executable: prep.executedCopy,
    scope: "REAL_HISTORICAL_INSTALLED_BINARY_COPY_NATIVE_WEBVIEW_0_22_REFUSAL_NOT_NEW_INSTALLATION",
    profileCycle: process.env.AGENTVN_QA_PROFILE_CYCLE || "01",
    cases: [], launches: [], screenshots: [], pageErrors: [], modelRequests: 0, productChanges: 0, cleanup: [] };
  const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const full = [[1920,1080],[2560,1440],[3840,2160]].flatMap(([width,height]) =>
    [1,2].flatMap(dpr => [false,true].map(reduced => ({width,height,dpr,reduced}))));
  const displays = process.argv.includes("--smoke") ? full.slice(0, 1) : full;
  try {
    for (const {artifact,display} of prep.artifacts.flatMap(artifact=>displays.map(display=>({artifact,display})))) {
      assert.equal(sha(artifact.path), artifact.sha256);
      const displayKey=`${artifact.layout}-${display.width}-dpr${display.dpr}-${display.reduced?"reduce":"normal"}`;
      const profile = path.join(out, `${displayKey}-webview`); assert(!fs.existsSync(profile));
      const port = await new Promise((resolve,reject) => {
        const s = net.createServer(); s.once("error",reject); s.listen(0,"127.0.0.1",() => {
          const p = s.address().port; s.close(() => resolve(p));
        });
      });
      const logPath = path.join(out, `${displayKey}.log`), log = fs.openSync(logPath, "wx");
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(key)) delete env[key];
      env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
      env.WEBVIEW2_USER_DATA_FOLDER = profile;
      const child = spawn(prep.executedCopy.path, ["--mode","fixed","--cartridge",artifact.path], {
        cwd: path.dirname(prep.executedCopy.path), env, windowsHide: true, stdio: ["ignore",log,log] });
      fs.closeSync(log);
      let browser, identity;
      const launch = { layout: artifact.layout, display, pid: child.pid, port, profile, command: ["--mode","fixed","--cartridge",artifact.path],
        artifact, logPath, at: new Date().toISOString() };
      report.launches.push(launch); persist();
      try {
        identity = inspectProcess(child.pid); assert(identity); launch.identity = identity;
        assert.equal(path.resolve(identity.ExecutablePath).toLowerCase(), path.resolve(prep.executedCopy.path).toLowerCase());
        const until = Date.now()+45000; let online = false;
        while (Date.now()<until) {
          assert.equal(child.exitCode, null, "Owned old player exited");
          try { online = (await fetch(`http://127.0.0.1:${port}/json/version`, {signal:AbortSignal.timeout(500)})).ok; } catch {}
          if (online) break; await pause(100);
        }
        assert(online, "Owned historical WebView did not start");
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const context = browser.contexts()[0]; assert(context);
        launch.initialPageUrls = context.pages().map(p => p.url());
        const page = context.pages()[0] || await context.waitForEvent("page", {timeout:20000});
        await page.waitForURL(url => url.hostname === "tauri.localhost" || url.protocol === "tauri:", {timeout:20000});
        launch.actualPageUrl = page.url();
        page.setDefaultTimeout(20000); page.on("pageerror", e => report.pageErrors.push(String(e)));
        const cdp = await page.context().newCDPSession(page);
        const webviewRows = JSON.parse(execFileSync("powershell.exe", ["-NoProfile","-Command",
          `@(Get-CimInstance Win32_Process|Where-Object {$_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*${profile.replaceAll("/","\\")}*'}|Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine)|ConvertTo-Json -Compress`],
        { encoding:"utf8",windowsHide:true }) || "[]");
        launch.webviewProcesses = Array.isArray(webviewRows) ? webviewRows : [webviewRows];
        assert(launch.webviewProcesses.length, "Actual WebView profile override was not observed");
        for (const displayCase of [display]) {
          assert.equal(displayCase,display);
          const row = { layout: artifact.layout, ...display, status: "RUNNING", checks: [] }; report.cases.push(row); persist();
          await cdp.send("Emulation.setDeviceMetricsOverride",{width:display.width,height:display.height,deviceScaleFactor:display.dpr,mobile:false});
          await page.emulateMedia({reducedMotion:display.reduced?"reduce":"no-preference"});
          // Native fixed-mode launch is the user entry under test. A frontend
          // page.reload loses this historical binary's launch arguments and is
          // not a valid way to start the next matrix case: launch a fresh owned
          // process instead, without altering native configuration.
          if(artifact.expected==="PLAY_CONTROL")await page.getByText(artifact.title,{exact:true}).waitFor();
          else await page.getByRole("alert").filter({hasText:"卡带要求 0.22.0"}).waitFor();
          await page.evaluate(async () => {
            await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations!==Infinity)
              .map(a => a.finished.catch(() => {})));
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          });
          row.actualDisplay=await viewport(page,display); row.text = await page.locator("body").innerText();
          const start = page.getByRole("button",{name:"开始游戏",exact:true});
          row.start = {visible:await start.isVisible(),enabled:await start.isEnabled().catch(() => false)};
          if (artifact.expected === "PLAY_CONTROL") {
            assert(row.start.visible && row.start.enabled); assert(row.text.includes(artifact.title));
            await start.click(); await page.getByText(artifact.sentinel,{exact:true}).waitFor();
            row.playText = await page.locator("body").innerText(); assert(row.playText.includes(artifact.sentinel));
            row.checks.push("Historical binary really starts supported control through its visible button");
          } else {
            assert(!(row.start.visible && row.start.enabled), "Old binary accepted unsupported portrait layout");
            assert(row.text.includes("0.22.0"), `No actual 0.22 gate: ${row.text}`);
            assert(/版本|不兼容|不支持/.test(row.text)); assert(/更新|升级|过低|支持|要求/.test(row.text));
            assert(!/ui_layout_version|Unrecognized key|Invalid literal/.test(row.text),
              "Earlier schema failure cannot prove Runtime protocol rejection");
            row.actualProtocol = row.text.match(/当前\s*(?:Runtime|运行时)[^\d]*(\d+\.\d+\.\d+)/i)?.[1]
              || row.text.match(/当前[^\d]*(\d+\.\d+\.\d+)/)?.[1];
            assert(row.actualProtocol && row.actualProtocol!=="0.22.0", `Actual old protocol missing: ${row.text}`);
            assert.equal(await page.locator('[data-testid="game-state-playing"]').count(),0);
            row.checks.push("Real old protocol rejects exact UI-authored 0.22 package before Start; no earlier layout-schema rejection");
            row.errorGeometry = await page.getByRole("alert").evaluate(n => {
              const r=n.getBoundingClientRect();return {rect:r.toJSON(),buttons:[...n.querySelectorAll("button")].map(b=>{
                const bRect=b.getBoundingClientRect();return {text:b.textContent,rect:bRect.toJSON(),
                  hit:b.contains(document.elementFromPoint(bRect.x+bRect.width/2,bRect.y+bRect.height/2))};
              })};
            });
            const r=row.errorGeometry.rect;
            assert(r.left>=-1&&r.top>=-1&&r.right<=display.width+1&&r.bottom<=display.height+1);
            assert(row.errorGeometry.buttons.length>0&&row.errorGeometry.buttons.every(b=>{
              const r=b.rect;return b.hit&&r.left>=-1&&r.top>=-1&&r.right<=display.width+1&&r.bottom<=display.height+1;
            }));
            row.checks.push("Refusal and real retry/copy controls remain bounded and hittable");
          }
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
          row.checks.push("No horizontal viewport overflow; actual display/DPR/motion match");
          const png=path.join(out,`${artifact.layout}-${display.width}-dpr${display.dpr}-${display.reduced?"reduce":"normal"}.png`);
          report.screenshots.push(await capture(page,cdp,png,display));
          row.status="PASS";persist();console.log(`PASS ${artifact.layout} ${display.width} DPR${display.dpr} reduce=${display.reduced}`);
        }
      } finally {
        await browser?.close().catch(()=>{});
        if(child.exitCode===null&&child.signalCode===null) {
          const now=inspectProcess(child.pid); if(identity)assert.deepEqual(now,identity);
          const stopped=spawnSync("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,encoding:"utf8"});
          assert.equal(stopped.status,0,stopped.stderr); launch.termination="OWNED_TEST_PROCESS_TREE_NOT_NORMAL_EXIT_ACCEPTANCE";
        }
        const current=JSON.parse(execFileSync("powershell.exe",["-NoProfile","-Command",
          `@{processes=@(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(child.pid)}'|Select-Object ProcessId);listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -eq ${port}}|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4 -Compress`],
        {encoding:"utf8",windowsHide:true}));
        const clean={pid:child.pid,port,status:current.processes.length||current.listeners.length?"FAILED":"PASS",current};
        report.cleanup.push(clean);persist();assert.equal(clean.status,"PASS");
      }
    }
    assert.equal(report.cases.length,prep.artifacts.length*displays.length);
    assert(report.cases.every(c=>c.status==="PASS"));assert.deepEqual(report.pageErrors,[]);
    for(const a of prep.artifacts)assert.equal(sha(a.path),a.sha256);
    assert.equal(sha(prep.frozen.path),prep.frozen.sha256);assert.equal(sha(prep.dev.path),prep.dev.sha256);
    report.status="PASS";
  } catch(error) {report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;}
  finally {
    report.finishedAt=new Date().toISOString();report.testSource=describe(__filename);
    fs.copyFileSync(__filename,path.join(out,"executed-test.cjs"),fs.constants.COPYFILE_EXCL);persist();
    console.log(JSON.stringify({status:report.status,out,cases:report.cases.length,error:report.error}));
  }
}
async function audit() {
  const prep=read(prepFile), report=read(path.join(qa,`run-${iteration}/report.json`));
  const suffix=report.profileCycle==="01"?"":`-${report.profileCycle}`;
  const restorationFile=path.join(qa,`profile-restoration${suffix}.json`);
  const protectionFile=path.join(qa,`profile-protection${suffix}.json`);
  const restoration=read(restorationFile);
  assert.equal(report.status,"PASS");assert.equal(report.cases.length,36);assert.equal(report.screenshots.length,36);
  assert.equal(restoration.status,"PASS");assert.equal(restoration.restoredFiles.length,read(protectionFile).files.length);
  assert(report.cleanup.length===36&&report.cleanup.every(c=>c.status==="PASS"));
  for(const group of prep.artifacts){
    const rows=report.cases.filter(c=>c.layout===group.layout);assert.equal(rows.length,12);
    const expected=[1920,2560,3840].flatMap(w=>[1,2].flatMap(d=>[false,true].map(r=>JSON.stringify([w,d,r]))));
    assert.deepEqual(rows.map(c=>JSON.stringify([c.width,c.dpr,c.reduced])).sort(),expected.sort());
    assert(rows.every(c=>c.status==="PASS"&&c.checks.length>=2));
    if(group.expected!=="PLAY_CONTROL")assert(rows.every(c=>c.text.includes("0.22.0")&&c.actualProtocol&&c.actualProtocol!=="0.22.0"));
    assert.equal(sha(group.path),group.sha256);
  }
  for(const s of report.screenshots){assert.equal(sha(s.path),s.sha256);assert.deepEqual(s.before,s.after);
    assertDisplay(s.before,s.expected);
    const b=fs.readFileSync(s.path);assert.equal(b.readUInt32BE(16),s.expected.width*s.expected.dpr);
    assert.equal(b.readUInt32BE(20),s.expected.height*s.expected.dpr);}
  for(const a of [prep.frozen,prep.executedCopy,prep.currentPlayer,prep.dev])assert.equal(sha(a.path),a.sha256);
  for(const a of prep.saved)assert.equal(sha(path.join(checkpoint,a.file)),a.sha256);
  const receipt={status:"HISTORICAL_BINARY_PORTRAIT_PROTOCOL_REFUSAL_PASS",at:new Date().toISOString(),
    scope:report.scope,configuredDisplays:12,cases:36,screenshots:36,modelRequests:0,productChanges:0,newBuilds:0,
    evidence:[describe(path.join(qa,`run-${iteration}/report.json`)),describe(restorationFile)],
    frozen:prep.frozen,dev:prep.dev,originalPlayerFilesPreserved:restoration.restoredFiles.length,
    observedProtocols:[...new Set(report.cases.map(c=>c.actualProtocol).filter(Boolean))],
    notProven:["New installation or current full Release","Windows or Android standalone export/upgrade","Normal native exit","All historical Runtime versions"]};
  write(path.join(summary,`receipt-${iteration}.json`),receipt);console.log(JSON.stringify(receipt));
}
Promise.resolve().then(()=>mode==="prepare"?prepare():mode==="run"?run():mode==="selftest"?selftest():audit())
  .catch(e=>{console.error(e);process.exitCode=1;});
