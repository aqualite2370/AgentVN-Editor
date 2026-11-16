"use strict";
// Read only the user's project metadata from its ZIP. Exercise its real layout
// with controlled narration, without extracting/copying the 940MB asset bundle.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(out) && out.startsWith("F:\\testavn\\"));
const source = "C:\\Users\\1\\Downloads\\隐忍的成长_20261109_003641.vnproj";
fs.mkdirSync(out, { recursive: true });
const temp = path.join(out, "temp"); fs.mkdirSync(temp);
process.env.TEMP = temp; process.env.TMP = temp;
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], errors: [],
  scope: "ACTUAL_USER_ZIP_LAYOUT_SOURCE_BROWSER_CONTROLLED_NARRATION_AND_ANDROID_INSETS_NOT_FULL_GAME_OR_PHYSICAL_PHONE",
  builds: 0, models: 0, productChanges: 0, sourceWrites: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function shaFile(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
let server, browser, page;
async function test(name, action) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save();
  try { await action(row); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { save(); }
}
async function geometry(p) {
  return p.evaluate(async () => {
    let previous = "", stable = 0;
    for (let i = 0; i < 180; i++) {
      await new Promise(requestAnimationFrame);
      const state = JSON.stringify([document.querySelector(".renpy-quick-bar")?.getBoundingClientRect(),
        document.querySelector(".dialog-text")?.getBoundingClientRect()]);
      stable = state === previous ? stable + 1 : 0; previous = state; if (stable >= 4) break;
    }
    const rect = element => element?.getBoundingClientRect().toJSON();
    const bar = document.querySelector(".renpy-quick-bar");
    return {
      frame: rect(document.querySelector(".runtime-layout-frame")), bar: rect(bar),
      text: rect(document.querySelector(".dialog-text")),
      placement: bar?.dataset.quickMenuPlacement,
      display: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      overflow: document.documentElement.scrollWidth - innerWidth,
      buttons: [...(bar?.querySelectorAll("button") || [])].map(button => {
        const box = button.getBoundingClientRect();
        return { label: button.textContent, rect: box.toJSON(), disabled: button.disabled,
          hit: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      }),
    };
  });
}
(async () => {
  report.source = { path: source, bytes: fs.statSync(source).size, sha256: await shaFile(source) };
  const metadata = JSON.parse(cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", `
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $qaArchive=[System.IO.Compression.ZipFile]::OpenRead('C:\\Users\\1\\Downloads\\隐忍的成长_20261109_003641.vnproj')
    try {
      $qaReader=[System.IO.StreamReader]::new($qaArchive.GetEntry('project.json').Open())
      try { $qaProject=$qaReader.ReadToEnd() | ConvertFrom-Json } finally { $qaReader.Dispose() }
      [pscustomobject]@{ projectId=$qaProject.project_id; title=$qaProject.title; nodes=$qaProject.nodes.Count;
        edges=$qaProject.edges.Count; profiles=$qaProject.editor_settings.runtimeUILayoutProfiles;
        activeLayout=$qaProject.editor_settings.runtimeUILayout } | ConvertTo-Json -Depth 100 -Compress
    } finally { $qaArchive.Dispose() }
  `], { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 }));
  assert.equal(metadata.title, "隐忍的成长"); assert.equal(metadata.nodes, 40); assert.equal(metadata.edges, 49);
  assert.equal(metadata.profiles.activeType, "renpy");
  const skin = metadata.profiles.profiles.renpy;
  const quick = skin.screens.find(screen => screen.screen_id === "player").components
    .find(component => component.component_id === "quick_menu");
  assert.equal(quick.rect.anchor, "top_right");
  assert.equal(quick.style.quickMenuPlacement, undefined, "Do not opt the user into custom position");
  report.author = { projectId: metadata.projectId, title: metadata.title, nodes: metadata.nodes, edges: metadata.edges,
    activeType: metadata.profiles.activeType, oldQuickRect: quick.rect,
    quickMenuPlacement: "UNSET_LEGACY_DEFAULT_BOTTOM" };
  fs.writeFileSync(path.join(out, "source-layout.json"), JSON.stringify(skin, null, 2), { flag: "wx" });
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(out, "runtime.log") });
  report.service = { pid: server.pid, runId: server.runId, url: server.url }; save();
  browser = await chromium.launch({ headless: true });
  const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr => [false, true]
    .map(reduced => ({ width, height: width * 9 / 16, dpr, reduced, aspect: "16:9", bottom: 0 }))));
  matrix.push(...[1920, 2400].flatMap(width => ["16:9", "16:10", "4:3"]
    .map(aspect => ({ width, height: 1080, dpr: 2, reduced: false, aspect, bottom: 32, mobile: true }))));
  for (const v of matrix) await test(`${v.width}x${v.height} DPR${v.dpr} ${v.reduced ? "reduce" : "normal"} ${v.aspect} ${v.mobile ? "controlled-mobile" : "desktop"}`, async row => {
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.dpr,
      reducedMotion: v.reduced ? "reduce" : "no-preference", hasTouch: Boolean(v.mobile),
      ...(v.mobile ? { userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36" } : {}) });
    try {
      page = await context.newPage(); page.setDefaultTimeout(30000);
      page.on("pageerror", error => report.errors.push(String(error)));
      if (v.mobile) await page.addInitScript(v => { window.AgentVNViewport = { requestInsets() {
        window.dispatchEvent(new CustomEvent("agentvn:android-insets", { detail: {
          top: 0, right: 0, left: 0, bottom: v.bottom * v.dpr, coordinateSpace: "physical", revision: 1,
        } }));
      } }; }, v);
      await page.goto(server.url + "/?mode=preview");
      await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
      const uiSkin = structuredClone(skin);
      uiSkin.gameViewport = { aspectRatio: v.aspect };
      await page.evaluate(payload => window.postMessage({
        type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "actual-project-layout",
        requestId: "actual-layout", runId: "actual-layout", revision: 1, screen: "playing", ...payload,
        start: { requestId: "actual-start", target: { sceneId: "main", commandIndex: 0 }, entryPath: [],
          mode: "stable_frame", playbackRate: 1, reducedMotion: false },
      }, "*"), { uiSkin, assetUrls: {},
        manifest: { manifest_version: "1.0.0", runtime_version: "0.32.0", game_id: "actual-project-layout",
          title: metadata.title, author: "QA", version: "1.0.0", language: "zh-CN",
          entry_script: "script.json", entry_scene_id: "main", assets: [] },
        script: { schema_version: "1.0.0", game_id: "actual-project-layout", title: metadata.title,
          entry_scene_id: "main", scenes: [{ scene_id: "main", title: "布局独立验收", commands: [
            { type: "narration", text: "以原工程布局验证快捷栏贴底与操作，不改动原剧情或素材。" },
            { type: "narration", text: "第二条用于验证恢复界面不推进剧情。" },
          ] }] },
      });
      await page.locator(".renpy-quick-bar").waitFor(); await settleRuntime(page);
      const g = row.geometry = await geometry(page);
      assert.deepEqual(g.display, { width: v.width, height: v.height, dpr: v.dpr, reduced: v.reduced });
      assert.equal(g.placement, "bottom"); assert.equal(g.buttons.length, 9);
      assert(g.buttons.every(button => button.hit), "All nine centers must be owned by the real buttons");
      assert(g.buttons.every(button => Math.abs(button.rect.top - g.bar.top) < 2), "Single row");
      assert(g.bar.left >= g.frame.left && g.bar.right <= g.frame.right + 1);
      const remainingInset = Math.max(0, v.bottom - (v.height - g.frame.bottom));
      const bottomGap = g.frame.bottom - g.bar.bottom;
      assert(bottomGap >= remainingInset - 1 && bottomGap <= remainingInset + g.frame.height * 0.04,
        `Bar must remain near the actual safe frame bottom: ${bottomGap}/${remainingInset}`);
      assert(g.text && g.text.height > 12 && g.text.bottom <= g.bar.top + 1, "Readable text above bar");
      assert(g.overflow <= 1);
      const expectedAspect = v.aspect.split(":").map(Number);
      assert(Math.abs(g.frame.width / g.frame.height - expectedAspect[0] / expectedAspect[1]) < 0.01);
      await page.getByTestId("renpy-quick-history").click(); await settleRuntime(page);
      await page.locator(".history-list").waitFor();
      await page.getByRole("button", { name: "返回", exact: true }).click(); await settleRuntime(page);
      await page.getByTestId("renpy-quick-hide").click();
      await page.waitForFunction(() => document.querySelector(".story-interface")?.getAttribute("data-hidden") === "true");
      await page.keyboard.press("h");
      await page.waitForFunction(() => document.querySelector(".story-interface")?.getAttribute("data-hidden") === "false");
      row.actions = ["history", "return", "hide", "restore"];
      if (v.width === 1920 && !v.mobile && v.dpr === 1 && !v.reduced) {
        row.screenshot = await captureSourceBrowser(page, path.join(out, "actual-layout.png"),
          { width: v.width, height: v.height, dpr: v.dpr, reduced: v.reduced });
      }
    } finally { await context.close(); page = undefined; }
    console.log(JSON.stringify({ name: row.name, status: row.status }));
  });
  assert.equal(report.cases.length, 18); assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
}).finally(async () => {
  try {
    await browser?.close(); await server?.stop();
    if (server) {
      assert.throws(() => process.kill(server.pid, 0));
      let responding = false; try { await fetch(server.url, { signal: AbortSignal.timeout(1000) }); responding = true; } catch {}
      assert(!responding);
    }
    assert.equal(await shaFile(source), report.source.sha256);
    report.cleanup = "OWNED_BROWSER_AND_SERVICE_STOPPED_SOURCE_BYTES_UNCHANGED";
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, out }));
});
