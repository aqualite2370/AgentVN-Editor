"use strict";
// Controlled compatibility regression at the real Runtime preview seam.
// Deliberate DOM disabled/selected state probes are not real gameplay evidence.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), sha = b => crypto.createHash("sha256").update(b).digest("hex");
const output = process.env.AGENTVN_WORKSPACE_OUTPUT;
assert(output && path.resolve(output).startsWith("F:\\AgentVN\\QA\\Official-GUI-Consumption-20261020-01\\"));
assert(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
const exportedFile = process.env.AGENTVN_GUI_EDITOR_REPORT; assert(exportedFile && process.env.AGENTVN_TEST_PROJECT);
const exported = JSON.parse(fs.readFileSync(exportedFile, "utf8")); assert.equal(exported.status, "PASS");
const original = exported.cases[0].cartridge;
assert.equal(sha(fs.readFileSync(original.path)), original.sha256);
const report = { status: "RUNNING", at: new Date().toISOString(), cases: [], modelRequests: 0, original,
  testSha256: sha(fs.readFileSync(__filename)),
  scope: "CONTROLLED_PUBLIC_LIVE_PREVIEW_FIXTURES_AND_DOM_STATE_PROBES_NOT_EDITOR_AUTHORING_OR_INSTALLED_GAMEPLAY" };
let browser, server;
function svg(color) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40"><rect width="64" height="40" fill="${color}"/></svg>`);
}
async function image(button) {
  return button.evaluate(async n => {
    const c = getComputedStyle(n), source = c.backgroundImage !== "none" ? c.backgroundImage : c.borderImageSource;
    const url = source.match(/url\(["']?(.*?)["']?\)/)?.[1];
    if (!url) throw Error(`No rendered image: ${source}`);
    const bytes = await (await fetch(url)).arrayBuffer();
    return { hash: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map(x => x.toString(16).padStart(2, "0")).join(""), backgroundImage: c.backgroundImage,
      borderImageSource: c.borderImageSource, frame: n.dataset.renpyButtonFrame || null,
      disabled: n.disabled, selected: n.getAttribute("aria-current") };
  });
}
(async () => {
  fs.copyFileSync(__filename, path.join(output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const zip = await JSZip.loadAsync(fs.readFileSync(original.path));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const uiSkin = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const assetUrls = {};
  for (const a of manifest.assets) assetUrls[a.asset_id] = `data:${a.mime_type};base64,${await zip.file(a.path).async("base64")}`;
  const localImageId = uiSkin.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "choice_option")
    .style.backgroundImage.slice("asset:".length);
  const localHash = original.assets.find(a => a.id === localImageId).sha256;
  const stateBytes = Object.fromEntries(Object.entries({ normal: "#804040", hover: "#408040", selected: "#404080", disabled: "#808040" })
    .map(([state, color]) => [state, svg(color)]));
  const alternate = svg("#804080"), alternateId = "qa-option-override";
  for (const [state, bytes] of [...Object.entries(stateBytes), ["override", alternate]]) {
    const id = state === "override" ? alternateId : `qa-state-${state}`;
    manifest.assets.push({ asset_id: id, asset_type: "ui", path: `assets/ui/${id}.svg`, filename: `${id}.svg`, mime_type: "image/svg+xml" });
    assetUrls[id] = `data:image/svg+xml;base64,${bytes.toString("base64")}`;
  }
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(output, "runtime.log") });
  report.service = { url: server.url, pid: server.pid, runId: server.runId };
  browser = await chromium.launch();
  for (const [width, height] of [[1920, 1080], [3840, 2160]]) for (const kind of [
    "layout-local", "command-local", "option-local", "shared-fallback", "shared-nine-slice", "agentvn-local",
  ]) {
    const item = { width, height, kind, status: "RUNNING", probes: [], errors: [] }; report.cases.push(item);
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on("pageerror", e => item.errors.push(String(e)));
    try {
      const skin = structuredClone(uiSkin);
      skin.renpy.shared.buttonImages = Object.fromEntries(Object.keys(stateBytes).map(state => [state, `asset:qa-state-${state}`]));
      skin.renpy.shared.buttonBorders = { top: 2, right: 2, bottom: 2, left: 2 };
      const component = skin.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "choice_option");
      if (kind.startsWith("shared-")) delete component.style.backgroundImage;
      if (kind !== "shared-nine-slice") delete skin.renpy.shared.buttonBorders;
      if (kind === "agentvn-local") delete skin.layout_type;
      const choices = [
        { choice_id: "a", text: "保护用例 A", target_scene_id: "next", conditions: [],
          ...(kind === "option-local" ? { button_style: { backgroundImage: `asset:${alternateId}` } } : {}) },
        { choice_id: "b", text: "保护用例 B", target_scene_id: "next", conditions: [] },
      ];
      const script = { schema_version: "1.1.0", game_id: manifest.game_id, title: "受控资源优先级", entry_scene_id: "main", characters: [],
        scenes: [{ scene_id: "main", title: "Main", chapter: 1, tags: [], commands: [
          { type: "choice", choices, ...(kind === "command-local" ? { button_style: { backgroundImage: `asset:${alternateId}` } } : {}) },
        ] }, { scene_id: "next", title: "Next", chapter: 1, tags: [], commands: [{ type: "narration", text: "保护用例已推进。" }] }] };
      await page.goto(`${server.url}/?mode=preview`);
      await page.waitForFunction(() => document.querySelector("#root")?.childElementCount);
      await page.evaluate(payload => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
        sessionId: `gui-protection-${Date.now()}`, revision: 1, requestId: "qa", runId: "qa", screen: "title_menu", ...payload }, "*"),
      { manifest: { ...manifest, entry_scene_id: "main" }, script, uiSkin: skin, assetUrls });
      await page.getByTestId("start-new-game").waitFor(); await settleRuntime(page);
      await page.getByTestId("start-new-game").click();
      const button = page.getByRole("button", { name: "选择：保护用例 A", exact: true });
      await button.waitFor(); await settleRuntime(page);
      const explicit = kind === "command-local" || kind === "option-local" ? sha(alternate) : localHash;
      for (const state of ["normal", "hover", "focus", "selected", "disabled"]) {
        await page.mouse.move(width - 10, 10);
        await button.evaluate(n => { n.blur(); n.disabled = false; n.removeAttribute("aria-current"); });
        if (state === "hover") await button.hover();
        if (state === "focus") await button.focus();
        if (state === "selected") await button.evaluate(n => n.setAttribute("aria-current", "true"));
        if (state === "disabled") await button.evaluate(n => { n.disabled = true; });
        const actual = await image(button), inherited = kind.startsWith("shared-");
        const stateName = state === "focus" ? "hover" : state;
        assert.equal(actual.hash, inherited ? sha(stateBytes[stateName]) : explicit, `${kind}/${state}: ${JSON.stringify(actual)}`);
        assert.equal(actual.frame, kind === "shared-nine-slice" ? "nine-slice" : null);
        item.probes.push({ state, ...actual });
      }
      await button.evaluate(n => { n.disabled = false; n.removeAttribute("aria-current"); });
      await button.click();
      await page.waitForFunction(() => document.querySelector(".dialog-text")?.textContent.includes("保护用例已推进"));
      assert.deepEqual(item.errors, []); assert.equal(item.probes.length, 5); item.status = "PASS";
    } catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); }
    finally {
      await context.close(); fs.writeFileSync(path.join(output, "progress.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ width, kind, status: item.status, error: item.error }));
    }
    if (item.status !== "PASS") throw Error(`Protection failed: ${kind}`);
  }
  assert.equal(report.cases.length, 12); assert(report.cases.every(c => c.status === "PASS" && c.probes.length === 5));
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await server?.stop();
  let responds = false;
  try { if (server) { await fetch(server.url, { signal: AbortSignal.timeout(1000) }); responds = true; } } catch {}
  report.cleanup = { responds, status: responds ? "FAILED" : "PASS" };
  if (responds) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output }));
});
