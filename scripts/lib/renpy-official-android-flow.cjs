"use strict";
// Exact official-GUI fixture only. ADB drives the UI; CDP reads rendering and
// resource bytes. No store writes, synthetic clicks or backend/model requests.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), Module = require("node:module");
const { fileEvidence } = require("../android-acceptance-evidence.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function isManagedResourceUrl(url) {
  if (url.startsWith("blob:")) return true;
  try {
    const value = new URL(url);
    return ((value.hostname === "agentvn-resource.localhost" && ["http:", "https:"].includes(value.protocol))
      || (value.protocol === "agentvn-resource:" && value.hostname === "localhost"))
      && !value.username && !value.password;
  } catch { return false; }
}
async function inspectRenderedResources(c, label) {
  const result = await c.getClient().evaluate(`(async()=>{
    await document.fonts.ready;
    const urls=new Set(),fonts=[];
    for(const node of document.querySelectorAll("img,[style],button,.dialog-box,.renpy-title-background *")){
      if(node instanceof HTMLImageElement&&node.currentSrc)urls.add(node.currentSrc);
      for(const style of [getComputedStyle(node),getComputedStyle(node,"::before"),getComputedStyle(node,"::after")])
        for(const key of ["backgroundImage","borderImageSource"])
          for(const match of style[key].matchAll(/url\\(["']?([^"')]+)["']?\\)/g))urls.add(match[1]);
    }
    for(const sheet of document.styleSheets){
      let rules;try{rules=sheet.cssRules}catch{continue}
      for(const rule of rules)if(rule instanceof CSSFontFaceRule){
        fonts.push({family:rule.style.fontFamily,status:document.fonts.check("16px "+rule.style.fontFamily)});
        for(const match of rule.style.src.matchAll(/url\\(["']?([^"')]+)["']?\\)/g))urls.add(match[1]);
      }
    }
    const resources=[];
    const managed=${isManagedResourceUrl.toString()};
    for(const url of urls){
      if(!managed(url))continue;
      const response=await fetch(url);if(!response.ok)throw Error("Visible resource read failed");
      const bytes=await response.arrayBuffer();
      const digest=await crypto.subtle.digest("SHA-256",bytes);
      resources.push({url,bytes:bytes.byteLength,sha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("")});
    }
    return{resources,fonts,title:!!document.querySelector('[data-testid="renpy-title-view"]'),
      text:document.querySelector(".dialog-text")?.textContent,font:getComputedStyle(document.body).fontFamily};
  })()`);
  assert(result.resources.length > 0, "Rendered resources must resolve to actual managed resource bytes");
  const expected = c.q.resourceAssets;
  const matches = result.resources.filter(item => expected.some(asset => asset.sha256 === item.sha256 && asset.bytes === item.bytes));
  assert(matches.length > 0);
  (c.r.renderedResources ??= []).push({ label, ...result, matched: matches });
  c.save(); return result;
}
function readQuickSaves(c, label) {
  const prefix = `/data/user/0/${c.q.package}/saves/`;
  const files = c.text(["shell", "find", prefix, "-type", "f"]).split(/\r?\n/)
    .filter(file => /\/quick-\d\d\.json$/.test(file));
  return files.map((remote, index) => {
    assert(remote.startsWith(prefix) && !remote.includes(".."));
    const bytes = c.cmd(["exec-out", "cat", remote], true).stdout;
    const file = path.join(c.out, `${label}-quick-${index}.json`);
    fs.writeFileSync(file, bytes, { flag: "wx" });
    const value = JSON.parse(bytes.toString("utf8"));
    assert.equal(value.save_kind, "quick"); assert.equal(value.scene_id, "ui_acceptance");
    return { remote, ...fileEvidence(file), value };
  });
}
async function barGeometry(c) {
  const rows = await c.getClient().evaluate(`(()=>{
    const bar=document.querySelector('[data-testid="renpy-quick-bar"]');if(!bar)return null;
    return [...bar.querySelectorAll("button")].map(e=>{
      const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,t=document.elementFromPoint(x,y);
      return{id:e.dataset.testid,text:e.textContent,disabled:e.disabled,x:b.x,y:b.y,right:b.right,bottom:b.bottom,
        width:b.width,height:b.height,hit:t===e||e.contains(t),viewport:{width:innerWidth,height:innerHeight}};
    });
  })()`);
  assert(rows); assert.equal(rows.length, 9);
  assert.deepEqual(rows.map(row => row.id), ["rollback", "history", "skip", "auto", "save-load", "save", "load", "settings", "hide"]
    .map(id => "renpy-quick-" + id));
  for (const row of rows) {
    assert(row.width > 0 && row.height > 0 && row.x >= -1 && row.y >= -1);
    assert(row.right <= row.viewport.width + 1 && row.bottom <= row.viewport.height + 1);
    assert(row.hit); assert(Math.abs(row.y - rows[0].y) < 1);
  }
  for (let i = 1; i < rows.length; i++) assert(rows[i - 1].right <= rows[i].x + 1);
  return rows;
}
function currentExitVerifier() {
  const file = path.join(__dirname, "current-android-navigation-exit.cjs");
  let source = fs.readFileSync(file, "utf8");
  assert.equal(hash(source), "8679186340290461780c7ad909908beb469157da4186873092bd1bd747d30086");
  const before = `  await evalWait(\`Number(document.querySelector('.story-player')?.dataset.currentCommandIndex)===1\`, "restored Runtime can advance");
  const advanced = await position(); assert(advanced.text.startsWith("QA_ANDROID_UPGRADE_NEW_1："));`;
  const after = `  await evalWait(\`document.querySelectorAll(".choice-panel button").length===2\`, "restored Runtime actual branch");
  await tap(".choice-panel button:first-of-type", "select branch in recreated Runtime");
  await evalWait(\`Number(document.querySelector('.story-player')?.dataset.currentCommandIndex)===0\`, "actual branch returns to authored scene");
  const advanced = await position(); assert.deepEqual(advanced, first);`;
  assert.equal(source.split(before).length - 1, 1);
  source = source.replace(before, after);
  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;
  worker._compile(source, file); return worker.exports.verifyCurrentNavigationExit;
}
async function verifyRenpyOfficialFlow(c) {
  const { step, tap, idle, position, evalWait, shot, back, r } = c;
  let first;
  await step("Installed official title image and font bytes resolve in the actual Android WebView", async () => {
    assert(await c.getClient().evaluate(`Boolean(document.querySelector('[data-testid="renpy-title-view"]'))`));
    const result = await inspectRenderedResources(c, "title");
    const title = c.q.resourceAssets.find(asset => asset.id.endsWith("bd5abc92"));
    assert(title); assert(result.resources.some(resource => resource.sha256 === title.sha256));
    const font = c.q.resourceAssets.find(asset => asset.path.endsWith(".ttf"));
    assert(font); assert(result.resources.some(resource => resource.sha256 === font.sha256));
    assert(result.fonts.some(face => face.status));
    return { resources: result, fontBoundary: "Font loaded; screenshots and real Chinese text checked separately, no complete glyph audit" };
  });
  await step("Authored dialogue, nine same-row hit targets, official textbox and history return", async () => {
    await tap('[data-testid="start-new-game"]', "start official GUI fixture");
    await idle(); first = await position(); assert(first.text.startsWith("GUI_CONSUMPTION："));
    const bar = await barGeometry(c), resources = await inspectRenderedResources(c, "dialogue");
    const textbox = c.q.resourceAssets.find(asset => asset.path.endsWith("-textbox.png"));
    assert(textbox); assert(resources.resources.some(resource => resource.sha256 === textbox.sha256));
    const quickBackground = c.q.resourceAssets.find(asset => asset.path.endsWith("-quick_idle_background.png"));
    assert(quickBackground); assert(resources.resources.some(resource => resource.sha256 === quickBackground.sha256));
    await shot("official-dialogue-nine-actions");
    await tap('[data-testid="renpy-quick-history"]', "official history action");
    await evalWait(`Boolean(document.querySelector('[data-testid="renpy-menu-content"] .history-list'))
      && document.querySelector('[data-testid="renpy-menu-history"]')?.getAttribute("aria-current")==="page"`,
    "actual history content and active shared navigation");
    await back("history returns to dialogue"); assert.deepEqual(await position(), first);
    return { first, bar, resources };
  });
  await step("Seven real quick saves retain six files; quick load confirms and restores authored state", async () => {
    for (let i = 0; i < 7; i++) {
      await tap('[data-testid="renpy-quick-save"]', "real quick save " + (i + 1));
      await evalWait(`!document.querySelector('[data-testid="renpy-quick-save"]')?.disabled
        && document.body.innerText.includes("快存已保存")`, "actual quick save completed");
      const files = readQuickSaves(c, `quicksave-${i + 1}`);
      assert.equal(files.length, Math.min(i + 1, 6));
      (r.quickSaveSnapshots ??= []).push(files);
    }
    await tap(".dialog-box", "reach actual branch before quick load");
    await evalWait(`document.querySelectorAll(".choice-panel button").length===2`, "two authored branch choices");
    await tap('[data-testid="renpy-quick-load"]', "request real quick load");
    await evalWait(`Boolean(document.querySelector('[data-testid="confirm-quick-load"]'))`, "quick load confirmation");
    await shot("quick-load-confirmation");
    await tap('[data-testid="confirm-quick-load"]', "confirm latest actual quick save");
    await idle(); assert.deepEqual(await position(), first);
    return { filesRetained: 6, writes: 7, confirmedRead: true, restored: first };
  });
  await step("Choice panel hides and restores without choosing; resource-backed branch remains clickable", async () => {
    await tap(".dialog-box", "show choices for hidden UI test");
    await evalWait(`document.querySelectorAll(".choice-panel button").length===2`, "authored choices before hiding");
    const before = await c.getClient().evaluate(`({command:document.querySelector(".story-player").dataset.currentCommandIndex,
      choices:[...document.querySelectorAll(".choice-panel button")].map(e=>e.textContent)})`);
    const resources = await inspectRenderedResources(c, "choice");
    const choiceBackground = c.q.resourceAssets.find(asset => asset.path.endsWith("-choice_idle_background.png"));
    assert(choiceBackground); assert(resources.resources.some(resource => resource.sha256 === choiceBackground.sha256));
    for (const method of ["touch", "back"]) {
      await tap('[data-testid="renpy-quick-hide"]', "hide choice UI " + method);
      await evalWait(`document.querySelector(".story-interface")?.dataset.hidden==="true"
        && document.querySelector(".story-interface")?.inert===true`, "hidden choice and actions inert");
      await shot("hidden-choice-" + method);
      if (method === "touch") await tap(".story-player", "restore without selecting branch");
      else await back("system BACK restores hidden choice");
      await evalWait(`document.querySelector(".story-interface")?.dataset.hidden==="false"`, "choice UI restored");
      assert.deepEqual(await c.getClient().evaluate(`({command:document.querySelector(".story-player").dataset.currentCommandIndex,
        choices:[...document.querySelectorAll(".choice-panel button")].map(e=>e.textContent)})`), before);
    }
    await tap(".choice-panel button:first-of-type", "real GUI-backed branch choice");
    await evalWait(`Number(document.querySelector(".story-player")?.dataset.currentCommandIndex)===0`, "branch scene loop completed");
    assert.deepEqual(await position(), first); await barGeometry(c); await shot("branch-loop-restored");
    return { before, resources, methods: ["touch", "BACK"], sceneLoop: true };
  });
  await step("Renpy Activity finishes and immediately recreates a usable cached Runtime twice", async () => {
    await tap('[data-testid="renpy-quick-settings"]', "settings before normal native exit");
    await evalWait(`Boolean(document.querySelector(".settings-screen"))`, "settings before exit");
    await tap('[data-testid="open-exit-confirmation"]', "request confirmed native exit");
    await evalWait(`Boolean(document.querySelector('[data-testid="confirm-exit-game"]'))`, "exit confirmation");
    await shot("renpy-first-exit-confirmation");
    return currentExitVerifier()({ ...c, first });
  });
}
module.exports = { verifyRenpyOfficialFlow, currentExitVerifier, isManagedResourceUrl };
if (require.main === module && process.argv[2] === "--self-test") {
  for (const value of ["http://agentvn-resource.localhost/content/assets/ui/main_menu.png",
    "blob:http://tauri.localhost/fixture", "agentvn-resource://localhost/content/asset"])
    assert(isManagedResourceUrl(value));
  for (const value of ["https://example.com/image.png", "http://agentvn-resource.localhost.evil/img",
    "http://user:password@agentvn-resource.localhost/asset", "invalid", "data:text/html,test"])
    assert(!isManagedResourceUrl(value));
  currentExitVerifier();
  console.log(JSON.stringify({ status: "PASS", managedResourceProtocols: 3, unrelatedUrlsRejected: 5,
    currentExitLoaded: true, deviceOperations: 0 }));
}
