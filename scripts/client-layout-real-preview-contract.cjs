const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const sharedTypes = read("shared/cartridge/types.ts");
const editorProjectTypes = read("editor/src/types/project.ts");
const exportCartridge = read("editor/src/cartridge/exportCartridge.ts");
const projectStore = read("editor/src/store/projectStore.ts");
const settingsScreen = read("GameCli_framework/src/components/shell/SettingsScreen.tsx");
const aboutScreen = read("GameCli_framework/src/components/shell/AboutScreen.tsx");
const previewPanel = read("editor/src/components/editor/PreviewPanel.tsx");
const runtimeApp = read("GameCli_framework/src/app/App.tsx");

assert(sharedTypes.includes("export interface AboutPanelCopy"), "shared manifest types must expose AboutPanelCopy");
assert(sharedTypes.includes("about?: AboutPanelCopy"), "manifest.shell must include about copy overrides");
assert(editorProjectTypes.includes("about?: AboutPanelCopy"), "project package appearance must persist about copy overrides");
assert(projectStore.includes("sanitizeAboutPanelCopy"), "project store must sanitize about copy overrides");
assert(exportCartridge.includes("about: appearance?.about"), "export must carry about copy from project settings");
assert(exportCartridge.includes("about: runtimeVisuals.appearance.about"), "manifest shell must receive about copy");

assert(settingsScreen.includes("mergeSettingsPanelStyle"), "settings screen must merge shell background after layout styles");
assert(settingsScreen.includes("layoutWithoutBackground"), "settings background merge must remove layout background overrides");
assert(aboutScreen.includes("aboutCopy = game?.manifest.shell?.about"), "about screen must read manifest shell about copy");
assert(aboutScreen.includes("aboutCopy?.fields?.filter")
  && aboutScreen.includes("<dt>{field.label}</dt>")
  && aboutScreen.includes("<dd>{field.value}</dd>"),
  "about screen must render custom field labels and values");

assert(previewPanel.includes("<iframe"), "editor preview panel must embed GameCLI iframe");
assert(previewPanel.includes("agentvn.live-preview.init")
  && previewPanel.includes("agentvn.live-preview.patch")
  && runtimeApp.includes("agentvn.live-preview.init"),
  "node preview and runtime must share the live init/patch protocol");
assert(previewPanel.includes("agentvn.runtime.screen"), "editor preview panel must send runtime screen switch messages");
assert(previewPanel.includes("previewScreens"), "editor preview panel must expose page switching controls");
assert(runtimeApp.includes("agentvn.runtime.screen"), "GameCLI runtime must receive embedded screen switch messages");
assert(runtimeApp.includes("openPreviewScreen"), "GameCLI runtime must route embedded screen switch messages through the store");

console.log("client layout real preview contract OK");
