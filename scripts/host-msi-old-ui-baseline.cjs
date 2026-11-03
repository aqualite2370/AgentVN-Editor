"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const [launchFile, destination, create = "already-created"] = process.argv.slice(2);
assert(launchFile && destination && !fs.existsSync(destination), "Fresh baseline required");
fs.mkdirSync(destination, { recursive: true });
const launch = JSON.parse(fs.readFileSync(launchFile, "utf8"));
const language = launch.language;
const isClean = create === "clean";
const oldVersion = launch.actualVersion;
const isLegacy171 = oldVersion === "1.7.1";
const kind = launch.installerKind === "NSIS" ? "NSIS" : "MSI";
const settingsButton = isLegacy171 ? "工具 / 设置" : "选项";
const title = `${kind}${isClean ? "全新安装" : "真实覆盖"}_${language}_20261018`;
const author = `本机隔离${kind}升级验收`;
const summary = `${isClean ? "新" : "旧"}${kind}真实写入_${language}_${isClean ? "1.9.9" : oldVersion}`;
const report = { status: "RUNNING", scope: isClean ? `NEW_${kind}_FRESH_REGISTRATION_REAL_UI_CREATE_AND_EXPORT` : `OLD_${kind}_REAL_UI_PROJECT_CREATION_AND_SAVE`,
  startedAt: new Date().toISOString(), launch, checks: [], screenshots: [], realModelRequests: 0,
  testProject: process.env.AGENTVN_TEST_PROJECT || "NOT_SET_IN_EARLY_EN_BASELINE_ACTUAL_NEW_QA_PROJECT_RECORDED",
  workspaceOutput: process.env.AGENTVN_WORKSPACE_OUTPUT || destination,
  setup: isLegacy171 ? `Original four profiles held; blank QA defaults before actual old ${kind} installation. Real 1.7.1 backend creates install-local data/backend/vn_engine.db; see actual launch/install receipts for this session.`
    : isClean ? "No registered MSI before real /i. Historical directory leftovers remain. English used a declared QA seed; Chinese default DB/WebView started absent. Not a clean machine."
    : language === "zh-CN"
    ? "Four original profiles held. English QA defaults archived; no DB or WebView seed for Chinese old MSI. Old installed backend creates its own default database."
    : "Four original profiles held; known prior QA DB seed only, fresh WebView. A new project created using real homepage button before this baseline." };
