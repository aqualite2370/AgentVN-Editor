export const SNAP_GRID_STEP_PERCENT = 5;
export const SNAP_SAFE_INSETS_PERCENT = Object.freeze({
  left: 5,
  right: 5,
  top: 5,
  bottom: 5,
});
export const SNAP_THRESHOLD_PX = 8;
export const SNAP_RELEASE_THRESHOLD_PX = 14;

function anchorFactor(anchor) {
  return {
    x: anchor === "top_center" || anchor === "bottom_center" || anchor === "center"
      ? 0.5
      : anchor === "top_right" || anchor === "bottom_right"
        ? 1
        : 0,
    y: anchor === "bottom_left" || anchor === "bottom_center" || anchor === "bottom_right"
      ? 1
      : anchor === "center"
        ? 0.5
        : 0,
  };
}

function visualRect(rect) {
  const factor = anchorFactor(rect.anchor);
  return {
    x: rect.x - rect.width * factor.x,
    y: rect.y - rect.height * factor.y,
    width: rect.width,
    height: rect.height,
  };
}

function authoredRectFromVisual(rect, visual) {
  const factor = anchorFactor(rect.anchor);
  return {
    ...rect,
    x: visual.x + rect.width * factor.x,
    y: visual.y + rect.height * factor.y,
  };
}

function round(value) {
  return Number(value.toFixed(2));
}

function filterPeers(peers, movingId, movingGroupId) {
  return (peers ?? []).filter((peer) => (
    peer?.id !== movingId
    && peer?.visible !== false
    && (!movingGroupId || peer.groupId !== movingGroupId)
    && peer.rect
  ));
}

function addCandidate(candidates, targetPx, kind, sourceId = kind, linePx = targetPx) {
  if (!Number.isFinite(targetPx)) return;
  candidates.push({ targetPx, kind, sourceId, linePx });
}

function axisCandidates({
  axis,
  sizePx,
  frameSizePx,
  toggles,
  safeInsets,
  gridStepPercent,
  peers,
}) {
  const candidates = [];
  if (toggles.grid) {
    const stepPx = frameSizePx * gridStepPercent / 100;
    for (let value = 0; value <= frameSizePx + 0.01; value += stepPx) {
      addCandidate(candidates, value, "grid", "grid", value);
      addCandidate(candidates, value - sizePx, "grid", "grid", value);
    }
  }
  if (toggles.edges) {
    addCandidate(candidates, 0, "edge", "frame-left", 0);
    addCandidate(candidates, frameSizePx - sizePx, "edge", "frame-right", frameSizePx);
    for (const peer of peers) {
      const other = visualRect(peer.rect);
      const otherStart = other[axis] / 100 * frameSizePx;
      const otherSize = other[axis === "x" ? "width" : "height"] / 100 * frameSizePx;
      addCandidate(candidates, otherStart, "edge", peer.id, otherStart);
      addCandidate(candidates, otherStart + otherSize, "edge", peer.id, otherStart + otherSize);
      addCandidate(candidates, otherStart - sizePx, "edge", peer.id, otherStart);
      addCandidate(candidates, otherStart + otherSize - sizePx, "edge", peer.id, otherStart + otherSize);
    }
  }
  if (toggles.center) {
    addCandidate(candidates, (frameSizePx - sizePx) / 2, "center", "frame-center", frameSizePx / 2);
    for (const peer of peers) {
      const other = visualRect(peer.rect);
      const otherStart = other[axis] / 100 * frameSizePx;
      const otherSize = other[axis === "x" ? "width" : "height"] / 100 * frameSizePx;
      addCandidate(candidates, otherStart + (otherSize - sizePx) / 2, "center", peer.id, otherStart + otherSize / 2);
    }
  }
  if (toggles.safe) {
    const insetStart = (axis === "x" ? safeInsets.left : safeInsets.top) / 100 * frameSizePx;
    const insetEnd = frameSizePx - (axis === "x" ? safeInsets.right : safeInsets.bottom) / 100 * frameSizePx;
    addCandidate(candidates, insetStart, "safe", axis === "x" ? "safe-left" : "safe-top", insetStart);
    addCandidate(candidates, insetEnd - sizePx, "safe", axis === "x" ? "safe-right" : "safe-bottom", insetEnd);
  }
  return candidates;
}

