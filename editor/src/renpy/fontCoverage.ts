import type { EditorNode } from "../types/nodes";
import type { UISkinLayout } from "../../../shared/cartridge/uiSkin";
import type { CustomComponentNode } from "../../../shared/cartridge/customComponent";
import { compileControlPresentation, layoutPresentationTargets } from "../../../shared/cartridge/controlPresentation";

export interface FontCoverageResult {
  totalCharacters: number;
  coveredCharacters: number;
  missingCharacters: number;
  missingSamples: Array<{ character: string; codePoint: string }>;
}

const runtimeLabels = [
  "开始游戏", "继续游戏", "存档", "读档", "设置", "选项", "返回", "确定", "取消",
  "历史", "关于", "帮助", "画廊", "回退", "快进", "自动", "快存", "快读", "隐藏",
  "音乐", "音效", "语音", "窗口模式", "全屏",
];

function addText(values: string[], value: unknown): void {
  if (typeof value === "string" && value.trim()) values.push(value);
}

export function collectRenpyFontCoverageText(
  title: string,
  author: string,
  characterNames: string[],
  nodes: EditorNode[],
  layout?: UISkinLayout,
): string {
  const values: string[] = [];
  addText(values, title);
  addText(values, author);
  characterNames.forEach((name) => addText(values, name));

  for (const node of nodes) {
    addText(values, node.data.label);
    const scene = node.data.scene;
    if (!scene) continue;
    addText(values, scene.title);
    addText(values, scene.scene_display_name);
    addText(values, scene.summary);
    addText(values, scene.ending_title);
    for (const command of scene.commands) {
      if (command.type === "dialog" || command.type === "narration") {
        addText(values, command.text);
      } else if (command.type === "choice") {
        for (const choice of command.choices) {
          addText(values, choice.choice_display_name);
          addText(values, choice.text);
        }
      } else if (command.type === "show_image") {
        addText(values, command.caption);
        addText(values, command.alt);
      } else if (command.type === "background") {
        addText(values, command.transition_display_name);
      } else if (command.type === "animation") {
        addText(values, command.animation_display_name);
      }
    }
  }

  // Use the whole active draft, not only the selected page. A font can otherwise
  // falsely appear complete until the player opens a different authored page.
  if (layout) {
    addText(values, layout.renpyTitleText?.title?.text);
    addText(values, layout.renpyTitleText?.version?.text);
    const addComponentText = (node: CustomComponentNode) => {
      addText(values, node.text);
      node.children.forEach(addComponentText);
    };
    for (const screen of layout.screens) for (const component of screen.components) {
      addText(values, component.label);
      if (component.customComponent) addComponentText(component.customComponent.root);
    }
    if (layout.advancedPresentationEnabled) for (const target of layoutPresentationTargets(layout)) {
      const compiled = compileControlPresentation(target.source);
      if (compiled.ok && compiled.definition) addComponentText(compiled.definition.root);
    }
  }
  values.push(...runtimeLabels);
  return [...new Set(values)].join("\n");
}

function isNonRenderingControl(codePoint: number): boolean {
  return codePoint <= 0x1f
    || (codePoint >= 0x7f && codePoint <= 0x9f)
    || (codePoint >= 0x200b && codePoint <= 0x200f)
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2060 && codePoint <= 0x206f)
    || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
}

export function analyzeFontCharacterCoverage(
  supportedCodePoints: Iterable<number>,
  text: string,
): FontCoverageResult {
  const supported = new Set(supportedCodePoints);
  const characters = [...new Set(Array.from(text, (character) => character.codePointAt(0)!)
    .filter((codePoint) => !isNonRenderingControl(codePoint)))];
  const missing = characters.filter((codePoint) => !supported.has(codePoint));
  return {
    totalCharacters: characters.length,
    coveredCharacters: characters.length - missing.length,
    missingCharacters: missing.length,
    missingSamples: missing.slice(0, 24).map((codePoint) => ({
      character: String.fromCodePoint(codePoint),
      codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
    })),
  };
}
