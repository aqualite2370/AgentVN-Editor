const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const runtime = read("GameCli_framework/src/uiSkin/uiSkinRuntime.tsx");
const mainMenu = read("GameCli_framework/src/components/shell/MainMenu.tsx");
const shellCss = read("GameCli_framework/src/styles/shell.css");
const layoutDesigner = read("editor/src/components/advanced/RuntimeLayoutDesigner.tsx");
const viewport = read("GameCli_framework/src/uiSkin/runtimeViewport.ts");
const viewportMath = read("GameCli_framework/src/uiSkin/runtimeViewportMath.mjs");
const html = read("GameCli_framework/index.html");
const androidJavaRoot = path.join(root, "GameCli_framework/src-tauri/gen/android/app/src/main/java");
const activityPath = (() => {
  const candidates = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile() && entry.name === "MainActivity.kt") candidates.push(next);
    }
  };
  walk(androidJavaRoot);
  return candidates[0] || "";
})();
const activity = activityPath ? fs.readFileSync(activityPath, "utf8") : "";
const manifestPath = path.join(root, "GameCli_framework/src-tauri/gen/android/app/src/main/AndroidManifest.xml");
const androidBuildScript = read("scripts/build-runtime-standalone-android.ps1");
// The standalone builder applies the release manifest policy after Tauri
// generates gen/android. A checked-in generated manifest can predate that
// build step, so contract-test the source policy rather than stale output.
const manifest = androidBuildScript;
// The standalone builder owns the generated Activity template. The checked-in
// gen/android tree may be a stale local build artifact and must not be edited
// or treated as the source of truth for this contract.
const activitySource = androidBuildScript;
const buildScript = read("scripts/build-runtime-standalone-android.ps1");
const playerCss = read("GameCli_framework/src/styles/player.css");
const choicePanel = read("GameCli_framework/src/components/player/ChoicePanel.tsx");
const dialogBox = read("GameCli_framework/src/components/player/DialogBox.tsx");
const variablesCss = read("GameCli_framework/src/styles/variables.css");
const appCss = read("GameCli_framework/src/app/App.css");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/interface RuntimeViewportState/.test(viewport), "RuntimeViewportState contract is missing");
assert(/agentvn:android-insets/.test(viewport), "Android inset event is not consumed");
assert(/visualViewport/.test(viewport), "visualViewport must drive handheld viewport sizing");
assert(/resolveBrowserViewportSize/.test(viewport), "handheld runtime must prefer the browser visual viewport over a stale document-root measurement");
assert(/syncHandheldDocumentViewport/.test(viewport) && /style\.setProperty\(["']height["']/.test(viewportMath), "handheld runtime must pin document dimensions to the recovered visual viewport");
assert(/visibilitychange/.test(viewport), "runtime viewport must remeasure when the Android WebView becomes visible again");
assert(/pageshow/.test(viewport), "runtime viewport must remeasure when the Android WebView page is restored");
assert(/window\.addEventListener\(["']focus["']/.test(viewport), "runtime viewport must remeasure when the Android WebView regains focus");
assert(/android-surface-ready/.test(viewport), "runtime viewport must wait for the native landscape surface-ready event");
assert(/ready:\s*boolean/.test(viewport), "runtime viewport readiness state is missing");
assert(/data-ui-viewport-ready/.test(runtime), "runtime viewport readiness audit attribute is missing");
assert(/data-ui-viewport-phase/.test(runtime), "runtime viewport phase audit attribute is missing");
assert(/useLandscapeLock\(formFactor === ["']handheld["']/.test(runtime), "all handheld runtime screens must keep the native landscape lock active");
assert(/agentvn:android-resume/.test(runtime) && /requestLandscape/.test(runtime), "Android resume must reapply the browser landscape lock");
assert(/stableAndroidViewportStyle/.test(runtime) && /viewportWidth/.test(runtime) && /viewportHeight/.test(runtime), "Android shell must keep rendering against the last stable viewport while the native surface rotates");
assert(/platform === ["']android["']/.test(viewport), "Android must be classified as handheld/mobile independent of CSS pixels");
assert(/--runtime-safe-top/.test(runtime) && /--runtime-safe-bottom/.test(runtime), "runtime safe-area CSS variables are missing");
assert(/data-ui-form-factor/.test(runtime) && /data-runtime-platform/.test(runtime), "runtime platform audit attributes are missing");
assert(/viewport-fit=cover/.test(html), "viewport-fit=cover is required for edge-to-edge safe areas");
assert(!/mobile_fallback/.test(runtime) && !/explicit_mobile/.test(runtime), "runtime must not keep mobile layout fallback branches");
assert(/safe_clamped/.test(runtime) && /sourceRect = component\.rect/.test(runtime), "runtime must clamp the single PC authored rect to safe bounds");
assert(/data-ui-layout-source/.test(mainMenu), "title actions must expose layout source for geometry audits");
assert(/zIndex:\s*10/.test(mainMenu), "title hero content must remain below decorative masks");
assert(/Math\.min\(Math\.max\(component\.zIndex \?\? 20,\s*20\) \+ index,\s*29\)/.test(mainMenu), "title masks must remain above hero content and below actions");
assert(/\.main-menu-title-mask[\s\S]*z-index:\s*20/.test(shellCss), "title mask CSS fallback must sit above title content");
assert(/component\.component_type === "main_menu_hero"\) return 10/.test(layoutDesigner), "layout designer title hero preview must remain below masks");
assert(/data-ui-layout-source/.test(read("GameCli_framework/src/components/player/PlaybackControls.tsx")), "quick menu must expose layout source for geometry audits");
assert(fs.existsSync(manifestPath), "generated Android manifest is required for native runtime contract");
assert(activityPath || /class MainActivity : TauriActivity/.test(androidBuildScript), "Android MainActivity source/template is required for native runtime contract");
assert(/orientationAttribute\.Value\s*=\s*"sensorLandscape"/.test(manifest), "Android manifest policy must lock the client to sensorLandscape");
assert(/WindowInsetsCompat\.Type\.displayCutout/.test(activitySource) && /agentvn:android-insets/.test(activitySource), "Android native WindowInsets must reach the WebView");
assert(/override fun onResume\(\)/.test(activitySource), "Android runtime must restore immersive landscape after screen unlock");
assert(/onResume\(\)[\s\S]*applyImmersiveLandscape\(\)[\s\S]*requestApplyInsets/.test(activitySource), "Android resume must reapply immersive mode and request fresh WindowInsets");
assert(/requestedOrientation\s*=\s*ActivityInfo\.SCREEN_ORIENTATION_SENSOR_LANDSCAPE/.test(activitySource), "Android activity must request landscape before WebView layout");
assert(/agentvn:android-surface-ready/.test(activitySource), "Android activity must dispatch a landscape surface-ready event");
assert(/onConfigurationChanged/.test(activitySource), "Android activity must reapply landscape policy after configuration changes");
assert(/window\.navigationBarColor\s*=\s*Color\.BLACK/.test(activitySource), "Android navigation bar background must be black");
assert(/controller\.isAppearanceLightNavigationBars\s*=\s*false/.test(activitySource), "Android navigation bar icons must use dark-background mode");
assert(/controller\.hide\(WindowInsetsCompat\.Type\.systemBars\(\)\)/.test(activitySource), "Android must hide system bars in immersive fullscreen");
assert(/html,[\s\S]*body[\s\S]*background:\s*#000/.test(variablesCss), "the WebView document background must be black");
assert(/#root[\s\S]*min-height:\s*100dvh[\s\S]*background:\s*#000/.test(appCss), "the React root must fill the dynamic viewport with black");
assert(/Apply-AndroidRuntimePolicy/.test(buildScript), "standalone Android build must reapply generated runtime policy");
assert(/RuntimeTextScale/.test(viewport), "runtime text scale interface is missing");
assert(/image_owned/.test(runtime) && /missing_asset_fallback/.test(runtime), "layout visual mode handling is missing");
assert(
  /\["dialog_panel",\s*"choice_list",\s*"choice_option",\s*"quick_button",\s*"main_menu_custom_button"\]\.includes/.test(runtime),
  "image-owned visual mode must include quick buttons and custom title buttons as well as dialog and choice frames",
);
assert(/data-ui-frame-mode/.test(dialogBox), "dialog visual mode audit attribute is missing");
assert(/data-ui-frame-mode/.test(choicePanel), "choice visual mode audit attribute is missing");
assert(/backgroundColor: "transparent"|background-color: transparent/.test(playerCss), "image-owned transparent frame CSS is missing");

console.log("android runtime viewport contract: PASS");
