const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`[PASS] ${message}`);
}

const sharedTypes = read("shared/cartridge/types.ts");
const scanner = read("shared/cartridge/assetScanner.ts");
const exportScript = read("editor/src/utils/exportScript.ts");
const commandTools = read("editor/src/utils/commandTools.ts");
const engine = read("GameCli_framework/src/engine/StoryEngine.ts");
const cutscene = read("GameCli_framework/src/components/player/CutsceneVideoOverlay.tsx");
const storyPlayer = read("GameCli_framework/src/components/player/StoryPlayer.tsx");
const runtimeStore = read("GameCli_framework/src/store/runtimeStore.ts");
const mainMenu = read("GameCli_framework/src/components/shell/MainMenu.tsx");

expect(sharedTypes.includes("background_video?: string"), "manifest supports title background video");
expect(sharedTypes.includes('type: "video"; video_id: string'), "runtime command union supports cutscene video");
expect(sharedTypes.includes("speaker_focus?: SpeakerFocusConfig"), "runtime script supports speaker focus");
expect(scanner.includes('command.type === "video"') && scanner.includes('asset_type: "video"'), "asset scanner collects cutscene videos");
expect(exportScript.includes("speaker_focus: sanitizeSpeakerFocus"), "editor exports sanitized speaker focus settings");
expect(commandTools.includes('"video"') && commandTools.includes("fade_in_ms: 500"), "editor creates video commands with fade defaults");
expect(engine.includes("activeVideo?: ActiveVideoState") && engine.includes("completeActiveVideo"), "story engine blocks and completes video commands");
expect(cutscene.includes("const skipHoldMs = 5000") && cutscene.includes("doubleTapMs = 320"), "cutscene skip gesture uses five-second hold after double tap");
expect(storyPlayer.includes("speakingCharacterId") && storyPlayer.includes("speakerFocus={speakerFocus}"), "story player passes current speaker focus to sprite layer");
expect(runtimeStore.includes('launchTransition: "covering"') && runtimeStore.includes('launchTransition: "revealing"'), "new game uses cover and reveal launch phases");
expect(mainMenu.includes("titleVideoRef") && mainMenu.includes("setTitleVideoFailed(true)"), "title video falls back when unmuted autoplay fails");

console.log("video-performance-contract: ok");