let browser;
async function current() {
  const response = await fetch("http://127.0.0.1:8278/api/project/state");
  assert(response.ok);
  const payload = await response.json(); assert(payload.ok);
  return { metadata: payload.data.project_metadata, graph: payload.data.project_graph };
}
(async () => {
  if(isClean) assert.equal(launch.actualVersion,"1.9.9");
  else assert(["1.7.1","1.9.8"].includes(launch.actualVersion),"Verified actual old release required");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const pageDeadline=Date.now()+30000;
  let page;
  do {
    page=browser.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
    if(!page) await new Promise(resolve=>setTimeout(resolve,100));
  } while(!page && Date.now()<pageDeadline);
  assert(page); page.setDefaultTimeout(20000);
  if (create === "create" || isClean) {
    const home = page.getByRole("button", {name:"返回首页",exact:true});
    if (await home.isVisible()) await home.click();
    await page.getByRole("region", {name:"创建或打开项目",exact:true})
      .getByRole("button", {name:"新建项目",exact:true}).click();
    await page.getByRole("button", {name:settingsButton,exact:true}).waitFor();
    report.checks.push("Fresh isolated project created using real installed homepage button");
  } else assert.equal(create,"already-created");
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "detached", timeout: 30000 });
  const priorSave = page.locator('[data-testid="project-save-confirmation"]');
  if (await priorSave.isVisible()) await priorSave.getByRole("button", {name:"OK",exact:true}).click();
  if (!(await page.getByRole("textbox", { name: "项目名称", exact: true }).isVisible())) {
    await page.getByRole("button", { name: settingsButton, exact: true }).click();
  }
  await page.getByRole("textbox", { name: "项目名称", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "项目作者", exact: true }).fill(author);
  await page.getByRole("button", { name: isLegacy171 ? settingsButton : "编辑", exact: true }).click();
  await page.getByRole("textbox", { name: /^场景摘要(?: 场景摘要)?$/ }).fill(summary);
  const theme = page.locator(".theme-tone-switch:visible");
  if (/切换到深色主题/.test(await theme.getAttribute("aria-label"))) await theme.click();
  if (isLegacy171) {
    // 1.7.1 exports a browser JSON download, not the newer native ZIP/OK dialog.
    // Exercise its real save button and preserve the actual downloaded bytes.
    const pendingDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "保存工程", exact: true }).click();
    const download = await pendingDownload;
    assert.equal(await download.failure(), null, "Old release download failed");
    const retained = path.join(destination, "old-release-export.vnproj");
    await download.saveAs(retained);
    const bytes = fs.readFileSync(retained);
    const project = JSON.parse(bytes.toString("utf8"));
    assert.equal(project.title, title);
    assert.equal(project.author, author);
    assert.equal(project.nodes.find(n => n.id === "node_scene_opening").data.scene.summary, summary);
    report.package = { path: retained, suggestedFilename: download.suggestedFilename(),
      format: "1.7.1 JSON .vnproj browser download",
      sha256: require("node:crypto").createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
    report.checks.push("Actual old-release download bytes match UI-created title, author and scene summary");
  } else await page.getByRole("button", { name: "保存工程", exact: true }).click();
  if (isClean) {
    const dialog=page.getByRole("dialog",{name:"工程已导出",exact:true});
    await dialog.waitFor();
    const text=await dialog.innerText(),file=text.match(/C:\\Users\\1\\Downloads\\[^\r\n]+\.vnproj/)?.[0];
    assert(file,"Real native export path missing");
    const bytes=fs.readFileSync(file),zip=await require("../editor/node_modules/jszip").loadAsync(bytes);
    const project=JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(project.title,title);assert.equal(project.author,author);
    assert.equal(project.nodes.find(n=>n.id==="node_scene_opening").data.scene.summary,summary);
    report.package={path:file,sha256:require("node:crypto").createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length};
    report.checks.push("Actual .vnproj export bytes match new candidate UI-created title, author and summary");
  }
  if (!isLegacy171) {
    await page.locator('[data-testid="project-save-confirmation"]').getByRole("button", {name:"OK",exact:true}).click();
  }
  const deadline = Date.now() + 20000;
  let project;
  do {
    project = await current();
    if (project.metadata.title === title && project.metadata.author === author &&
        project.graph.nodes.find(n => n.id === "node_scene_opening")?.data.scene.summary === summary) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  assert.equal(project.metadata.title, title);
  assert.equal(project.metadata.author, author);
  assert.equal(project.graph.nodes.find(n => n.id === "node_scene_opening").data.scene.summary, summary);
  report.project = project;
  report.localStorage = await page.evaluate(() => ({
    "agentvn.themeTone": localStorage.getItem("agentvn.themeTone")
  }));
  assert.equal(await theme.getAttribute("aria-label"), "切换到浅色主题");
  assert.equal(typeof report.localStorage["agentvn.themeTone"], "string");
  assert(report.localStorage["agentvn.themeTone"].length);
  report.checks.push(`Real ${kind} project metadata, graph summary and dark theme saved through UI`);
  const cdp = await page.context().newCDPSession(page);
  const expected = await page.evaluate(() => ({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
    reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, isClean ? "new-msi-saved.png" : "old-msi-saved.png"), expected));
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  try {
    const failedPage=browser?.contexts()[0].pages().find(p=>p.url().includes("tauri.localhost"));
    if(failedPage){
      report.failureVisibleText=await failedPage.locator("body").innerText();
      const cdp=await failedPage.context().newCDPSession(failedPage);
      const expected=await failedPage.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
        reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
      report.screenshots.push(await captureInstalledWebview(failedPage,cdp,path.join(destination,"failure-state.png"),expected));
    }
  } catch(captureError){report.failureCaptureError=String(captureError);}
})
  .finally(async () => {
    await browser?.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(destination,"report.json"), JSON.stringify(report,null,2), {flag:"wx"});
    if (report.status === "PASS") fs.writeFileSync(path.join(path.dirname(launchFile),isClean?"created-ui-data.json":"old-ui-data-created.json"),
      JSON.stringify(report,null,2),{flag:"wx"});
    console.log(JSON.stringify({status:report.status,projectId:report.project?.metadata.projectId,error:report.error},null,2));
  });
