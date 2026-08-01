import type { RuntimeScript } from "../../../shared/cartridge/types";

type RuntimeCommand = RuntimeScript["scenes"][number]["commands"][number];

const atmosphereCommandTypes = new Set(["background", "narration", "bgm", "sfx", "camera", "animation", "wait"]);
const textCommandTypes = new Set(["narration", "dialog"]);

function isAtmosphereCommand(command: RuntimeCommand): boolean {
  return atmosphereCommandTypes.has(command.type);
}

function isTextCommand(command: RuntimeCommand): boolean {
  return textCommandTypes.has(command.type);
}

function commandTextLength(command: RuntimeCommand): number {
  if (command.type === "narration" || command.type === "dialog") return command.text.trim().length;
  return 0;
}

function firstPlayableCommands(scene: RuntimeScript["scenes"][number], count = 8): RuntimeCommand[] {
  return scene.commands.filter((command) => command.type !== "state_update").slice(0, count);
}

export interface OpeningPerformanceScore {
  score: number;
  level: "rough" | "adequate" | "polished" | "excellent";
  issues: string[];
  details: {
    entrySceneId: string;
    firstSpriteIndex: number;
    firstTextIndex: number;
    firstCommands: string[];
    atmosphereBeforeFirstSprite: number;
    spritesBeforeFirstText: number;
    openingTextLength: number;
    hasBackground: boolean;
    hasPacing: boolean;
  };
}

export function scoreOpeningPerformance(script: RuntimeScript): OpeningPerformanceScore {
  const entryScene = script.scenes.find((scene) => scene.scene_id === script.entry_scene_id) ?? script.scenes[0];
  const opening = entryScene ? firstPlayableCommands(entryScene, 10) : [];
  const firstSpriteIndex = opening.findIndex((command) => command.type === "sprite" && command.visible !== false);
  const firstTextIndex = opening.findIndex(isTextCommand);
  const atmosphereBeforeFirstSprite = firstSpriteIndex < 0
    ? opening.filter(isAtmosphereCommand).length
    : opening.slice(0, firstSpriteIndex).filter(isAtmosphereCommand).length;
  const spritesBeforeFirstText = firstTextIndex < 0
    ? opening.filter((command) => command.type === "sprite" && command.visible !== false).length
    : opening.slice(0, firstTextIndex).filter((command) => command.type === "sprite" && command.visible !== false).length;
  const openingTextLength = opening.reduce((total, command) => total + commandTextLength(command), 0);
  const hasBackground = opening.some((command) => command.type === "background");
  const hasPacing = opening.some((command) => command.type === "wait" || command.type === "animation" || command.type === "camera");
  const issues: string[] = [];
  let score = 20;

  if (!entryScene) {
    issues.push("入口场景不存在，无法评估开局演出。");
    score = 0;
  }
  if (hasBackground) score += 18;
  else issues.push("开局缺少背景建立。");

  if (firstTextIndex >= 0 && (firstSpriteIndex < 0 || firstTextIndex < firstSpriteIndex)) score += 22;
  else issues.push("开局应先用旁白/对白建立环境，再让立绘入场。");

  if (atmosphereBeforeFirstSprite >= 2) score += 16;
  else issues.push("首个立绘出现前的氛围事件不足。");

  if (spritesBeforeFirstText <= 1) score += 14;
  else issues.push("首段文本前不应直接显示多个角色立绘。");

  if (openingTextLength >= 24) score += 6;
  else issues.push("开局文字信息不足，缺少引导感。");

  if (hasPacing) score += 4;
  else issues.push("开局缺少等待、镜头或动画节奏点。");

  const finalScore = Math.max(0, Math.min(100, score));
  return {
    score: finalScore,
    level: finalScore >= 90 ? "excellent" : finalScore >= 80 ? "polished" : finalScore >= 65 ? "adequate" : "rough",
    issues,
    details: {
      entrySceneId: entryScene?.scene_id ?? "",
      firstSpriteIndex,
      firstTextIndex,
      firstCommands: opening.map((command) => command.type),
      atmosphereBeforeFirstSprite,
      spritesBeforeFirstText,
      openingTextLength,
      hasBackground,
      hasPacing,
    },
  };
}

export function assertPolishedOpeningPerformance(script: RuntimeScript, minimumScore = 80): OpeningPerformanceScore {
  const result = scoreOpeningPerformance(script);
  if (result.score < minimumScore) {
    throw new Error(`Opening performance score ${result.score}/${minimumScore}: ${result.issues.join(" ")}`);
  }
  return result;
}
