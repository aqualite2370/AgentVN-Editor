const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const outDir = path.join(root, "output", "playwright", "pc-text-image-layout");
const url = "http://127.0.0.1:6868/?mode=preview";

function assert(condition, message, details) { if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`); }
function fixture() {
  const image = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='240'><rect width='1600' height='240' fill='%231b2638'/></svg>";
  const imageReference = "asset:ui_frame";
  const now = new Date().toISOString();
  const makeSkin = (withImages) => ({ ui_layout_version: "1.0.0", name: "PC Text Image", target_runtime: "0.2.0", assets: [], tokens: { colorBackground: "#060812", colorSurface: "#111827", colorSurfaceStrong: "#1f2937", colorInk: "#f8fafc", colorMuted: "#94a3b8", colorAccent: "#60a5fa", colorAccent2: "#f59e0b", colorLine: "#64748b", colorPanel: "#111827", colorPanelText: "#f8fafc", colorControl: "#1e293b", colorControlHover: "#334155", colorControlActive: "#2563eb", colorControlText: "#f8fafc", colorDialog: "#020617", colorDialogText: "#f8fafc", colorSpeakerPlate: "#1e3a8a", colorSpeakerText: "#f8fafc", colorChoice: "#1e293b", colorChoiceText: "#f8fafc", colorQuickMenu: "#020617", colorFocus: "#93c5fd", radius: 10, fontScale: 1 }, screens: [{ screen_id: "title", components: [] }, { screen_id: "player", components: [
    { component_id: "stage_background", component_type: "stage_background", rect: { x: 0, y: 0, width: 100, height: 100 } },
    { component_id: "dialog_panel", component_type: "dialog_panel", rect: { x: 4, y: 68, width: 92, height: 26 }, style: withImages ? { backgroundImage: imageReference, backgroundFit: "cover", backgroundColor: "#020617", borderColor: "#fff", borderWidth: 3, shadow: "strong" } : { backgroundColor: "#020617", borderColor: "#fff", borderWidth: 3, shadow: "strong" } },
    { component_id: "speaker_label", component_type: "speaker_label", rect: { x: 7, y: 72, width: 18, height: 6 }, style: { fontSize: 18 } },
    { component_id: "dialog_text", component_type: "dialog_text", rect: { x: 7, y: 78, width: 82, height: 12 }, style: { fontSize: 24 } },
    { component_id: "continue_indicator", component_type: "continue_indicator", rect: { x: 82, y: 89, width: 12, height: 4 }, style: { fontSize: 12 } },
    { component_id: "choice_list", component_type: "choice_list", rect: { x: 50, y: 40, width: 58, height: 30, anchor: "center" }, style: withImages ? { backgroundImage: imageReference, backgroundFit: "cover", backgroundColor: "#020617", borderColor: "#fff", borderWidth: 3, shadow: "strong" } : undefined },
    { component_id: "choice_option", component_type: "choice_option", rect: { x: 0, y: 0, width: 100, height: 24 }, style: withImages ? { backgroundImage: imageReference, backgroundFit: "cover", backgroundColor: "#020617", borderColor: "#fff", borderWidth: 3, shadow: "strong", fontSize: 24 } : { fontSize: 24 } },
    { component_id: "quick_menu", component_type: "quick_menu", rect: { x: 98, y: 2, width: 48, height: 8, anchor: "top_right" } },
  ] }] });
  return { image, assetUrls: { ui_frame: image }, manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.2.0", game_id: "pc-text-image", title: "PC Text Image", author: "QA", version: "1.0.0", description: "", language: "zh-CN", entry_script: "script.json", entry_scene_id: "scene_main", assets: [{ asset_id: "ui_frame", path: "assets/ui-frame.svg", asset_type: "ui" }], created_at: now, updated_at: now }, script: { schema_version: "1.0.0", game_id: "pc-text-image", title: "PC Text Image", entry_scene_id: "scene_main", characters: [{ character_id: "hero", name: "Hero" }], scenes: [{ scene_id: "scene_main", title: "Main", chapter: 1, tags: [], commands: [{ type: "dialog", character_id: "hero", speaker: "Hero", text: "这是用于 PC 字号和图片接管模式的长对白。" }, { type: "choice", choices: [{ choice_id: "a", text: "选择一" }, { choice_id: "b", text: "选择二" }] }] }] }, makeSkin };
}

async function waitServer() { for (let i = 0; i < 80; i += 1) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); } throw new Error("Vite server not ready"); }

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev"], { cwd: runtimeRoot, windowsHide: true, stdio: "ignore" });
  try {
    await waitServer();
    const browser = await chromium.launch({ headless: true });
    const results = {};
    for (const viewport of [{ name: "pc-1280", width: 1280, height: 720 }, { name: "pc-1920", width: 1920, height: 1080 }, { name: "pc-2560", width: 2560, height: 1440 }, { name: "android", width: 1304, height: 600 }]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.name === "android", hasTouch: viewport.name === "android", userAgent: viewport.name === "android" ? "Mozilla/5.0 Android" : undefined });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const payload = fixture();
      await page.evaluate((message) => window.postMessage(message, "*"), { type: "agentvn.live-preview.init", protocolVersion: 1, revision: 1, manifest: payload.manifest, script: payload.script, uiSkin: payload.makeSkin(true), assetUrls: payload.assetUrls, screen: "playing" });
      await page.evaluate(() => window.postMessage({ type: "agentvn.runtime.screen", screen: "playing" }, "*"));
      await page.waitForSelector(".dialog-box", { timeout: 20000 });
      const sample = await page.evaluate(() => { const scope = document.querySelector(".ui-skin-scope"); const text = document.querySelector(".dialog-text"); const dialog = document.querySelector(".dialog-box"); const css = getComputedStyle(dialog); return { platform: scope?.getAttribute("data-runtime-platform"), formFactor: scope?.getAttribute("data-ui-form-factor"), textScale: scope?.getAttribute("data-ui-text-scale"), fontSize: getComputedStyle(text).fontSize, frameMode: dialog?.getAttribute("data-ui-frame-mode"), backgroundColor: css.backgroundColor, borderWidth: css.borderWidth, boxShadow: css.boxShadow }; });
      results[viewport.name] = sample;
      await page.screenshot({ path: path.join(outDir, `${viewport.name}.png`) });
      assert(sample.frameMode === "image_owned", `${viewport.name} did not enter image-owned mode`, sample);
      assert(sample.backgroundColor === "rgba(0, 0, 0, 0)" || sample.backgroundColor === "transparent", `${viewport.name} retained dialog background`, sample);
      assert(sample.borderWidth === "0px", `${viewport.name} retained dialog border`, sample);
      await context.close();
    }
    assert(results["pc-1920"].fontSize !== results.android.fontSize, "PC and Android text scales are still identical", results);
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ ok: true, results }, null, 2));
    await browser.close();
    console.log(`PC text/image acceptance passed: ${outDir}`);
  } finally { try { execFileSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { vite.kill(); } }
})().catch((error) => { console.error(error); process.exit(1); });
