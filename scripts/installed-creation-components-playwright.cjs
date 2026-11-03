"use strict";
// E5 actual installed UI. One live model submission; no store/API/provider mocks.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { readCurrentInstalledRealModelSession } = require("./lib/current-installed-real-model-session.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { verifyInstalledCartridge } = require("./lib/installed-cartridge-player.cjs");
const { startOwnedCreationApi } = require("./lib/owned-creation-api.cjs");
const replayFile = process.env.AGENTVN_CREATION_PROPOSAL_REPORT;
const replay = replayFile ? JSON.parse(fs.readFileSync(replayFile,"utf8")) : null;
const defaultProfileLive = process.env.AGENTVN_REAL_MODEL_DEFAULT_SESSION === "1";
assert(!(replay && defaultProfileLive));
assert(process.argv[2] && process.argv[3] && process.argv[4], "Pass owned session, isolated fixture, fresh output");
const runRoot = path.resolve(process.argv[2]), projectFile = path.resolve(process.argv[3]), out = path.resolve(process.argv[4]);
assert(A.inside(runRoot, out) && !fs.existsSync(out));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), projectFile);
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), out);
const fixture = JSON.parse(fs.readFileSync(projectFile, "utf8"));
assert.equal(fixture.project_id, defaultProfileLive ? "installed-real-model-component-20261019-01" : "installed_creation_smoke_20261014"); assert.equal(fixture.nodes.length, 2);
fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], requests: [], errors: [], matrix: [],
  scope: "Actual installed Release authorized library -> one live model -> selective batch review -> persistence -> cartridge -> installed player",
  fixture: { path: projectFile, sha256: A.sha256(fs.readFileSync(projectFile)) }, cleanup: {} };
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Lz4AAAAASUVORK5CYII=", "base64");
let browser, page, session, state, before, merged, modelHost;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function shot(name) {
  const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  (report.screenshots ||= []).push(await captureInstalledWebview(page, session, path.join(out, name), actual));
}
const snapshot = () => A.projectSnapshot(state.backendPort);
async function stage(name, operation) {
  if(replay) name=`recorded-provider-repair-regression:${name.replace("one-live-native","recorded-native")}`;
  report.stage = name; save(); console.log(JSON.stringify({ stage: name, status: "STARTED" }));
  await operation(); report.cases.push({ name, status: "PASS" }); save(); console.log(`PASS ${name}`);
}
async function openLayoutLibrary() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
  await page.locator('[data-layout-type-option="renpy"]:visible').click();
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
  await A.settleEditor(page);
  const details = page.locator("details.renpy-personal-component-library");
  if (!await details.evaluate(node => node.open)) await details.locator("summary").click();
  return page.getByTestId("custom-component-library");
}
async function main() {
  const installed = defaultProfileLive ? readCurrentInstalledRealModelSession(runRoot) : A.readInstalledSession(runRoot); state = installed.state;
  report.owner = state; report.exeSha256 = installed.exeSha256;
  if(replay){
    assert(replay.process?.status==="completed" && replay.requests?.length===1,"Replay requires the recorded real-model result");
    const hostOut=path.join(out,"recorded-provider");fs.mkdirSync(hostOut);modelHost=await startOwnedCreationApi(hostOut);
    report.scope="Actual installed repaired Release full UI, recorded earlier real model response at external boundary; NOT another live-model call";
    report.replayedProviderReport=path.resolve(replayFile);
    const response=await fetch(`http://127.0.0.1:${state.backendPort}/api/project/state`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      provider_connections:[{connection_id:"replay",provider_type:"openai_compatible",display_name:"既有真实结果保存回归",base_url:modelHost.modelUrl,api_key_storage:"local",enabled:true}],
      provider_models:[{provider_id:"replay-model",connection_id:"replay",model_id:"replay-model",model_name:"controlled-model",enabled:true,display_name:"既有真实结果保存回归",capabilities:["text_generation"],default_parameters:{structured_mode:"tools"}}],
      provider_selections:{text_generation:"replay-model"},provider_secrets:{replay:"test-only-secret"}
    }),signal:AbortSignal.timeout(30000)});assert(response.ok);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  page = browser.contexts()[0].pages().find(candidate => /tauri\.localhost/.test(candidate.url()));
  assert(page); page.setDefaultTimeout(45000); page.on("pageerror", error => report.errors.push(String(error)));
  page.on("dialog", dialog => {
    if (dialog.type() === "confirm" && /从本机个人库删除[“](创作关于卡|授权图标模板)[”]/.test(dialog.message())) void dialog.accept();
    else void dialog.dismiss();
  });
  session = await browser.contexts()[0].newCDPSession(page);
  page.on("request", request => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/assistant/creation/processes")) return;
    const payload = request.postDataJSON();
    // Explicit allowlist: never serialize provider_selection or arbitrary request fields.
    report.requests.push({ processId: payload.id, projectId: payload.project_id, conversationId: payload.conversation_id,
      keys: Object.keys(payload.request), userRequest: payload.request.user_request,
      authorizedComponents: payload.request.authorized_components, authorizedTargets: payload.request.authorized_targets }); save();
  });
  await stage("installed-personal-library-authoring-and-default-no-authorization", async () => {
    const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(projectFile)) },
      body: fs.readFileSync(projectFile), signal: AbortSignal.timeout(30000) }); assert(response.ok);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixture.title }).first().click();
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page); before = await snapshot();
    assert.equal(before.projectId, fixture.project_id); assert.equal(before.assetManifest.length, 0);
    const library = await openLayoutLibrary();
    before = await snapshot();
    assert.equal(before.projectId, fixture.project_id);
    assert.equal(before.settings.runtimeUILayout.layout_type, "renpy");
    await library.getByLabel("组件名称", { exact: true }).fill("未授权对照 PRIVATE_COMPONENT_SENTINEL");
    await library.getByLabel("组件 HTML", { exact: true }).fill('<div class="root"><span>PRIVATE_COMPONENT_SENTINEL</span></div>');
    await library.getByLabel("组件 CSS", { exact: true }).fill(".root { padding: 8px; }");
    await library.getByTestId("component-save").click(); await library.getByText(/PRIVATE_COMPONENT_SENTINEL.*已保存/).waitFor();
    if(replay){
      // Stable declared asset aliases allow byte-identical response replay. The
      // fixture is imported through the real ZIP scan/confirm UI, not IDB/store writes.
      const template=structuredClone(replay.requests[0].authorizedComponents[0]);
      const zip=new JSZip(); const asset=template.assets[0], id=asset.id.replace(/^selected-1-/,"");
      zip.file("assets/0-0.bin",image,{createFolders:false});zip.file("manifest.json",JSON.stringify({format:"agentvn-component-library",schemaVersion:1,components:[{
        id:"recorded-template",name:template.name,description:template.description,html:template.html.split(asset.id).join(id),css:template.css,
        assets:[{id,filename:asset.filename,mimeType:asset.mime_type,path:"assets/0-0.bin",sha256:A.sha256(image)}]
      }]}));
      await library.getByTestId("component-import-file").setInputFiles({name:"既有授权模板.zip",mimeType:"application/zip",buffer:await zip.generateAsync({type:"nodebuffer"})});
      await library.getByText(/扫描通过：1 个组件/).waitFor();await library.getByTestId("component-confirm-import").click();await library.getByText(/已将 1 个组件另存为本机副本/).waitFor();
    } else {
    await library.getByLabel("添加组件图片依赖", { exact: true }).setInputFiles({ name: "授权 图标.png", mimeType: "image/png", buffer: image });
    await library.getByText(/已添加 1 个图片依赖/).waitFor();
    const assetId = await library.locator(".custom-component-dependencies code").innerText(); report.templateAssetId = assetId;
    await library.getByLabel("组件名称", { exact: true }).fill("授权图标模板");
    await library.getByLabel("组件 HTML", { exact: true }).fill(`<div class="root"><span class="title" data-bind="project.title">标题</span><img class="icon" data-asset="${assetId}" aria-label="授权图标"/><button type="button" class="button" aria-label="组件打开关于" data-action="open_about">关于</button></div>`);
    await library.getByLabel("组件 CSS", { exact: true }).fill(".root { display: flex; flex-direction: column; gap: 8px; padding: 8px; }.title { font-size: 16px; color: #ffffff; }.icon { width: 32px; height: 32px; object-fit: contain; }.button { color: #ffffff; background-color: #222222; padding: 4px 8px; }");
    await library.getByTestId("component-save").click(); await library.getByText(/“授权图标模板”已保存/).waitFor();
    }
    report.templateName = await library.locator(".custom-component-list li label span").filter({hasText:"授权图标模板"}).innerText();
    A.assertProjectContentUnchanged(await snapshot(), before);
    await page.locator('[data-workspace-surface="assistant"]:visible').click();
    await page.getByRole("button", { name: "创造模式", exact: true }).click();
    await page.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true }).click();
    const workbench = page.getByTestId("assistant-creation-workbench-window");
    const templateName=report.templateName;
    await workbench.getByRole("checkbox", { name: `授权组件 ${templateName}`, exact: true }).waitFor();
    assert.equal(await workbench.getByTestId("assistant-creation-authorized-components").locator("input:checked").count(), 0);
    await workbench.getByRole("checkbox", { name: `授权组件 ${templateName}`, exact: true }).check();
    report.templateName=templateName;
    assert.equal(await workbench.getByRole("checkbox", { name: "授权组件 未授权对照 PRIVATE_COMPONENT_SENTINEL", exact: true }).isChecked(), false);
    const prompt = '请基于本会话唯一授权的“授权图标模板”构建两个新组件，使用真实提交工具一次性提交两个 components，edits 为空。不要修改既有控件。两个 screen_id 均为 title，名称分别为“创作关于卡”和“创作帮助卡”。保留模板的 project.title 绑定和已授权图片 data-asset 编号，图片32px、正文16px、纵向flex和克制黑灰配色。关于卡按钮必须为 data-action="open_about"、aria-label="组件打开关于"、文字“关于”；帮助卡为 data-action="open_help"、aria-label="组件打开帮助"、文字“帮助”。只使用模板已支持的 HTML/CSS 子集，不引入脚本、远程链接或额外资源。不声称已保存或合并。';
    await workbench.getByLabel("向大模型助手提问", { exact: true }).fill(prompt);
    await shot("authorized-library-before-live.png");
  });
  const workbench = page.getByTestId("assistant-creation-workbench-window");
  await stage("one-live-native-tool-batch-and-minimal-library-context", async () => {
    fs.writeFileSync(path.join(out, "submission-intent.json"), JSON.stringify({ task: "new-component-agent",
      projectId: fixture.project_id, createdAt: new Date().toISOString(),
      policy: "ONE_SUBMISSION_NO_AUTOMATIC_RETRY" }), { flag: "wx" });
    await workbench.getByRole("button", { name: "生成创作提案", exact: true }).click();
    const deadline = Date.now() + 360000; let result;
    while (Date.now() < deadline) {
      if (report.requests[0]?.processId) {
        const response = await fetch(`http://127.0.0.1:${state.backendPort}/api/assistant/creation/processes/${report.requests[0].processId}`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) { result = await response.json(); if (["completed", "failed", "cancelled"].includes(result.status)) break; }
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    report.process = result; assert(result, "No process result");
    if (result.status !== "completed") { report.status = result.errorCode === "provider_error" ? "BLOCKED" : "FAILED"; throw new Error(`Live process ${result.status}: ${result.errorCode} ${result.errorMessage}`); }
    assert.equal(report.requests.length, 1); const request = report.requests[0];
    assert.equal(request.projectId, fixture.project_id); assert.equal(request.authorizedComponents.length, 1);
    assert.equal(request.authorizedComponents[0].name, report.templateName); assert.equal(request.authorizedComponents[0].assets.length, 1);
    assert.equal(request.authorizedTargets.length, 0);
    assert(!JSON.stringify(request).includes("PRIVATE_COMPONENT_SENTINEL"));
    assert(!request.keys.includes("project_graph") && !request.keys.includes("editor_context"));
    assert.equal(result.result.components.length, 2); assert.equal(result.result.edits?.length ?? 0, 0);
    assert.deepEqual(result.result.components.map(item => item.name).sort(), ["创作关于卡", "创作帮助卡"].sort());
    for (const component of result.result.components) { assert.equal(component.screen_id, "title"); assert(component.html.includes(request.authorizedComponents[0].assets[0].id)); }
    await workbench.getByTestId("assistant-creation-review-batch").waitFor();
    A.assertProjectContentUnchanged(await snapshot(), before);
  });
  const review = workbench.getByTestId("assistant-creation-review-batch");
  await stage("selective-review-runtime-preview-and-12-desktop-samples", async () => {
    await review.getByRole("checkbox", { name: "应用候选 创作帮助卡", exact: true }).uncheck();
    await review.getByRole("checkbox", { name: "应用候选 创作关于卡", exact: true }).check();
    for (const [key, value] of Object.entries({ x: 45, y: 12, width: 30, height: 30 }))
      await review.getByLabel(`创作关于卡 ${key}`, { exact: true }).fill(String(value));
    await review.getByRole("button", { name: "预览所选候选组合", exact: true }).click();
    await review.locator('[data-preview-phase="ready"]').waitFor();
    const frame = await (await review.locator("iframe").elementHandle()).contentFrame(); assert(frame);
    await A.settleRuntime(frame); assert.equal(await frame.getByTestId("runtime-custom-component").count(), 1);
    assert.equal(await frame.getByRole("button", { name: "组件打开帮助", exact: true }).count(), 0);
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      const button = review.getByTestId("assistant-creation-merge-batch"); await button.scrollIntoViewIfNeeded();
      const geometry = await button.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2), box = node.closest('[data-testid="assistant-creation-workbench-window"]').getBoundingClientRect();
        return { rect: r.toJSON(), box: box.toJSON(), hit: node === hit || node.contains(hit), overflow: document.documentElement.scrollWidth-innerWidth, dpr: devicePixelRatio, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches }; });
      assert(geometry.hit && geometry.overflow <= 1 && geometry.rect.width > 0);
      assert(geometry.box.left >= 0 && geometry.box.top >= 0 && geometry.box.right <= width+1 && geometry.box.bottom <= height+1);
      assert(geometry.rect.left >= geometry.box.left && geometry.rect.right <= geometry.box.right && geometry.rect.top >= geometry.box.top && geometry.rect.bottom <= geometry.box.bottom);
      assert.equal(geometry.dpr, dpr); assert.equal(geometry.reduced, reduced); assert.equal(await button.isEnabled(), true);
      report.matrix.push({ width, height, dpr, reduced, geometry });
    }
    assert.equal(report.matrix.length, 12);
    await shot("selective-batch-runtime.png");
    A.assertProjectContentUnchanged(await snapshot(), before);
  });
  await stage("user-save-personal-copy-and-atomic-selected-only-merge", async () => {
    await review.locator("li").filter({ hasText: "创作关于卡" }).getByRole("button", { name: "预览", exact: true }).click();
    await workbench.getByRole("button", { name: "保存到个人组件库", exact: true }).click();
    await workbench.getByRole("button", { name: "已保存到个人组件库", exact: true }).waitFor();
    A.assertProjectContentUnchanged(await snapshot(), before);
    await review.getByTestId("assistant-creation-merge-batch").click();
    await review.getByRole("status").filter({ hasText: /已将 1 个候选一次性应用/ }).waitFor();
    const deadline = Date.now()+15000;
    while (Date.now()<deadline) { merged=await snapshot(); if (merged.settings.runtimeUILayout.screens.find(screen=>screen.screen_id==="title").components.some(item=>item.label==="创作关于卡")) break; await new Promise(resolve=>setTimeout(resolve,150)); }
    const title = merged.settings.runtimeUILayout.screens.find(screen=>screen.screen_id==="title");
    const additions = title.components.filter(item=>item.component_type==="custom_component");
    assert.equal(additions.length,1); assert.equal(additions[0].label,"创作关于卡");
    assert.deepEqual(additions[0].rect,{x:45,y:12,width:30,height:30}); assert.equal(merged.assetManifest.length,1);
    assert.deepEqual(await A.assetBytes(state.backendPort,merged.assetManifest[0]),image);
    for(const screen of before.settings.runtimeUILayout.screens) { const current=merged.settings.runtimeUILayout.screens.find(item=>item.screen_id===screen.screen_id); assert.deepEqual(current.components.filter(item=>item.component_type!=="custom_component"),screen.components); }
    assert.deepEqual(merged.settings.runtimeUILayoutProfiles.profiles.agentvn,before.settings.runtimeUILayoutProfiles.profiles.agentvn);
    report.mergedComponent=additions[0]; report.sourceAssets=merged.assetManifest.map(asset=>({id:asset.asset_id,sha256:A.sha256(image)}));
  });
  await stage(defaultProfileLive ? "personal-library-share-preserves-project-copy-deletion-not-repeated"
    : "personal-library-share-and-delete-does-not-mutate-project-copy", async () => {
    await workbench.getByRole("button",{name:"关闭工作台",exact:true}).click(); await workbench.waitFor({state:"detached"});
    const library=await openLayoutLibrary(); const item=library.locator(".custom-component-list li").filter({hasText:"创作关于卡"});
    assert.equal(await item.count(),1); await item.getByRole("checkbox").check();
    report.componentArchive=await A.realDownload(page,session,out,library.getByTestId("component-export"));
    const zip=await JSZip.loadAsync(fs.readFileSync(report.componentArchive.path)); const manifest=JSON.parse(await zip.file("manifest.json").async("string"));
    assert.equal(manifest.components.length,1); assert.equal(manifest.components[0].name,"创作关于卡"); assert.equal(manifest.components[0].assets.length,1);
    assert.deepEqual(await zip.file(manifest.components[0].assets[0].path).async("nodebuffer"),image);
    for(const name of defaultProfileLive ? [] : ["创作关于卡",report.templateName]) {
      await library.getByRole("button",{name:`删除 ${name}`,exact:true}).click();
      const confirmation=page.getByTestId("editor-delete-confirmation");await confirmation.waitFor();
      await confirmation.getByRole("button",{name:"取消",exact:true}).click();await confirmation.waitFor({state:"detached"});
      assert.equal(await library.getByRole("button",{name:`删除 ${name}`,exact:true}).count(),1);
      await library.getByRole("button",{name:`删除 ${name}`,exact:true}).click();await confirmation.waitFor();
      await confirmation.getByRole("button",{name:"确认删除",exact:true}).click();await confirmation.waitFor({state:"detached"});
      await library.getByRole("button",{name:`删除 ${name}`,exact:true}).waitFor({state:"detached"});
    }
    A.assertProjectContentUnchanged(await snapshot(),merged);
  });
  await stage("installed-ui-reload-keeps-approved-new-component-and-bytes", async () => {
    await page.reload({waitUntil:"domcontentloaded"});
    if(!await page.locator(".editor-toolbar").isVisible()) await page.locator(".recent-project-open:not(:disabled):visible").filter({hasText:fixture.title}).first().click();
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
    A.assertProjectContentUnchanged(await snapshot(),merged);
    await shot("installed-component-reopened.png");
  });
  await stage("actual-webview-cartridge-export-layout-and-image-byte-provenance", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); const publish=page.locator(".cartridge-export-panel"); await publish.waitFor();
    await page.waitForFunction(()=>!document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境")); await A.dismissEnvironmentCompletion(page);
    await publish.locator('[data-help-key="package.mode"]').click(); await page.getByRole("option").filter({hasText:"游戏卡带 .vncart"}).click();
    await publish.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
    const warning=publish.getByRole("checkbox",{name:/我已检查全部警告/}); if(await warning.count()) await warning.check();
    report.cartridgeArtifact=await A.realDownload(page,session,out,publish.locator(".package-primary-action"));
    const zip=await JSZip.loadAsync(fs.readFileSync(report.cartridgeArtifact.path)); const layoutBytes=await zip.file("ui/layout.json").async("nodebuffer"),layout=JSON.parse(layoutBytes.toString("utf8")),manifest=JSON.parse(await zip.file("manifest.json").async("string"));
    const custom=layout.screens.find(screen=>screen.screen_id==="title").components.filter(item=>item.component_type==="custom_component");
    assert.equal(custom.length,1); assert.deepEqual(custom[0],report.mergedComponent); assert.equal(manifest.assets.length,1);
    assert.deepEqual(await zip.file(manifest.assets[0].path).async("nodebuffer"),image);
    report.exportLayoutSha256=A.sha256(layoutBytes); report.exportedImageSha256=A.sha256(image);
  });
  await stage("installed-external-player-consumes-new-component-and-whitelist-action", async () => {
    const playerOut=path.join(out,"external-player"); fs.mkdirSync(playerOut);
    report.player=await verifyInstalledCartridge({installRoot:state.installRoot,cartridge:report.cartridgeArtifact.path,expectedTitle:fixture.title,out:playerOut,
      ...(defaultProfileLive ? { profileRoot: "F:/AgentVN-QA-InstalledRealModel-20261019-01/component-player-webview" } : {})});
  });
  assert.equal(report.cases.length,8); assert.deepEqual(report.errors,[]); report.status="PASS";
}
main().catch(async error=>{ if(report.status==="RUNNING") report.status="FAILED"; report.error=String(error.stack||error); process.exitCode=1;
  if(page) { report.failureText=(await page.locator("body").innerText().catch(()=>"")).slice(-8000); await page.screenshot({path:path.join(out,"failure.png")}).catch(()=>{}); }
}).finally(async()=>{
  if(session) { await session.send("Emulation.clearDeviceMetricsOverride").catch(()=>{}); await session.send("Browser.setDownloadBehavior",{behavior:"default"}).catch(()=>{}); }
  if(state && !defaultProfileLive) {
    try { const response=await fetch(`http://127.0.0.1:${state.backendPort}/api/project/state`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider_secrets:{}}),signal:AbortSignal.timeout(10000)}); assert(response.ok); report.cleanup.credentials="CLEARED"; }
    catch(error) { report.cleanup.credentials=String(error); report.status="FAILED"; process.exitCode=1; }
  }
  await browser?.close().catch(()=>{});
  if(modelHost){
    report.cleanup.recordedProvider=await modelHost.stop();
    if(report.cleanup.recordedProvider.code!==0){report.status="FAILED";process.exitCode=1;}
  }
  if(defaultProfileLive) report.cleanup.session="RETAINED_FOR_SEPARATE_AUTHORIZED_NOVEL_TASK; profiles still held";
  if(state && !defaultProfileLive) for(const [kind,pid] of [["editor",state.editorPid],["backend",state.backendPid]]) {
    const result=spawnSync("taskkill.exe",["/PID",String(pid),"/T","/F"],{windowsHide:true,encoding:"utf8"}); report.cleanup[kind]={pid,exitCode:result.status};
    if(result.status!==0) { report.status="FAILED"; process.exitCode=1; }
  }
  report.finishedAt=new Date().toISOString(); save(); console.log(JSON.stringify({status:report.status,cases:report.cases.length,matrix:report.matrix.length,out,cleanup:report.cleanup,error:report.error}));
});
