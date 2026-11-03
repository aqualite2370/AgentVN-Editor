"use strict";

const assert = require("node:assert/strict");
const { portableLayoutFlow } = require("./installed-portable-layout.cjs");

function installedResourceFlow(layout) {
  const type = layout?.layout_type ?? "agentvn";
  assert(["agentvn", "renpy"].includes(type), `Unsupported installed resource layout: ${type}`);
  return type === "renpy"
    ? {
      ...portableLayoutFlow(layout),
      back: '[data-testid="renpy-menu-return"]',
      save: '[data-testid="renpy-quick-save-load"]',
    }
    : {
      ...portableLayoutFlow(layout),
      back: '[data-testid="back-to-player"]',
      save: '[data-ui-component-id="quick_save_load_button"]',
    };
}

function assertTitlePolicy(layoutType, buttons) {
  assert(["agentvn", "renpy"].includes(layoutType), `Unsupported runtime layout type: ${layoutType}`);
  const exit = buttons.find(button => button.testid === "open-exit-confirmation");
  if (layoutType === "agentvn") {
    assert(!exit, "AgentVN title menu must not expose an exit action");
    return;
  }
  assert(exit?.interactive, "Ren'Py title menu must expose an interactive exit action");
}

function resourceSmokeStatus(stages) {
  if (["build", "runtime", "provenance", "cleanup"].some(key => stages[key] === "FAILED")) return "FAILED";
  if (["build", "runtime", "provenance", "cleanup"].some(key => stages[key] !== "PASS")) return "BLOCKED";
  return "INSTALLED_RESOURCE_SMOKE_PASS";
}

function renpyDialogHasClearance(contentRects, quickRect) {
  const valid = rect => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0;
  return valid(quickRect) && contentRects?.length > 0 && contentRects.every(rect => valid(rect)
    && (Math.min(rect.x + rect.width, quickRect.x + quickRect.width) - Math.max(rect.x, quickRect.x) <= .5
      || Math.min(rect.y + rect.height, quickRect.y + quickRect.height) - Math.max(rect.y, quickRect.y) <= .5));
}

function assertDisplayRotation(output, expectedDegrees) {
  const text = String(output);
  const match = text.match(/\bmCurrentRotation\s*=\s*ROTATION_(0|90|180|270)\b/)
    || text.match(/\bmRotation\s*=\s*(?:ROTATION_)?(0|90|180|270|[1-3])\b/)
    || text.match(/\brotation\s*(?:=|:|\s)\s*(?:ROTATION_)?(0|90|180|270|[1-3])\b/i);
  const raw = match?.[1];
  const actualDegrees = raw === undefined ? null : Number(raw) <= 3 ? Number(raw) * 90 : Number(raw);
  assert.equal(actualDegrees, expectedDegrees, `Expected display rotation ${expectedDegrees}; observed ${actualDegrees ?? "unavailable"}`);
  return actualDegrees;
}

function assertResourceBarStable(before, after, label) {
  assert(before?.rect && after?.rect, `${label}: missing quick bar geometry`);
  assert.deepEqual(after.viewport, before.viewport, `${label}: viewport changed; cannot compare identical landscape geometry`);
  for (const key of ["x", "y", "width", "height"]) {
    assert(Math.abs(after.rect[key] - before.rect[key]) <= 1,
      `${label}: quick bar ${key} changed ${before.rect[key]} -> ${after.rect[key]}`);
  }
}

function assertResourceBarSafeDock(snapshot, label) {
  const { viewport, rect, devicePixelRatio, nativeInsets } = snapshot;
  assert(viewport && rect && nativeInsets && Number.isFinite(devicePixelRatio) && devicePixelRatio > 0,
    `${label}: missing native/CSS coordinate evidence`);
  const frameWidth = Math.min(viewport.width, viewport.height * 16 / 9);
  const frameOffsetX = (viewport.width - frameWidth) / 2;
  const frameHeight = frameWidth * 9 / 16;
  const frameOffsetY = (viewport.height - frameHeight) / 2;
  const left = Math.max(0, nativeInsets.left / devicePixelRatio - frameOffsetX);
  const right = Math.max(0, nativeInsets.right / devicePixelRatio - frameOffsetX);
  const expectedCenter = viewport.width / 2 + (left - right) / 2;
  assert(Math.abs(rect.x + rect.width / 2 - expectedCenter) <= 1,
    `${label}: quick bar is not centered in the physical-to-CSS safe frame`);
  const bottomInset = Math.max(0, nativeInsets.bottom / devicePixelRatio - frameOffsetY);
  const bottomGap = viewport.height - frameOffsetY - rect.y - rect.height;
  assert(bottomGap >= bottomInset - 1 && bottomGap <= bottomInset + Math.max(12, frameHeight * .02),
    `${label}: excessive quick bar bottom gap ${bottomGap}; CSS safe inset ${bottomInset}`);
}

module.exports = { installedResourceFlow, assertTitlePolicy, resourceSmokeStatus, renpyDialogHasClearance,
  assertDisplayRotation, assertResourceBarStable, assertResourceBarSafeDock };
