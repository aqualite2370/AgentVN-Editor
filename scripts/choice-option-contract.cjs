const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const typeSource = fs.readFileSync(path.join(root, "shared/cartridge/uiSkin.ts"), "utf8");
const runtime = fs.readFileSync(path.join(root, "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx"), "utf8");
const panel = fs.readFileSync(path.join(root, "GameCli_framework/src/components/player/ChoicePanel.tsx"), "utf8");
const playerCss = fs.readFileSync(path.join(root, "GameCli_framework/src/styles/player.css"), "utf8");
if (!typeSource.includes('"choice_option"')) throw new Error("共享 UI 协议缺少 choice_option");
if (!runtime.includes('"choice_option"')) throw new Error("运行时未支持 choice_option");
if (!panel.includes('useUILayoutStyle("player", "choice_option")')) throw new Error("选项按钮未使用独立样式");
if (!panel.includes("...optionLayout.style")) throw new Error("选项按钮未应用独立背景样式");
const imageOwnedStateBlocks = [...playerCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, selector]) => selector.includes('.choice-panel[data-ui-frame-mode="image_owned"]')
    && /:(?:hover|focus-visible|active)/.test(selector));
if (!imageOwnedStateBlocks.length) throw new Error("Missing image-owned choice interaction styles");
for (const [, , body] of imageOwnedStateBlocks) {
  if (/background-image\s*:/i.test(body)) {
    throw new Error("Image-owned choices must preserve their own background image during hover/focus");
  }
}
if (!panel.includes('"--renpy-choice-authored-image": resolvedOptionStyle.backgroundImage')) {
  throw new Error("Image-owned choice must expose its resolved local image ahead of shared GUI state images");
}
const renpyImageBlocks = [...playerCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, selector, body]) => selector.includes('.ui-skin-scope[data-layout-type="renpy"]')
    && selector.includes(".choice-panel .ui-button.choice-option")
    && /background-image\s*:\s*var\(--renpy-button-image-/.test(body));
if (renpyImageBlocks.length) throw new Error("Shared Ren'Py state image must not override an authored choice image");
console.log("choice option contract: PASS");
