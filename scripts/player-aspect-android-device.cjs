"use strict";
// QA only. Runtime state is observed through CDP; all user actions use real ADB input.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { fileEvidence, verifyColdBoot } = require("./android-acceptance-evidence.cjs");
const { scopedRuntimeLog } = require("./android-runtime-log-analysis.cjs");
const { visibleControlRect } = require("./visible-control-geometry.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pkg = "com.agentvn.qa.playeraspect1936", game = "qa_player_aspect_android_1936";
const key = "vn.runtime.aspect-ratio." + game;
async function main(requestFile) {
  const q = read(requestFile), out = path.resolve(q.outputDir);
  assert.equal(path.dirname(out), "F:\\AgentVN\\QA\\Android-Package-20261021-01");
  assert.match(path.basename(out), /^device-aspect-37-\d{2}$/);
  assert.equal(q.package, pkg); assert.equal(q.serial, "emulator-5554");
  assert.equal(fileEvidence(q.build.path).sha256, q.build.sha256);
  const build = read(q.build.path);
  assert.equal(build.status, "PASS"); assert.equal(build.cleanup, "PASS");
  assert.equal(fileEvidence(build.apk.path).sha256, build.apk.sha256);
  assert.equal(build.embedded.layout.value.gameViewport.aspectRatio, "4:3");
  const previous = q.previousReport && read(q.previousReport.path);
  if (previous) {
    assert.equal(fileEvidence(q.previousReport.path).sha256, q.previousReport.sha256);
    assert.equal(previous.status, "FAILED"); assert.equal(previous.cleanup, "PASS"); assert.equal(previous.apk.sha256, build.apk.sha256);
    assert.equal(previous.cases.length, 5); assert(previous.cases.slice(0, 4).every(c => c.status === "PASS"));
    assert.match(previous.error, /137 !== 0/);
  }
  const reportFile = path.join(out, "runtime-report.json");
  assert(!fs.existsSync(reportFile));
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], touches: [],
    screenshots: [], commands: [], pids: [], builds: 0, modelRequests: 0, productChanges: 0,
    ...(previous ? { continuation: { previousReport: q.previousReport,
      retainedPassingCases: previous.cases.slice(0, 4).map(c => c.name),
      reason: "Only complete missing restart proof after prior UIAutomator process exit137; do not rerun passing matrix",
      previousVerdictPreserved: "FAILED", priorWarningsStillBlocking: previous.logAssessment } } : {}),
    source: q.build, apk: build.apk, uninstall: "NOT_RUN", stagingCleanup: "PENDING",
    scope: "CURRENT_INSTALLED_EDITOR_ANDROID_PLAYER_RATIO_REAL_ADB_TOUCH_NOT_UPGRADE",
    limitations: ["One Ren'Py APK, not a second AgentVN Android build", "Actual emulator geometry, not physical phone",
      "No paid model, audio listening, upgrade or final user project", "Native output chooser not tested"] };
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  r.test = fileEvidence(path.join(out, "executed-test.cjs"));
  const adb = path.join(q.sdk, "platform-tools/adb.exe"), staged = path.join(out, "current-staging.apk");
  let ownedAdb = false, installed = false, forwarded = false, client, rotationBefore;
  const cmd = (args, binary = false, allowFailure = false) => {
    const result = spawnSync(adb, ["-P", String(q.adbPort), "-s", q.serial, ...args],
      { windowsHide: true, encoding: binary ? null : "utf8", timeout: 60000, maxBuffer: 40 * 1024 ** 2 });
    r.commands.push({ at: new Date().toISOString(), args, status: result.status,
      ...(binary ? {} : { stdout: result.stdout, stderr: result.stderr }) });
    if (!allowFailure) assert.equal(result.status, 0, String(result.stderr || result.error || result.stdout));
    return result;
  };
  const text = args => cmd(args).stdout.trim();
  const wait = async (fn, label, timeout = 60000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const value = await fn(); if (value) return value; await pause(250); }
    throw Error("Timed out: " + label);
  };
  async function step(name, fn) {
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; r.cases.push(c); save();
    try { c.detail = await fn(); c.status = "PASS"; }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { c.finishedAt = new Date().toISOString(); save(); }
  }
  class Client {
    constructor(socket) {
      this.socket = socket; this.seq = 0; this.pending = new Map();
      socket.onmessage = event => {
        const m = JSON.parse(event.data), cb = this.pending.get(m.id);
        if (cb) { this.pending.delete(m.id); cb(m); }
      };
    }
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++this.seq;
        const timer = setTimeout(() => { this.pending.delete(id); reject(Error("CDP timeout: " + method)); }, 15000);
        this.pending.set(id, m => { clearTimeout(timer); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
        this.socket.send(JSON.stringify({ id, method, params }));
      });
    }
    async evaluate(expression) {
      const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result?.value;
    }
    close() { this.socket.close(); }
  }
  async function ready(screen) {
    await wait(() => client.evaluate(`(() => { const n=document.querySelector('[data-runtime-screen-transition]');
      return n?.dataset.runtimePresentedScreen===${JSON.stringify(screen)} && n.dataset.runtimeScreenTransition==='idle'
        && !document.querySelector('.boot-overlay,.game-launch-blackout'); })()`), "screen ready: " + screen);
  }
  async function connect() {
    client?.close(); client = undefined;
    if (forwarded) { cmd(["forward", "--remove", `tcp:${q.cdpPort}`]); forwarded = false; }
    const pid = await wait(() => {
      const p = cmd(["shell", "pidof", pkg], false, true);
      if (p.status === 1 && !p.stdout?.trim() && !p.stderr?.trim()) return false;
      assert.equal(p.status, 0, p.stderr); const value = p.stdout.trim();
      assert.match(value, /^\d+$/); return value;
    }, "actual package PID");
    r.pids.push(pid);
    cmd(["forward", "--no-rebind", `tcp:${q.cdpPort}`, `localabstract:webview_devtools_remote_${pid}`]); forwarded = true;
    const tab = await wait(async () => {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${q.cdpPort}/json/list`,
          { signal: AbortSignal.timeout(2000) })).json();
        return pages.find(p => p.type === "page" && p.url && p.url !== "about:blank");
      } catch (e) { if (!/fetch|abort|timeout|JSON/i.test(String(e))) throw e; }
    }, "actual APK WebView");
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("WebSocket open timeout")), 15000);
      socket.onopen = () => { clearTimeout(timer); resolve(); }; socket.onerror = e => { clearTimeout(timer); reject(e); };
    });
    client = new Client(socket);
    await wait(() => client.evaluate(`Boolean(document.querySelector('[data-testid="start-new-game"]'))`), "actual title");
    await ready("title_menu");
  }
  const metrics = () => client.evaluate(`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
    reduced:matchMedia('(prefers-reduced-motion: reduce)').matches})`);
  async function shot(label, xml = false) {
    const before = await metrics(), bytes = cmd(["exec-out", "screencap", "-p"], true).stdout;
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    const physical = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    assert(physical.width >= 1920 && physical.height >= 1080 && physical.width > physical.height);
    const after = await metrics(); assert.deepEqual(before, after);
    assert(Math.abs(physical.width - before.width * before.dpr) <= 3
      && Math.abs(physical.height - before.height * before.dpr) <= 3, "Real WebView and physical capture must agree");
    r.physical = physical;
    const file = path.join(out, label + ".png"); fs.writeFileSync(file, bytes, { flag: "wx" });
    const sample = { ...fileEvidence(file), before, after, physical, source: "real ADB screencap; no metrics override" };
    if (xml) {
      const remote = `/sdcard/agentvn-${path.basename(out)}.xml`;
      try {
        cmd(["shell", "uiautomator", "dump", remote]);
        const value = text(["exec-out", "cat", remote]); assert(value.includes("<hierarchy") && value.includes(pkg));
        const file = path.join(out, label + "-uiautomator.xml"); fs.writeFileSync(file, value, { flag: "wx" });
        sample.uiautomator = fileEvidence(file);
      } finally { cmd(["shell", "rm", "-f", remote]); }
    }
    r.screenshots.push(sample); save(); return sample;
  }
  async function tap(selector, label) {
    const hit = await wait(() => client.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});
      if(!e||e.disabled) return null; const b=(${visibleControlRect.toString()})(e);
      for(const [u,v] of [[.5,.5],[.5,.25],[.25,.25],[.75,.75]]){
        const x=b.x+b.width*u,y=b.y+b.height*v,t=document.elementFromPoint(x,y);
        if(x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&(t===e||e.contains(t)))
          return {x,y,width:innerWidth,height:innerHeight,rect:b};
      }return null;})()`), "real touch target: " + label);
    if (!r.physical) await shot("touch-baseline");
    const x = Math.round(hit.x * r.physical.width / hit.width), y = Math.round(hit.y * r.physical.height / hit.height);
    cmd(["shell", "input", "tap", String(x), String(y)]); r.touches.push({ label, selector, x, y, hit }); save();
    await client.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
  }
  async function frame(ratio) {
    const value = await wait(() => client.evaluate(`(() => {
      const f=document.querySelector('.runtime-layout-frame'),s=f?.closest('.ui-skin-scope');
      if(!s||s.dataset.gameAspectRatio!==${JSON.stringify(ratio)})return null;
      return {frame:f.getBoundingClientRect().toJSON(),scope:s.getBoundingClientRect().toJSON(),
        ratio:s.dataset.gameAspectRatio,overflow:document.documentElement.scrollWidth-innerWidth};
    })()`), "effective ratio: " + ratio);
    const [a, b] = ratio.split(":").map(Number), f = value.frame, s = value.scope;
    assert(f.width > 0 && f.height > 0 && Math.abs(f.width / f.height - a / b) < .004);
    assert(f.left >= s.left - 1 && f.right <= s.right + 1 && f.top >= s.top - 1 && f.bottom <= s.bottom + 1);
    assert(Math.abs(f.left + f.right - s.left - s.right) <= 2
      && Math.abs(f.top + f.bottom - s.top - s.bottom) <= 2 && value.overflow <= 1);
    return value;
  }
  async function selectRatio(value) {
    await tap(`[data-testid="settings-aspect-${value}"]`, "player selects " + value);
    await wait(() => client.evaluate(`document.querySelector('[data-testid="settings-aspect-${value}"]')?.getAttribute('aria-pressed')==='true'`),
      "selected player option");
    await wait(() => client.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))===${JSON.stringify(value)}`),
      "real game-specific persisted preference");
    return frame(value === "default" ? "4:3" : value);
  }
  async function finish(screen) { await tap('[data-testid="settings-finish"]', "finish settings"); await ready(screen); }
  async function storyPosition() {
    await ready("playing");
    return client.evaluate(`(() => {const p=document.querySelector('.story-player');return {
      scene:p?.dataset.currentSceneId,command:Number(p?.dataset.currentCommandIndex),
      text:document.querySelector('.dialog-text')?.textContent};})()`);
  }
  async function quickbar() {
    const geometry = await client.evaluate(`(() => {const n=document.querySelector('[data-testid="renpy-quick-bar"]');
      const f=n?.closest('.runtime-layout-frame');if(!n||!f)return null;
      const scope=f.closest('.ui-skin-scope'),r=e=>e.getBoundingClientRect().toJSON();
      const insets=Object.fromEntries(['top','right','bottom','left'].map(edge=>{
        const value=scope.style.getPropertyValue('--runtime-safe-'+edge);
        return [edge,{css:value,pixels:Number(value.match(/^max\\(([-\\d.]+)px/)?.[1])}];}));
      return {bar:r(n),frame:r(f),scale:Number(n.dataset.uniformScale),
        insets,formFactor:scope.dataset.uiFormFactor,
        buttons:[...n.querySelectorAll('button')].map(e=>{const b=e.getBoundingClientRect();return {
          id:e.dataset.testid,disabled:e.disabled,rect:b.toJSON(),
          hit:e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};})};})()`);
    assert(geometry); const { bar, frame: f, buttons } = geometry;
    assert.equal(buttons.length, 9); assert(geometry.scale > 0);
    assert(bar.left >= f.left - 1 && bar.right <= f.right + 1 && bar.bottom <= f.bottom + 1);
    assert.equal(geometry.formFactor, "handheld");
    const inset = Object.fromEntries(Object.entries(geometry.insets).map(([edge, value]) => [edge, value.pixels]));
    assert(Object.values(inset).every(Number.isFinite));
    const safeWidth = f.width - inset.left - inset.right - .012 * f.width;
    const safeHeight = f.height - inset.top - inset.bottom - .012 * f.height;
    const margin = Math.min(8 * Math.min(f.width / 1280, f.height / 720), safeWidth / 16, safeHeight / 16);
    assert(Math.abs(f.bottom - bar.bottom - inset.bottom - .006 * f.height - margin) <= 2,
      "Quick bar must dock to actual frame safe bottom, including native inset and handheld margin");
    for (let n = 0; n < buttons.length; n++) {
      const b = buttons[n]; assert(b.hit && Math.abs(b.rect.top - buttons[0].rect.top) <= 1);
      if (n) assert(b.rect.left >= buttons[n - 1].rect.right - 1);
    }
    return geometry;
  }
  try {
    save();
    const token = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
    { windowsHide: true, encoding: "utf8" });
    assert.equal(token.stdout.trim().toLowerCase(), "true"); r.isElevated = true;
    r.permission = read(path.join(out, "acceptance-permission.json")); assert(r.permission.isElevated && r.permission.success);
    assert(!fs.existsSync(r.permission.probeRoot));
    for (const p of [q.adbPort, q.cdpPort]) await new Promise((resolve, reject) => {
      const s = require("node:net").createServer(); s.once("error", reject); s.listen(p, "127.0.0.1", () => s.close(resolve));
    });
    cmd(["start-server"]); ownedAdb = true;
    await wait(() => cmd(["get-state"], false, true).stdout?.trim() === "device", "owned emulator");
    r.coldBoot = verifyColdBoot(read(path.join(out, "cold-boot.json")),
      text(["shell", "cat", "/proc/sys/kernel/random/boot_id"]), r.startedAt);
    assert.equal(r.coldBoot.status, "PASS");
    assert(!/package:/.test(cmd(["shell", "pm", "path", pkg], false, true).stdout), "Protect existing app");
    const tools = "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain";
    await step("current-apk-signature-package-capability-and-real-install", async () => {
      const run = (exe, args, name) => {
        const result = spawnSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
        fs.writeFileSync(path.join(out, name), (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
        assert.equal(result.status, 0, String(result.stderr)); return result.stdout;
      };
      const signature = run(path.join(tools, "jdk-17/bin/java.exe"),
        ["-jar", path.join(tools, "Sdk/build-tools/35.0.0/lib/apksigner.jar"), "verify", "--verbose", "--print-certs", build.apk.path], "signature.log");
      assert.match(signature, /^Verifies\r?$/m); assert.match(signature, /^Verified using v2 scheme.*:\s*true\r?$/m);
      const signer = signature.match(/^Signer #1 certificate SHA-256 digest:\s*([a-f0-9]{64})\r?$/im)?.[1]; assert(signer);
      const badging = run(path.join(tools, "Sdk/build-tools/35.0.0/aapt2.exe"), ["dump", "badging", build.apk.path], "badging.log");
      assert.match(badging, new RegExp(`package: name='${pkg.replaceAll(".", "\\.")}' versionCode='1000000' versionName='1.0.0'`));
      fs.copyFileSync(build.apk.path, staged, fs.constants.COPYFILE_EXCL);
      assert.equal(fileEvidence(staged).sha256, build.apk.sha256);
      assert.match(text(["install", staged]), /Success/); installed = true;
      const remote = text(["shell", "pm", "path", pkg]).replace(/^package:/, "");
      assert(remote.startsWith("/data/app/") && remote.endsWith("/base.apk") && !remote.includes("\n"));
      const actual = text(["shell", "sha256sum", remote]).split(/\s+/)[0];
      assert.match(actual, /^[a-f0-9]{64}$/);
      assert.equal(actual, build.apk.sha256);
      r.device = { api: text(["shell", "getprop", "ro.build.version.sdk"]), size: text(["shell", "wm", "size"]),
        density: text(["shell", "wm", "density"]), installedSha256: actual, signer };
      assert.equal(r.device.api, "35");
      cmd(["logcat", "-c"]); cmd(["shell", "monkey", "-p", pkg, "1"]); await connect();
      await shot("installed-title-default", true); return { device: r.device, rendering: await frame("4:3") };
    });
    if (!previous) await step("real-settings-touch-all-player-ratios-and-default-title", async () => {
      await tap('[data-testid="open-settings"]', "title settings"); await ready("settings");
      const cases = [];
      for (const value of ["16:9", "16:10", "4:3", "default"]) {
        cases.push({ value, geometry: await selectRatio(value) }); await shot("settings-" + value.replaceAll(":", "-"), value === "16:10");
      }
      await finish("title_menu"); assert.equal(cases.length, 4); return cases;
    });
    if (!previous) await step("story-does-not-advance-and-nine-controls-follow-actual-safe-frame", async () => {
      await tap('[data-testid="start-new-game"]', "start authored temporary story"); await ready("playing");
      await wait(() => client.evaluate(`document.querySelector('.dialog-box')?.dataset.dialogPageDone==='true'`), "fully revealed story");
      const original = await storyPosition(); assert(original.scene && Number.isFinite(original.command));
      const cases = [];
      for (const value of ["16:9", "16:10", "4:3", "default"]) {
        await tap('[data-testid="renpy-quick-settings"]', "story settings"); await ready("settings");
        const settingsFrame = await selectRatio(value); await finish("playing");
        assert.deepEqual(await storyPosition(), original);
        cases.push({ value, settingsFrame, storyFrame: await frame(value === "default" ? "4:3" : value), quickbar: await quickbar() });
        await shot("story-" + value.replaceAll(":", "-"), value === "4:3");
      }
      return { original, cases };
    });
    if (!previous) await step("landscape-rotation-roundtrip-keeps-ratio-story-and-safe-bottom", async () => {
      rotationBefore = { policy: text(["shell", "cmd", "window", "user-rotation"]),
        sensor: text(["emu", "sensor", "get", "acceleration"])
          .match(/acceleration\s*=\s*(-?[\d.]+:-?[\d.]+:-?[\d.]+)/)?.[1] };
      assert(/^(free|lock [0-3])$/.test(rotationBefore.policy) && rotationBefore.sensor);
      await tap('[data-testid="renpy-quick-settings"]', "choose retained ratio"); await ready("settings");
      await selectRatio("16:10"); await finish("playing"); const original = await storyPosition();
      const displays = [];
      for (const value of ["3", "1"]) {
        cmd(["shell", "cmd", "window", "user-rotation", "lock", value]);
        cmd(["emu", "sensor", "set", "acceleration", value === "3" ? "-9.81:0:0" : "9.81:0:0"]);
        await wait(() => client.evaluate(`screen.orientation.angle===${Number(value) * 90} && innerWidth>innerHeight`),
          "actual requested landscape rotation applied");
        await ready("playing"); assert.deepEqual(await storyPosition(), original);
        assert.equal(await client.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`), "16:10");
        displays.push({ requested: value, display: text(["shell", "dumpsys", "window", "displays"]),
          actual: await client.evaluate("({angle:screen.orientation.angle,width:innerWidth,height:innerHeight})"),
          frame: await frame("16:10"), quickbar: await quickbar() });
        await shot("rotation-" + value);
      }
      return displays;
    });
    await step("real-process-restart-retains-player-override-and-reset-default", async () => {
      if (previous) {
        await tap('[data-testid="open-settings"]', "fresh continuation setup"); await ready("settings");
        await selectRatio("16:10"); await finish("title_menu");
      }
      const launches = [];
      for (const value of ["16:10", "default"]) {
        if (value === "default") {
          await tap('[data-testid="open-settings"]', "title restore default"); await ready("settings");
          await selectRatio("default"); await finish("title_menu");
        }
        const oldPid = r.pids.at(-1); cmd(["shell", "am", "force-stop", pkg]);
        assert(!cmd(["shell", "pidof", pkg], false, true).stdout?.trim());
        cmd(["shell", "monkey", "-p", pkg, "1"]); await connect();
        assert.notEqual(r.pids.at(-1), oldPid);
        assert.equal(await client.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`), value);
        const rendering = await frame(value === "default" ? "4:3" : value);
        await tap('[data-testid="open-settings"]', "verify persisted selected option"); await ready("settings");
        assert(await client.evaluate(`document.querySelector('[data-testid="settings-aspect-${value}"]')?.getAttribute('aria-pressed')==='true'`));
        // Three earlier UIAutomator trees already cover settings/story. Continuation
        // retains its new initial real tree without rerunning the failed ancillary dump.
        await shot("restart-" + value.replaceAll(":", "-"), !previous); await finish("title_menu");
        launches.push({ value, oldPid, newPid: r.pids.at(-1), rendering });
      }
      return launches;
    });
    assert.equal(r.cases.length, previous ? 2 : 5);
    assert(r.touches.length >= (previous ? 10 : 25) && r.screenshots.length >= (previous ? 3 : 12));
    r.functionalStatus = "PASS"; r.status = "PASS";
  } catch (e) {
    r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1;
    if (client) try { r.failurePage = await client.evaluate("({text:document.body.innerText,html:document.body.outerHTML.slice(0,60000)})"); await shot("failure"); }
    catch (e) { r.captureError = String(e); }
  } finally {
    const errors = [];
    try {
      if (ownedAdb) {
        const logs = text(["logcat", "-d", "-v", "threadtime"]);
        fs.writeFileSync(path.join(out, "logcat.txt"), logs, { flag: "wx" });
        r.logs = scopedRuntimeLog(logs, pkg, r.pids);
        r.rendererEvents = r.logs.lines.filter(line => /[Rr]enderer.*(crash|code -1|exited)|onRenderProcessGone/.test(line));
        if (r.logs.fatal.length) { r.status = "FAILED"; errors.push("fatal runtime errors"); }
        else if (r.status === "PASS" && (r.logs.warnings.length || r.rendererEvents.length
          || previous?.logs?.warnings?.length || previous?.rendererEvents?.length)) r.status = "BLOCKED";
        r.logAssessment = { status: r.logs.warnings.length || r.rendererEvents.length ? "BLOCKED_CURRENT_WARNINGS_REQUIRE_REVIEW" : "PASS",
          cacheWarnings: r.logs.warnings.length, rendererEvents: r.rendererEvents.length, historicalAllowlistUsed: false };
      }
    } catch (e) { errors.push("log capture: " + e); }
    client?.close();
    if (rotationBefore) try {
      cmd(["emu", "sensor", "set", "acceleration", rotationBefore.sensor]);
      const actual = text(["emu", "sensor", "get", "acceleration"])
        .match(/acceleration\s*=\s*(-?[\d.]+:-?[\d.]+:-?[\d.]+)/)?.[1];
      assert(actual && actual.split(":").every((v, n) => Math.abs(Number(v) - Number(rotationBefore.sensor.split(":")[n])) < .01));
      cmd(["shell", "cmd", "window", "user-rotation", ...rotationBefore.policy.split(" ")]);
      assert.equal(text(["shell", "cmd", "window", "user-rotation"]), rotationBefore.policy);
      r.rotationRestoration = "PASS";
    } catch (e) { errors.push("rotation: " + e); }
    if (!rotationBefore && previous) r.rotationRestoration = "NOT_CHANGED_PRIOR_ROUNDTRIP_PASS_REFERENCED";
    if (installed) try {
      assert.match(text(["uninstall", pkg]), /Success/);
      assert(!/package:/.test(cmd(["shell", "pm", "path", pkg], false, true).stdout)); r.uninstall = "PASS";
    } catch (e) { r.uninstall = "FAILED"; errors.push("uninstall: " + e); }
    if (forwarded) try { cmd(["forward", "--remove", `tcp:${q.cdpPort}`]); r.forwardCleanup = "PASS"; }
    catch (e) { errors.push("forward: " + e); }
    try {
      assert.equal(path.dirname(staged), out); assert.notEqual(staged, build.apk.path);
      if (fs.existsSync(staged)) fs.unlinkSync(staged);
      assert(!fs.existsSync(staged)); assert.equal(fileEvidence(build.apk.path).sha256, build.apk.sha256); r.stagingCleanup = "PASS";
    } catch (e) { errors.push("staging: " + e); }
    if (ownedAdb) {
      const stopped = spawnSync(adb, ["-P", String(q.adbPort), "kill-server"], { windowsHide: true, timeout: 10000 });
      r.adbCleanup = stopped.status === 0 ? "PASS" : "FAILED"; if (stopped.status !== 0) errors.push("ADB cleanup");
    }
    r.cleanup = errors.length ? "FAILED" : "PASS"; r.cleanupErrors = errors;
    if (errors.length) { r.status = "FAILED"; process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, cases: r.cases.map(c => ({ name: c.name, status: c.status })),
      touches: r.touches.length, screenshots: r.screenshots.length, cleanup: r.cleanup, error: r.error }));
  }
}
if (require.main === module) main(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