function chooseCandidate(basePx, candidates, thresholdPx, releaseThresholdPx, activeSnap) {
  if (activeSnap && Math.abs(basePx - activeSnap.targetPx) <= releaseThresholdPx) {
    return { candidate: activeSnap, snapped: true };
  }
  let best;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const nextDistance = Math.abs(basePx - candidate.targetPx);
    if (nextDistance < distance) {
      distance = nextDistance;
      best = candidate;
    }
  }
  if (!best || distance > thresholdPx) return { candidate: undefined, snapped: false };
  return { candidate: best, snapped: true };
}

export function snapLayoutRect(rect, {
  frame,
  toggles = {},
  frameSafeInsets = SNAP_SAFE_INSETS_PERCENT,
  gridStepPercent = SNAP_GRID_STEP_PERCENT,
  thresholdPx = SNAP_THRESHOLD_PX,
  releaseThresholdPx = SNAP_RELEASE_THRESHOLD_PX,
  activeSnap = {},
  peers = [],
  movingId,
  movingGroupId,
  mode = "move",
} = {}) {
  if (!frame?.width || !frame?.height) return { rect, guides: [], activeSnap: {} };
  const visual = visualRect(rect);
  const validPeers = filterPeers(peers, movingId, movingGroupId);
  const safeInsets = { ...SNAP_SAFE_INSETS_PERCENT, ...frameSafeInsets };
  const options = {
    peers: validPeers,
    toggles: {
      grid: Boolean(toggles.grid),
      edges: Boolean(toggles.edges),
      center: Boolean(toggles.center),
      safe: Boolean(toggles.safe),
    },
    safeInsets,
    gridStepPercent,
  };
  const resize = mode === "resize";
  const xOrigin = visual.x / 100 * frame.width;
  const yOrigin = visual.y / 100 * frame.height;
  const xBase = xOrigin + (resize ? visual.width / 100 * frame.width : 0);
  const yBase = yOrigin + (resize ? visual.height / 100 * frame.height : 0);
  const xSize = visual.width / 100 * frame.width;
  const ySize = visual.height / 100 * frame.height;
  const xChoice = chooseCandidate(
    xBase,
    axisCandidates({ axis: "x", sizePx: resize ? 0 : xSize, frameSizePx: frame.width, ...options }),
    thresholdPx,
    releaseThresholdPx,
    activeSnap.x,
  );
  const yChoice = chooseCandidate(
    yBase,
    axisCandidates({ axis: "y", sizePx: resize ? 0 : ySize, frameSizePx: frame.height, ...options }),
    thresholdPx,
    releaseThresholdPx,
    activeSnap.y,
  );
  const nextVisual = {
    ...visual,
    x: resize ? xOrigin : xChoice.candidate?.targetPx ?? xBase,
    y: resize ? yOrigin : yChoice.candidate?.targetPx ?? yBase,
    width: resize ? Math.max(2 / 100 * frame.width, (xChoice.candidate?.targetPx ?? xBase) - xOrigin) : xSize,
    height: resize ? Math.max(2 / 100 * frame.height, (yChoice.candidate?.targetPx ?? yBase) - yOrigin) : ySize,
  };
  const nextRect = authoredRectFromVisual(rect, {
    ...nextVisual,
    x: nextVisual.x / frame.width * 100,
    y: nextVisual.y / frame.height * 100,
    width: nextVisual.width / frame.width * 100,
    height: nextVisual.height / frame.height * 100,
  });
  if (resize) {
    nextRect.width = nextVisual.width / frame.width * 100;
    nextRect.height = nextVisual.height / frame.height * 100;
    const factor = anchorFactor(rect.anchor);
    nextRect.x = visual.x + nextRect.width * factor.x;
    nextRect.y = visual.y + nextRect.height * factor.y;
  }
  const guides = [];
  for (const [axis, candidate] of [["x", xChoice.candidate], ["y", yChoice.candidate]]) {
    if (candidate) guides.push({
      axis,
      kind: candidate.kind,
      sourceId: candidate.sourceId,
      targetPx: candidate.targetPx,
      linePx: candidate.linePx,
    });
  }
  return {
    rect: {
      ...nextRect,
      x: round(nextRect.x),
      y: round(nextRect.y),
      ...(resize ? { width: round(nextRect.width), height: round(nextRect.height) } : {}),
    },
    guides,
    activeSnap: {
      x: xChoice.candidate,
      y: yChoice.candidate,
    },
  };
}
