"use strict";
const assert = require("node:assert/strict");
const { installedResourceFlow, assertTitlePolicy, resourceSmokeStatus, renpyDialogHasClearance, assertDisplayRotation, assertResourceBarStable, assertResourceBarSafeDock } = require("./lib/android-installed-resource-flow.cjs");
const { portableLayoutFlow, assertRenpyQuickBarGeometry } = require("./lib/installed-portable-layout.cjs");

assert.deepEqual(installedResourceFlow({ layout_type: "renpy" }), {
  ...portableLayoutFlow({ layout_type: "renpy" }),
  back: '[data-testid="renpy-menu-return"]',
  save: '[data-testid="renpy-quick-save-load"]',
});
assert.equal(installedResourceFlow({}).back, '[data-testid="back-to-player"]');
assert.throws(() => installedResourceFlow({ layout_type: "unknown" }), /Unsupported/);
const exit = { testid: "open-exit-confirmation", interactive: true };
assertTitlePolicy("agentvn", []);
assertTitlePolicy("renpy", [exit]);
assert.throws(() => assertTitlePolicy("agentvn", [exit]), /must not expose/);
assert.throws(() => assertTitlePolicy("renpy", []), /interactive exit/);
assert.throws(() => assertTitlePolicy("renpy", [{ ...exit, interactive: false }]), /interactive exit/);
assert.throws(() => assertTitlePolicy("unknown", []), /Unsupported/);
const stages = { build: "PASS", runtime: "PASS", audio: "BLOCKED", provenance: "PASS", cleanup: "PASS" };
assert.equal(resourceSmokeStatus(stages), "INSTALLED_RESOURCE_SMOKE_PASS");
for (const stage of ["build", "runtime", "provenance", "cleanup"]) {
  assert.equal(resourceSmokeStatus({ ...stages, [stage]: "BLOCKED" }), "BLOCKED");
  assert.equal(resourceSmokeStatus({ ...stages, [stage]: "FAILED" }), "FAILED");
}
assert.notEqual(resourceSmokeStatus(stages), "RUNTIME_PASS", "no audio/new story evidence must never yield complete runtime acceptance");
const content = [{ x: 100, y: 330, width: 400, height: 50 }];
const quick = { x: 200, y: 386, width: 35, height: 18 };
assert(renpyDialogHasClearance(content, quick), "Footer overlay may share the dialog backdrop, never text");
assert(!renpyDialogHasClearance([{ ...content[0], height: 70 }], quick), "Text overlap must still fail");
assert(!renpyDialogHasClearance([], quick), "Missing content geometry must never grant overlap exemption");
assert.equal(assertDisplayRotation("mCurrentRotation=ROTATION_270", 270), 270);
assert.equal(assertDisplayRotation("mRotation=ROTATION_270", 270), 270);
assert.equal(assertDisplayRotation("rotation=3", 270), 270);
assert.equal(assertDisplayRotation("rotation 3", 270), 270);
assert.throws(() => assertDisplayRotation("mCurrentRotation=ROTATION_90", 270), /Expected display rotation/);
assert.throws(() => assertDisplayRotation("display rotation unavailable", 270), /Expected display rotation/);
assert.equal(assertDisplayRotation("mRotation=1\nmCurrentRotation=ROTATION_270\nmUserRotation=ROTATION_90", 270), 270,
  "Use the active display rotation rather than a stale preceding configuration or user preference");
const anchored = { viewport: { width: 915, height: 412 }, rect: { x: 303.57, y: 386.64, width: 307.85, height: 18.31 } };
assertResourceBarStable(anchored, structuredClone(anchored), "unchanged anchor");
assert.throws(() => assertResourceBarStable(anchored, { ...anchored,
  rect: { ...anchored.rect, x: 283.21, y: 302.64 } }, "recorded device drift"), /quick bar .* changed/);
const rotatedDock = { ...anchored, devicePixelRatio: 2.625,
  nativeInsets: { top: 74, right: 132, bottom: 84, left: 0 },
  rect: { ...anchored.rect, y: 354.64 } };
assertResourceBarSafeDock(rotatedDock, "legitimate converted safe-area displacement");
assert.throws(() => assertResourceBarSafeDock({ ...rotatedDock,
  rect: { ...rotatedDock.rect, x: 283.21, y: 302.64 } }, "recorded native pixels used as CSS pixels"), /physical-to-CSS/);
assert.throws(() => assertResourceBarSafeDock({ ...rotatedDock,
  rect: { ...rotatedDock.rect, y: 302.64 } }, "oversized vertical inset"), /excessive.*bottom gap/);
const rect = { x: 10, y: 10, width: 900, height: 32 };
const geometry = { rect, overflow: 0, pageOverflow: 0,
  buttons: ["回退", "历史", "快进", "自动", "存档", "快存", "快读", "设置", "隐藏"].map((label, i) =>
    ({ label, rect: { x: 10 + i * 100, y: 10, width: 95, height: 32 }, hit: true, clipped: false })) };
assertRenpyQuickBarGeometry(geometry, { width: 1920, height: 1080 });
for (const failure of ["hit", "clipped", "overlap", "row", "count"]) {
  const bad = structuredClone(geometry);
  if (failure === "hit") bad.buttons[3].hit = false;
  if (failure === "clipped") bad.buttons[3].clipped = true;
  if (failure === "overlap") bad.buttons[3].rect.x = 100;
  if (failure === "row") bad.buttons[3].rect.y = 50;
  if (failure === "count") bad.buttons.pop();
  assert.throws(() => assertRenpyQuickBarGeometry(bad, { width: 1920, height: 1080 }));
}
console.log("android-installed-resource-flow: PASS (layout policy, partial scope, cleanup failures, geometry negative controls)");
