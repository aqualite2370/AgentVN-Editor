"use strict";
// Frozen installed editor/player, real controls. Fixture import uses the real
// public backend. Default-directory save/recent-project restart are NOT native
// directory/file-picker acceptance. No model requests or product fixes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const { runPlayerAuthoring, assertOrdinary, settlePresentation, colors } = require("./lib/installed-player-authoring.cjs");
const { InstalledRuntimeSession } = require("./lib/installed-runtime-session.cjs");
const root = "D:/AgentVN", run = `${root}/output/installed-layout-author-review-20261019-01`;
const work = "F:/AgentVN/QA/Layout-Author-20261019-01/ordinary-story";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => A.sha256(fs.readFileSync(p));
const [phase, attempt = "01"] = process.argv.slice(2);
assert(["fixture", "author", "save", "reopen", "reimport", "export", "consume"].includes(phase));
assert(/^\d{2}$/.test(attempt));
const out = path.join(run, `ordinary-${phase}-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const prep = read(path.join(run, "preparation.json"));
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
const fixtureFile = path.join(run, "ordinary-fixtures.json");
const report = { status: "RUNNING", at: new Date().toISOString(), phase, checks: [], matrix: [], playerMatrix: [],
  screenshots: [], launches: [], pageErrors: [], error: null, nativePickerClaim: false,
  productChanges: 0, modelRequests: 0,
  scope: "FROZEN_INSTALLED_ORDINARY_AUTHORING_DEFAULT_SAVE_RECENT_RESTART_LIBRARY_PLAYER_NOT_SETUP_ANDROID_OR_PICKERS" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser, page, cdp, player, current = { width: 1920, height: 1080, dpr: 1, reduced: false };
const snapshot = () => A.projectSnapshot(8278);
const profiles = p => p.settings.runtimeUILayoutProfiles;
const layout = () => page.locator(".advanced-tab-content.is-active .runtime-layout-designer");
async function stage(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); return row.detail; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { save(); }
}
async function metrics(target, session, width, height, dpr, reduced) {
  current = { width, height, dpr, reduced };
  await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  await target.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await readInstalledViewport(target, current);
}
async function capture(label, target = page, session = cdp) {
  const file = path.join(work, path.basename(out), `${label}.png`); fs.mkdirSync(path.dirname(file), { recursive: true });
  report.screenshots.push(await captureInstalledWebview(target, session, file, current)); save();
}
async function clickable(control) {
  await control.scrollIntoViewIfNeeded(); await control.click({ trial: true });
  const actual = await control.evaluate(async n => {
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
    const r = n.getBoundingClientRect();
    return { rect: r.toJSON(), hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      clipped: n.scrollWidth > n.clientWidth + 1, opacity: +getComputedStyle(n).opacity,
      width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  const r = actual.rect;
  assert(actual.hit && !actual.clipped && actual.opacity > 0 && actual.overflow <= 1 && r.width > 0 && r.height > 0
    && r.left >= -1 && r.top >= -1 && r.right <= actual.width + 1 && r.bottom <= actual.height + 1, JSON.stringify(actual));
  return actual;
}
async function options() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
}
async function saveLayout() {
  await layout().locator('[data-help-key="layout.save"]').click();
  await layout().locator('[data-save-state="saved"]').waitFor();
}
async function preview() {
  await layout().locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor({ timeout: 45000 });
  const frame = page.frames().find(f => f.parentFrame() && f.url().includes("gamecli-preview"));
  assert(frame); await A.settleRuntime(frame); return frame;
}
async function main() {
  if (phase === "fixture") {
    await stage("Prepare isolated ordinary narration and real looping choices, no user project", () => {
      assert(!fs.existsSync(fixtureFile) && !fs.existsSync(work)); fs.mkdirSync(work);
      const p = require("./lib/editor-ui-acceptance.cjs").fixture("installed-ordinary-author-review-20261019-01");
      p.title = "安装版普通剧情作者验收";
      p.nodes[0].data.loadingAnimation = { kind: "default" }; p.nodes[0].data.openingAudio = [];
      p.nodes[1].data.scene.commands = [
        { type: "narration", text: "安装版普通对白作者消费验证。" },
        { type: "choice", choices: [
          { choice_id: "continue", choice_display_name: "继续", text: "继续", target_scene_id: "ui_acceptance", conditions: [] },
          { choice_id: "again", choice_display_name: "重看", text: "重看", target_scene_id: "ui_acceptance", conditions: [] },
        ] },
      ];
      const input = path.join(work, "普通剧情隔离工程.vnproj");
      fs.writeFileSync(input, JSON.stringify(p), { flag: "wx" });
      const f = { status: "PASS", input, sha256: sha(input), projectId: p.project_id, title: p.title };
      fs.writeFileSync(fixtureFile, JSON.stringify(f, null, 2), { flag: "wx" }); return f;
    }); report.status = "PASS"; return;
  }
  const fixture = read(fixtureFile);
  assert.equal(sha(fixture.input), fixture.sha256);
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
  report.fixture = fixture;
  if (phase === "consume") {
    const exported = read(path.join(run, "ordinary-export-01/report.json")); assert.equal(exported.status, "PASS");
    player = new InstalledRuntimeSession({ prep, fixture, cartridges: [{ ...exported.cartridge, layout: "renpy" }],
      out, report, save, installId: "qa_ordinary_author_20261019" });
    await player.start("renpy", false); page = player.page; cdp = player.cdp;
    const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
    await stage("Actual installed Player ordinary/choice/quickbar authored values, real states and branch clicks12 combinations", async () => {
      for (const [w, h] of [[1920,1080],[2560,1440],[3840,2160]])
        for (const d of [1,2]) for (const reduced of [false,true]) {
          await metrics(page, cdp, w, h, d, reduced);
          await page.getByTestId("start-new-game").click(); await page.mouse.move(0,0);
          const row = { viewport: current, ordinary: await assertOrdinary(page), states: {}, status: "RUNNING" };
          report.playerMatrix.push(row); save();
          const auto = page.getByTestId("renpy-quick-auto"), rollback = page.getByTestId("renpy-quick-rollback");
          assert(await rollback.isDisabled());
          row.states.disabled = await rollback.evaluate(n => getComputedStyle(n).color);
          assert.equal(row.states.disabled, rgb(colors.quick.disabled));
          row.states.normal = await auto.evaluate(n => getComputedStyle(n).color); assert.equal(row.states.normal, rgb(colors.quick.normal));
          await auto.hover(); await settlePresentation(page);
          row.states.hover = await auto.evaluate(n => getComputedStyle(n).color); assert.equal(row.states.hover, rgb(colors.quick.hover));
          await auto.click();
          await page.waitForFunction(() => document.querySelector('[data-testid="renpy-quick-auto"]')?.getAttribute("aria-pressed") === "true");
          await auto.evaluate(async n => { await Promise.all(n.getAnimations().map(a => a.finished.catch(() => {}))); });
          row.states.selected = await auto.evaluate(n => getComputedStyle(n).color);
          assert.equal(row.states.selected, rgb(colors.quick.selected)); await auto.click();
          assert.equal(await auto.getAttribute("aria-pressed"), "false");
          await page.locator(".dialog-box").click(); await page.locator(".choice-panel").waitFor();
          const choice = page.getByRole("button", { name: "选择：继续", exact: true });
          await clickable(choice); await page.mouse.move(0,0); await settlePresentation(page);
          row.choice = await page.locator(".choice-panel").evaluate(n => ({
            left: n.style.left, rect: n.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight,
            color: getComputedStyle(n.querySelector("button")).color,
            labels: [...n.querySelectorAll("button")].map(b => b.textContent.trim()),
          }));
          assert.equal(row.choice.left, "42%"); assert.equal(row.choice.color, rgb(colors.choice.normal));
          assert.deepEqual(row.choice.labels, ["继续", "重看"]);
          const r = row.choice.rect; assert(r.left >= -1 && r.top >= -1 && r.right <= w + 1 && r.bottom <= h + 1);
          await choice.hover(); await settlePresentation(page);
          row.choice.hover = await choice.evaluate(n => getComputedStyle(n).color);
          assert.equal(row.choice.hover, rgb(colors.choice.hover));
          await clickable(page.getByTestId("renpy-quick-settings"));
          await capture(`${w}-dpr${d}-${reduced ? "reduced" : "normal"}-choice`);
          await choice.click(); await page.locator(".choice-panel").waitFor({ state: "detached" });
          await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent.includes("安装版普通对白作者消费验证"));
          row.status = "PASS"; save();
          // Library-mode reload returns to the cartridge library, not title.
          // Select the visible real cartridge again; never inject Runtime state.
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByTestId("game-state-library").waitFor();
          const spine = page.locator(".cartridge-spine").filter({ has: page.locator("strong", { hasText: fixture.title }) });
          await spine.waitFor({ state: "visible" });
          assert.equal(await spine.count(), 1); await spine.click();
          await page.getByRole("button", { name: "启动卡带", exact: true }).click(); await player.ready("title_menu");
          console.log(`PASS ordinary player ${w} dpr${d} reduced=${reduced}`);
        }
      assert.equal(report.playerMatrix.length, 12);
      return { combinations:12, quickBarStates:4, choiceRuntimeStates:["normal","hover"], realBranchClick:true };
    });
  } else {
    const suffix = ["reopen", "reimport", "export"].includes(phase) ? "04" : "03";
    const launch = read(path.join(run, `launch-${suffix}.json`)); report.launch = launch;
    assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
    page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
    page.setDefaultTimeout(45000); page.on("pageerror", e => report.pageErrors.push(String(e)));
    cdp = await page.context().newCDPSession(page); await metrics(page,cdp,1920,1080,1,false);
    if (phase === "author") {
      await stage("Import controlled fixture via real packaged backend then homepage/options actual clicks", async () => {
        const r = await fetch("http://127.0.0.1:8278/api/project/projects/import", { method:"POST",
          headers: { "Content-Type":"application/octet-stream", "X-AgentVN-Filename":encodeURIComponent(path.basename(fixture.input)) },
          body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
        const p = await r.json(); assert(r.ok && p.ok && p.data.project_id === fixture.projectId);
        await page.reload({waitUntil:"domcontentloaded"});
        await page.locator('[data-help-key="home.recentProject"]').filter({hasText:fixture.title}).click();
        await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
        return { nativeProjectPickerClaim:false };
      });
      const result = await runPlayerAuthoring({ out, report, stage, snapshot, layout, saveLayout, options, preview,
        context:()=>({page,cdp}), metrics, clickable, save, capture,
        authoringOnly:"STRUCTURE_ROLES_PREVIEW_ONLY_NO_NATIVE_SAVE_CLAIM" });
      report.authored = await snapshot(); assert.deepEqual(profiles(report.authored).profiles.agentvn,result.originalAgent);
    } else if (phase === "save") {
      await stage("Actual native default-directory portable save contains both authored layouts", async () => {
        await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
        const before = new Set(fs.readdirSync("C:/Users/1/Downloads"));
        await page.getByRole("button",{name:"保存工程",exact:true}).click();
        const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
        await dialog.getByRole("button",{name:"OK",exact:true}).click(); await dialog.waitFor({state:"hidden"});
        const files = fs.readdirSync("C:/Users/1/Downloads").filter(f=>!before.has(f)&&f.endsWith(".vnproj"));
        assert.equal(files.length,1); const original=path.join("C:/Users/1/Downloads",files[0]),retained=path.join(work,files[0]);
        fs.copyFileSync(original,retained,fs.constants.COPYFILE_EXCL); assert.equal(sha(original),sha(retained));
        report.savedPackage={original,retained,sha256:sha(retained),generatedAt:fs.statSync(original).mtime.toISOString()};
        const zip=await JSZip.loadAsync(fs.readFileSync(retained),{checkCRC32:true});
        const p=JSON.parse(await zip.file("project.json").async("string")); report.authored=await snapshot();
        assert.equal(p.project_id,fixture.projectId); assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles,profiles(report.authored));
        assert(!JSON.stringify(p).includes(work)); return report.savedPackage;
      });
    } else if (phase === "reopen") {
      await stage("New actual installed process restores ordinary authoring from real recent-project entry",async()=>{
        const prior=read(path.join(run,"ordinary-save-01/report.json"));assert.equal(prior.status,"PASS");
        assert.notEqual(launch.editorPid,prior.launch.editorPid);
        await page.locator('[data-help-key="home.recentProject"]').filter({hasText:fixture.title}).click();
        await page.locator(".editor-toolbar").waitFor();await A.settleEditor(page);
        report.authored=await snapshot();assert.deepEqual(profiles(report.authored),profiles(prior.authored));
        await capture("new-native-process-ordinary-restored");
        return {previousPid:prior.launch.editorPid,currentPid:launch.editorPid,nativePickerClaim:false};
      });
    } else if (phase === "reimport") {
      await stage("Actual saved portable bytes reimport via packaged public backend, both ordinary authored layouts retained",async()=>{
        const prior=read(path.join(run,"ordinary-save-01/report.json"));assert.equal(prior.status,"PASS");
        assert.equal(sha(prior.savedPackage.retained),prior.savedPackage.sha256);
        const r=await fetch("http://127.0.0.1:8278/api/project/projects/import",{method:"POST",
          headers:{"Content-Type":"application/octet-stream","X-AgentVN-Filename":encodeURIComponent(path.basename(prior.savedPackage.retained))},
          body:fs.readFileSync(prior.savedPackage.retained),signal:AbortSignal.timeout(30000)});
        const result=await r.json();assert(r.ok&&result.ok&&result.data.project_id===fixture.projectId);
        await page.reload({waitUntil:"domcontentloaded"});
        await page.locator('[data-help-key="home.recentProject"]').filter({hasText:fixture.title}).click();
        await page.locator(".editor-toolbar").waitFor();await A.settleEditor(page);
        report.authored=await snapshot();assert.deepEqual(profiles(report.authored),profiles(prior.authored));
        return {source:prior.savedPackage,bothLayoutsMatch:true,nativePickerClaim:false};
      });
    } else if (phase === "export") {
      await stage("Actual publish cartridge retains authored ordinary structure, role overrides and story choices",async()=>{
        report.authored=await snapshot();
        await page.locator('[data-workspace-surface="publish"]:visible').click();await A.settleEditor(page);
        await page.locator(".cartridge-export-panel").waitFor();
        if(await page.locator(".windows-env-panel").count())await page.waitForFunction(()=>
          ["passed","failed"].includes(document.querySelector(".windows-env-panel")?.getAttribute("data-environment-verification")),
        null,{timeout:180000});
        await A.dismissEnvironmentCompletion(page);
        await page.locator('[data-package-stage="settings"]').click();
        await page.locator('[data-help-key="package.mode"]').click();await page.getByRole("option",{name:/游戏卡带 .vncart/}).click();
        const warn=page.getByRole("button",{name:"查看并确认警告",exact:true});if(await warn.isVisible())await warn.click();
        const confirm=page.locator('[data-help-key="package.confirmWarnings"]');if(await confirm.isVisible())await confirm.check();
        const directory=path.join(work,"cartridge");assert(!fs.existsSync(directory));fs.mkdirSync(directory);
        report.cartridge=await A.realDownload(page,cdp,directory,page.locator('[data-help-key="package.export"]'));
        const zip=await JSZip.loadAsync(fs.readFileSync(report.cartridge.path),{checkCRC32:true});
        const bytes=await zip.file("ui/layout.json").async("nodebuffer"),skin=JSON.parse(bytes);
        const active=profiles(report.authored).profiles.renpy;
        assert.equal(skin.layout_type,"renpy");assert.deepEqual(skin.screens,active.screens);assert.deepEqual(skin.renpy,active.renpy);
        report.cartridge.layoutSha256=A.sha256(bytes);await capture("actual-ordinary-cartridge-export");
        return report.cartridge;
      });
    }
  }
  assert.deepEqual(report.pageErrors,[]);report.status="PASS";
}
main().catch(async e=>{
  report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;
  if(page&&cdp)await capture("failure").catch(e=>{report.screenshotError=String(e)});
}).finally(async()=>{
  if(player)try{await player.stop()}catch(e){report.cleanupError=String(e);report.status="FAILED";process.exitCode=1}
  if(browser)await browser.close().catch(()=>{});
  report.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:report.status,phase,checks:report.checks.length,matrix:report.matrix.length,
    playerMatrix:report.playerMatrix.length,error:report.error,out}));
});
