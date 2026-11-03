import type { SpriteState } from "../types/settings";

export interface SpriteStageSize {
  width: number;
  height: number;
  uiScale: number;
}

export interface SpriteSlotLayout {
  left: number;
  bottom: number;
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function spritePositionRank(position?: string | null): number {
  if (position === "left") return 0;
  if (position === "center") return 1;
  if (position === "right") return 2;
  return 3;
}

export function orderedVisibleSprites(
  sprites: Record<string, SpriteState>,
  spriteOrder?: string[],
): SpriteState[] {
  const visibleByCharacter = new Map(
    Object.values(sprites)
      .filter((sprite) => sprite.visible)
      .map((sprite) => [sprite.character_id, sprite]),
  );
  const ordered = (spriteOrder ?? [])
    .map((characterId) => visibleByCharacter.get(characterId))
    .filter((sprite): sprite is SpriteState => Boolean(sprite));
  const orderedIds = new Set(ordered.map((sprite) => sprite.character_id));
  const missing = [...visibleByCharacter.values()]
    .filter((sprite) => !orderedIds.has(sprite.character_id))
    .sort((a, b) => {
      const rankDelta = spritePositionRank(a.position) - spritePositionRank(b.position);
      if (rankDelta !== 0) return rankDelta;
      return a.character_id.localeCompare(b.character_id, "zh-Hans-CN");
    });
  return [...ordered, ...missing];
}

function canonicalPosition(position?: string | null): "left" | "center" | "right" | undefined {
  if (position === "left" || position === "center" || position === "right") return position;
  return undefined;
}

export function resolveSpriteSlotIndices(sprites: SpriteState[]): Map<string, number> {
  const visibleSprites = sprites.filter((sprite) => sprite.visible);
  const spriteCount = visibleSprites.length;
  const indices = new Map<string, number>();
  const occupied = new Set<number>();
  const assignedPositions = new Set<string>();

  const assign = (sprite: SpriteState, index: number): void => {
    if (indices.has(sprite.character_id) || occupied.has(index)) return;
    indices.set(sprite.character_id, index);
    occupied.add(index);
    const position = canonicalPosition(sprite.position);
    if (position) assignedPositions.add(position);
  };

  if (spriteCount === 0) return indices;
  if (spriteCount === 1) {
    assign(visibleSprites[0], 0);
    return indices;
  }

  if (spriteCount === 2) {
    const explicitPositions = new Set(
      visibleSprites
        .map((sprite) => canonicalPosition(sprite.position))
        .filter((position): position is "left" | "center" | "right" => Boolean(position)),
    );
    const pairSlots = explicitPositions.has("left") && explicitPositions.has("right")
      ? { left: 0, right: 1 }
      : explicitPositions.has("left") && explicitPositions.has("center")
        ? { left: 0, center: 1 }
        : explicitPositions.has("center") && explicitPositions.has("right")
          ? { center: 0, right: 1 }
          : { left: 0, center: 0, right: 1 };

    visibleSprites.forEach((sprite) => {
      const position = canonicalPosition(sprite.position);
      const preferred = position ? pairSlots[position] : undefined;
      if (preferred !== undefined && !assignedPositions.has(position!)) assign(sprite, preferred);
    });
  } else {
    visibleSprites.forEach((sprite) => {
      const position = canonicalPosition(sprite.position);
      if (!position || assignedPositions.has(position)) return;
      const preferred = position === "left"
        ? 0
        : position === "right"
          ? spriteCount - 1
          : Math.round((spriteCount - 1) / 2);
      assign(sprite, preferred);
    });
  }

  visibleSprites.forEach((sprite) => {
    if (indices.has(sprite.character_id)) return;
    const fallbackIndex = Array.from({ length: spriteCount }, (_, index) => index)
      .find((index) => !occupied.has(index));
    if (fallbackIndex !== undefined) assign(sprite, fallbackIndex);
  });

  return indices;
}

export function resolveSpriteSlotLayout({
  stage,
  spriteCount,
  spriteIndex,
  position,
}: {
  stage: SpriteStageSize;
  spriteCount: number;
  spriteIndex: number;
  position?: string | null;
}): SpriteSlotLayout {
  const width = Math.max(0, stage.width);
  const height = Math.max(0, stage.height);
  const uiScale = Number.isFinite(stage.uiScale) && stage.uiScale > 0 ? stage.uiScale : 1;
  const slotHeight = Math.min(height * 0.92, 940 * uiScale);
  const bottom = clamp(52 * uiScale, 32, 88);

  if (spriteCount > 1) {
    const slotWidthPercent = clamp(86 / spriteCount, 18, 34);
    const centerPercent = 7 + (86 / spriteCount) * (spriteIndex + 0.5);
    const slotWidth = width * slotWidthPercent / 100;
    return {
      left: width * centerPercent / 100 - slotWidth / 2,
      bottom,
      width: slotWidth,
      height: slotHeight,
    };
  }

  const slotWidth = clamp(width * 0.36, 220 * uiScale, 560 * uiScale);
  const sideInset = width * 0.07;
  const left = position === "left"
    ? sideInset
    : position === "right"
      ? width - sideInset - slotWidth
      : (width - slotWidth) / 2;
  return {
    left,
    bottom,
    width: slotWidth,
    height: slotHeight,
  };
}
