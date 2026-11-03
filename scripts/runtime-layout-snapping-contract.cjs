const assert = require("node:assert/strict");

async function main() {
  const snapping = await import("../editor/src/utils/runtimeLayoutSnapping.mjs");
  const frame = { width: 1600, height: 900 };
  const rect = { x: 10.2, y: 20.2, width: 20, height: 10 };

  const grid = snapping.snapLayoutRect(rect, {
    frame,
    toggles: { grid: true, edges: false, center: false, safe: false },
    thresholdPx: 8,
    gridStepPercent: 5,
    peers: [],
  });
  assert.equal(grid.rect.x, 10, "grid snapping must use the normalized authored frame");
  assert.equal(grid.rect.y, 20, "grid snapping must use the normalized authored frame");
  assert.equal(grid.guides.every((guide) => guide.kind === "grid"), true);
  const free = snapping.snapLayoutRect(rect, {
    frame,
    toggles: { grid: false, edges: false, center: false, safe: false },
    thresholdPx: 8,
    peers: [],
  });
  assert.deepEqual(free.rect, rect, "all four snap toggles off must preserve exact authored coordinates");
  assert.deepEqual(free.guides, [], "disabled snaps must not leave guides");

  const edge = snapping.snapLayoutRect({ ...rect, x: 0.4 }, {
    frame,
    toggles: { grid: false, edges: true, center: false, safe: false },
    thresholdPx: 8,
    peers: [],
  });
  assert.equal(edge.rect.x, 0, "edge snapping must align the visual left edge to the game frame");
  const nearerPeer = snapping.snapLayoutRect({ ...rect, x: 0.6, width: 8 }, {
    frame: { width: 696, height: 392 },
    toggles: { edges: true },
    peers: [{ id: "nearby", rect: { x: 8.29, y: 11, width: 13.6, height: 6.4 } }],
  });
  assert.equal(nearerPeer.rect.x, 0.29,
    "when a peer edge is closer than the frame edge, align the moving right side to that peer");
  assert.equal(nearerPeer.guides.find((guide) => guide.axis === "x")?.sourceId, "nearby");

  const center = snapping.snapLayoutRect({ ...rect, x: 39.6 }, {
    frame,
    toggles: { grid: false, edges: false, center: true, safe: false },
    thresholdPx: 8,
    peers: [],
  });
  assert.equal(center.rect.x, 40, "center snapping must use the actual frame center");

  const safe = snapping.snapLayoutRect({ ...rect, x: 4.6, y: 4.6 }, {
    frame,
    frameSafeInsets: { left: 5, right: 5, top: 5, bottom: 5 },
    toggles: { grid: false, edges: false, center: false, safe: true },
    thresholdPx: 8,
    peers: [],
  });
  assert.equal(safe.rect.x, 5, "safe-area snapping must use the same normalized inset as the visible safe zone");
  assert.equal(safe.rect.y, 5, "safe-area snapping must use the same normalized inset as the visible safe zone");
  const verticalOnly = snapping.snapLayoutRect({ ...rect, x: 12.3, y: 4.6 }, {
    frame,
    toggles: { grid: false, edges: false, center: false, safe: true },
    thresholdPx: 8,
    peers: [],
  });
  assert.deepEqual(verticalOnly.guides.map((guide) => guide.axis), ["y"],
    "vertical-only snap must render a horizontal reference line");

  const resized = snapping.snapLayoutRect({ x: 18, y: 22, width: 11.7, height: 7.7 }, {
    frame,
    toggles: { grid: true, edges: false, center: false, safe: false },
    thresholdPx: 8,
    gridStepPercent: 5,
    mode: "resize",
    peers: [],
  });
  assert.equal(resized.rect.x, 18, "resize snapping must keep the original left edge");
  assert.equal(resized.rect.y, 22, "resize snapping must keep the original top edge");
  assert.equal(resized.rect.width, 12, "resize should snap the right edge, not the component position");
  assert.equal(resized.rect.height, 8, "resize should snap the bottom edge, not the component position");

  const peers = snapping.snapLayoutRect({ ...rect, x: 29.7 }, {
    frame,
    toggles: { grid: false, edges: true, center: true, safe: false },
    thresholdPx: 8,
    peers: [
      { id: "self", rect: { x: 29.7, y: 20, width: 20, height: 10 }, visible: true },
      { id: "hidden", rect: { x: 50, y: 20, width: 20, height: 10 }, visible: false },
      { id: "same-group", rect: { x: 50, y: 20, width: 20, height: 10 }, visible: true, groupId: "title-custom" },
      { id: "peer", rect: { x: 50, y: 20, width: 20, height: 10 }, visible: true },
    ],
    movingId: "self",
    movingGroupId: "title-custom",
  });
  assert.equal(peers.rect.x, 30, "snap result should prefer a valid visible peer, not hidden/self/group peers");
  assert.equal(peers.guides.some((guide) => guide.sourceId === "peer"), true);
  for (const excluded of [
    { id: "self", rect: { x: 50, y: 20, width: 20, height: 10 }, visible: true },
    { id: "hidden", rect: { x: 50, y: 20, width: 20, height: 10 }, visible: false },
    { id: "same-group", rect: { x: 50, y: 20, width: 20, height: 10 }, visible: true, groupId: "title-custom" },
  ]) {
    const isolated = snapping.snapLayoutRect({ ...rect, x: 29.7 }, {
      frame, toggles: { grid: false, edges: true, center: false, safe: false },
      thresholdPx: 8, peers: [excluded], movingId: "self", movingGroupId: "title-custom",
    });
    assert.equal(isolated.rect.x, 29.7, `excluded peer ${excluded.id} produced a snap`);
    assert.deepEqual(isolated.guides, [], `excluded peer ${excluded.id} produced a guide`);
  }
  const anchored = snapping.snapLayoutRect({ x: 59.7, y: 25, width: 20, height: 10, anchor: "top_right" }, {
    frame, toggles: { grid: false, edges: true, center: false, safe: false },
    thresholdPx: 8, peers: [{ id: "peer", rect: { x: 40, y: 5, width: 20, height: 10 } }],
  });
  assert.equal(anchored.rect.x, 60, "right-anchored snap must preserve the authored anchor model");

  const hysteresis = snapping.snapLayoutRect({ ...rect, x: 10.4 }, {
    frame,
    toggles: { grid: true, edges: false, center: false, safe: false },
    thresholdPx: 8,
    releaseThresholdPx: 14,
    activeSnap: { x: { targetPx: 160, kind: "grid", sourceId: "grid" } },
    peers: [],
  });
  assert.equal(hysteresis.rect.x, 10, "an active snap should hold until the release threshold is exceeded");
  const released = snapping.snapLayoutRect({ ...rect, x: 11 }, {
    frame,
    toggles: { grid: true, edges: false, center: false, safe: false },
    thresholdPx: 8,
    releaseThresholdPx: 14,
    activeSnap: { x: { targetPx: 160, kind: "grid", sourceId: "grid", linePx: 160 } },
    peers: [],
  });
  assert.equal(released.rect.x, 11, "active snap must release after threshold");

  console.log("runtime-layout-snapping-contract: PASS");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
