"use strict";
// Real ADB input only. DOM access below observes public rendered state.
const assert = require("node:assert/strict");
function measure() {
  const scope = document.querySelector('.ui-skin-scope[data-ui-screen="player"]');
  const frame = scope?.querySelector(".runtime-layout-frame");
  const bar = document.querySelector('[data-testid="renpy-quick-bar"]');
  const box = e => e?.getBoundingClientRect().toJSON();
  return {
    ratio: scope?.dataset.gameAspectRatio, scope: box(scope), frame: box(frame), bar: box(bar),
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    nativeInsets: window.__agentvnAcceptanceInsets,
    overflow: document.documentElement.scrollWidth - innerWidth,
    buttons: [...bar?.querySelectorAll("button") || []].map(e => {
      const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { label: e.textContent.trim(), rect: r.toJSON(), hit: e === hit || e.contains(hit),
        clipped: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1 };
    }),
  };
}
function validateFrame(s, ratio) {
  assert.equal(s.ratio, ratio);
  const [w, h] = ratio.split(":").map(Number), f = s.frame, scope = s.scope, bar = s.bar;
  assert(f?.width > 0 && f.height > 0 && scope?.width > 0 && scope.height > 0 && bar?.height > 0);
  assert(Math.abs(f.width / f.height - w / h) < .003, "Actual game frame must match selected ratio");
  assert(Math.abs(f.x + f.width / 2 - scope.x - scope.width / 2) <= 1);
  assert(Math.abs(f.y + f.height / 2 - scope.y - scope.height / 2) <= 1);
  assert(f.x >= scope.x - 1 && f.y >= scope.y - 1
    && f.right <= scope.right + 1 && f.bottom <= scope.bottom + 1, "Frame exceeds its scope");
  assert(s.overflow <= 1);
  assert(s.nativeInsets && s.viewport.dpr > 0, "Real native safe area evidence required");
  const insets = Object.fromEntries(["left", "right", "bottom"].map(side => {
    const offset = side === "bottom" ? scope.bottom - f.bottom : side === "left" ? f.x - scope.x : scope.right - f.right;
    return [side, Math.max(0, s.nativeInsets[side] / s.viewport.dpr - offset)];
  }));
  const center = f.x + f.width / 2 + (insets.left - insets.right) / 2;
  assert(Math.abs(bar.x + bar.width / 2 - center) <= 1, "Bar must follow actual game frame safe center");
  const gap = f.bottom - bar.bottom;
  assert(gap >= insets.bottom - 1 && gap <= insets.bottom + Math.max(12, f.height * .02),
    `Bar must dock at actual game frame safe bottom: gap=${gap}, inset=${insets.bottom}`);
  assert.equal(s.buttons.length, 9);
  for (const b of s.buttons) {
    assert(b.hit && !b.clipped && b.rect.width > 0 && b.rect.height > 0, "Every quick action must remain visible and hit-testable");
    assert(Math.abs(b.rect.y + b.rect.height / 2 - s.buttons[0].rect.y - s.buttons[0].rect.height / 2) <= 1,
      "Nine quick actions must remain in one row");
    assert(b.rect.x >= f.x + insets.left - 1 && b.rect.right <= f.right - insets.right + 1);
  }
}
async function exercise({ cdp, tap, wait, capture, save, report }) {
  const story = () => cdp.evaluate(`(() => {
    const p=document.querySelector(".story-player"),d=document.querySelector(".dialog-box");
    return {scene:p?.dataset.currentSceneId,command:p?.dataset.currentCommandIndex,
      text:d?.querySelector(".dialog-text")?.textContent};
  })()`);
  const idle = () => wait(`document.querySelector('[data-runtime-screen-transition]')?.dataset.runtimeScreenTransition === 'idle'
    && !document.querySelector('.game-launch-blackout')`, "player aspect screen ready");
  const original = await story();
  assert.equal(original.scene, "main"); assert.equal(original.command, "3");
  const r = report.playerAspect = { status: "RUNNING", cases: [],
    persistence: "NOT_RUN_ON_DEVICE_DESKTOP_EVIDENCE_SEPARATE", original };
  save();
  for (const value of ["16:9", "16:10", "4:3", "default"]) {
    const row = { value, status: "RUNNING" }; r.cases.push(row); save();
    try {
      await tap('[data-testid="renpy-quick-settings"]', `aspect ${value} open settings`); await idle();
      await tap(".settings-tabs button:first-child", `aspect ${value} display category`);
      await tap(`[data-testid="settings-aspect-${value}"]`, `aspect choose ${value}`);
      await wait(`document.querySelector('[data-testid="settings-aspect-${value}"]')?.getAttribute("aria-pressed")==="true"`,
        `aspect ${value} selected`);
      await tap('[data-testid="settings-finish"]', `aspect ${value} return to story`); await idle();
      await wait(`document.querySelector('.ui-skin-scope[data-ui-screen="player"]')?.dataset.gameAspectRatio===${JSON.stringify(value === "default" ? "16:9" : value)}`,
        `aspect ${value} frame applied`);
      row.geometry = await cdp.evaluate(`(${measure.toString()})()`);
      validateFrame(row.geometry, value === "default" ? "16:9" : value);
      row.after = await story();
      assert.deepEqual(row.after, original, "Display setting must not advance the story");
      await capture(`player-aspect-${value.replace(":", "-")}`);
      row.status = "PASS";
    } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); r.status = "FAILED"; throw e; }
    finally { save(); }
  }
  r.status = "PASS"; save();
}
function selfTest() {
  const rect = (x, y, width, height) => ({ x, y, width, height, right: x + width, bottom: y + height });
  const valid = { ratio: "4:3", scope: rect(0, 0, 1200, 540), frame: rect(240, 0, 720, 540),
    bar: rect(420, 495, 360, 30), viewport: { width: 1200, height: 540, dpr: 2 },
    nativeInsets: { left: 0, right: 0, bottom: 24 }, overflow: 0,
    buttons: Array.from({ length: 9 }, (_, n) => ({ rect: rect(420 + 40 * n, 495, 40, 30), hit: true, clipped: false })) };
  validateFrame(valid, "4:3");
  const corruptions = [s => s.ratio = "16:9", s => s.frame.width += 30, s => s.bar.bottom -= 40,
    s => s.buttons.pop(), s => s.buttons[0].hit = false, s => s.buttons[0].clipped = true,
    s => s.buttons[3].rect.y -= 10, s => s.nativeInsets = null, s => s.overflow = 20];
  for (const change of corruptions) { const s = structuredClone(valid); change(s); assert.throws(() => validateFrame(s, "4:3")); }
  return { status: "PASS", invalidFrameCasesRejected: corruptions.length, deviceOperations: 0 };
}
module.exports = { exercise, measure, validateFrame, selfTest };
if (require.main === module) console.log(JSON.stringify(selfTest()));
