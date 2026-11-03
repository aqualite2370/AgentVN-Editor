export interface BubblePlacementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BubblePlacementResult {
  x: number;
  y: number;
  width: number;
  height: number;
  tail: "top" | "bottom" | "left" | "right";
  anchor: "character" | "fallback" | "fixed";
}

export interface BubblePlacementOptions {
  viewport: BubblePlacementRect;
  bubble: Pick<BubblePlacementRect, "width" | "height">;
  anchor?: BubblePlacementRect;
  fixed?: { x: number; y: number };
  /** Authored fallback only; never overrides a node anchor or visible character. */
  fallback?: { x: number; y: number };
  offset?: { x?: number; y?: number };
  obstacles?: BubblePlacementRect[];
  safeMargin?: number;
  gap?: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function overlapArea(left: BubblePlacementRect, right: BubblePlacementRect): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

export function placeSpeechBubble(options: BubblePlacementOptions): BubblePlacementResult {
  const { viewport } = options;
  const margin = Math.max(0, options.safeMargin ?? 16);
  const gap = Math.max(0, options.gap ?? 16);
  const safeLeft = viewport.x + margin;
  const safeTop = viewport.y + margin;
  const safeRight = viewport.x + viewport.width - margin;
  const safeBottom = viewport.y + viewport.height - margin;
  const width = Math.max(1, Math.min(options.bubble.width, safeRight - safeLeft));
  const height = Math.max(1, Math.min(options.bubble.height, safeBottom - safeTop));
  const obstacles = [...(options.obstacles ?? [])];
  const candidates: Array<{
    x: number;
    y: number;
    tail: BubblePlacementResult["tail"];
    anchor: BubblePlacementResult["anchor"];
    priority: number;
  }> = [];
  const addCandidate = (
    x: number,
    y: number,
    tail: BubblePlacementResult["tail"],
    anchor: BubblePlacementResult["anchor"],
    priority: number,
  ) => {
    candidates.push({
      x: clamp(x, safeLeft, safeRight - width),
      y: clamp(y, safeTop, safeBottom - height),
      tail,
      anchor,
      priority,
    });
  };

  if (options.fixed) {
    const x = viewport.x + viewport.width * clamp(options.fixed.x, 0, 100) / 100 - width / 2;
    const y = viewport.y + viewport.height * clamp(options.fixed.y, 0, 100) / 100 - height / 2;
    addCandidate(x, y, "bottom", "fixed", 0);
    for (const obstacle of obstacles) {
      addCandidate(x, obstacle.y - height - gap, "bottom", "fixed", 1);
      addCandidate(x, obstacle.y + obstacle.height + gap, "top", "fixed", 1);
      addCandidate(obstacle.x - width - gap, y, "right", "fixed", 1);
      addCandidate(obstacle.x + obstacle.width + gap, y, "left", "fixed", 1);
    }
  } else if (options.anchor) {
    const anchor = options.anchor;
    const centerX = anchor.x + anchor.width / 2 + (options.offset?.x ?? 0);
    const anchorY = anchor.y + Math.min(anchor.height * 0.2, 56) + (options.offset?.y ?? 0);
    obstacles.push(anchor);
    const aboveY = anchor.y - height - gap + (options.offset?.y ?? 0);
    if (aboveY >= safeTop) {
      addCandidate(centerX - width / 2, aboveY, "bottom", "character", 0);
    }
    const belowY = anchor.y + anchor.height + gap + (options.offset?.y ?? 0);
    if (belowY >= safeTop && belowY + height <= safeBottom) {
      addCandidate(centerX - width / 2, belowY, "top", "character", 1);
    }
    addCandidate(anchor.x - width - gap + (options.offset?.x ?? 0), anchorY - height / 2, "right", "character", 2);
    addCandidate(anchor.x + anchor.width + gap + (options.offset?.x ?? 0), anchorY - height / 2, "left", "character", 3);
  } else {
    const centerX = viewport.x + viewport.width * clamp(options.fallback?.x ?? 50, 0, 100) / 100;
    const fallbackY = options.fallback
      ? viewport.y + viewport.height * clamp(options.fallback.y, 0, 100) / 100 - height / 2
      : safeTop;
    addCandidate(centerX - width / 2, fallbackY, "bottom", "fallback", 0);
    for (const obstacle of obstacles) {
      addCandidate(centerX - width / 2, obstacle.y + obstacle.height + gap, "top", "fallback", 1);
      addCandidate(obstacle.x - width - gap, safeTop, "bottom", "fallback", 2);
      addCandidate(obstacle.x + obstacle.width + gap, safeTop, "bottom", "fallback", 3);
    }
  }

  if (candidates.length === 0) {
    addCandidate(
      viewport.x + viewport.width / 2 - width / 2,
      safeTop,
      "bottom",
      "fallback",
      0,
    );
  }

  const centerX = viewport.x + viewport.width / 2;
  const placement = candidates
    .map((candidate) => {
      const rect = { ...candidate, width, height };
      const collisionCost = obstacles.reduce((total, obstacle) => total + overlapArea(rect, obstacle), 0);
      const horizontalPreference = Math.abs(candidate.x + width / 2 - centerX);
      const verticalPreference = Math.max(0, candidate.y - safeTop);
      const preference = options.fixed
        ? Math.hypot(candidate.x - candidates[0].x, candidate.y - candidates[0].y)
        : horizontalPreference + verticalPreference * 0.15;
      return {
        ...candidate,
        score: collisionCost * 10_000 + candidate.priority * 1_000 + preference,
      };
    })
    .sort((left, right) => left.score - right.score)[0];

  return { x: placement.x, y: placement.y, width, height, tail: placement.tail, anchor: placement.anchor };
}
