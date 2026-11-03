const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const app = read("GameCli_framework/src/app/App.tsx");
const storyPlayer = read("GameCli_framework/src/components/player/StoryPlayer.tsx");
const choiceEditor = read("editor/src/components/command-editors/ChoiceCommandEditor.tsx");
const choiceStudio = read("editor/src/components/command-editors/ChoiceButtonStyleStudioDialog.tsx");
const editorCommands = read("editor/src/types/commands.ts");
const runtimeCommands = read("GameCli_framework/src/types/commands.ts");
const sharedTypes = read("shared/cartridge/types.ts");
const choicePanel = read("GameCli_framework/src/components/player/ChoicePanel.tsx");
const storyEngine = read("GameCli_framework/src/engine/StoryEngine.ts");
const runtimeLayoutDesigner = read("editor/src/components/advanced/RuntimeLayoutDesigner.tsx");

assert(/<RuntimeAudio\s*\/>/.test(app), "RuntimeAudio must be mounted at the app shell so menu screens do not restart BGM.");
assert(!/<RuntimeAudio\s*\/>/.test(storyPlayer), "StoryPlayer must not own RuntimeAudio.");

assert(!/data-help-key="command\.choice\.choiceId"/.test(choiceEditor), "Choice IDs must stay internal in the regular editor.");
assert(!/data-help-key="command\.choice\.targetSceneId"/.test(choiceEditor), "Choice target scene IDs must stay internal in the regular editor.");
assert(/编辑按钮样式/.test(choiceEditor), "Each choice row must expose the button style studio.");
assert(/ChoiceButtonStyleStudioDialog/.test(choiceEditor), "Choice editor must open the real-runtime style studio.");

for (const [label, source] of [
  ["editor", editorCommands],
  ["runtime", runtimeCommands],
]) {
  assert(/button_style\??:\s*UILayoutComponentStyle/.test(source), `${label} choice type must carry per-button style.`);
  assert(/interface ChoiceCommand[\s\S]*button_style\??:\s*UILayoutComponentStyle/.test(source), `${label} choice command must carry scene-wide style.`);
}
assert(/button_style\??:\s*UILayoutComponentStyle/.test(sharedTypes), "shared choice type must carry per-button style.");
assert(/\{\s*type:\s*"choice";\s*choices:\s*Choice\[\];\s*button_style\??:\s*UILayoutComponentStyle\s*\}/.test(sharedTypes), "shared choice command must carry scene-wide style.");

assert(/useResolvedUILayoutStyle/.test(choicePanel), "ChoicePanel must resolve command and per-button style through the runtime UI renderer.");
assert(/command\.button_style/.test(storyEngine), "StoryEngine must merge the scene-wide choice style into visible choices.");

assert(/<iframe/.test(choiceStudio), "Choice style studio must render the real GameCLI in an iframe.");
assert(/只应用这个按钮/.test(choiceStudio), "Style studio must support the single-button scope.");
assert(/当前场景所有按钮/.test(choiceStudio), "Style studio must support the current-scene scope.");
assert(/整个工程/.test(choiceStudio), "Style studio must support the project scope.");
assert(/stretch/.test(choiceStudio) && /cover/.test(choiceStudio) && /contain/.test(choiceStudio), "Style studio must expose stretch, cover and contain image presets.");
assert(
  /function isLayoutEditableComponent[\s\S]*component\.component_type !== "choice_option"/.test(runtimeLayoutDesigner),
  "The client layout designer must treat choice_option as a style-only template.",
);
assert(
  /const layoutComponents = screen\.components\.filter\(component => \(isLayoutEditableComponent\(component\)\s*\|\| \(layoutType === "renpy" && component\.component_type === "choice_option"\)\)/.test(runtimeLayoutDesigner),
  "AgentVN must keep choice geometry excluded; Ren'Py must expose its approved style-only choice editor.",
);
assert(
  /function isStyleOnlyComponent[\s\S]*component\.component_type === "choice_option"/.test(runtimeLayoutDesigner)
    && /const selectedRect = selected && !selectedIsStyleOnly \? getRect\(selected\) : undefined/.test(runtimeLayoutDesigner)
    && /onPointerDown=\{styleOnly \|\| previewOwnsInteraction \? undefined/.test(runtimeLayoutDesigner),
  "Selecting a Ren'Py choice style must not enable free geometry editing or dragging.",
);

console.log("Choice button style contract passed.");
