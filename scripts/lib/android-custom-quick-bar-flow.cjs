"use strict";
// Observe public DOM, interact only through the supplied genuine ADB inputs.
const assert = require("node:assert/strict");
function measure() {
  const scope = document.querySelector('.ui-skin-scope[data-ui-screen="player"]');
  const frame = scope?.querySelector(".runtime-layout-frame"), bar = document.querySelector('[data-testid="renpy-quick-bar"]');
  const rect = e => e?.getBoundingClientRect().toJSON();
  return { frame: rect(frame), scope: rect(scope), bar: rect(bar), ratio: scope?.dataset.gameAspectRatio,
    platform: scope?.dataset.runtimePlatform, ready: scope?.dataset.uiViewportReady,
    placement: bar?.dataset.quickMenuPlacement, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    overflow: document.documentElement.scrollWidth - innerWidth, text: rect(document.querySelector(".dialog-text")),
    nvl: rect(document.querySelector(".nvl-page")),
    scene: document.querySelector(".story-player")?.dataset.currentSceneId,
    command: document.querySelector(".story-player")?.dataset.currentCommandIndex,
    buttons: [...(bar?.querySelectorAll("button") || [])].map(e => {
      const r = e.getBoundingClientRect(); return { label: e.textContent.trim(), rect: r.toJSON(),
        hit: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        clipped: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1 };
    }) };
}
function validate(g, ratio) {
  const f = g.frame, b = g.bar, [rw, rh] = ratio.split(":").map(Number);
  const near = (a, b, message) => assert(Math.abs(a - b) <= 1.5, `${message}: ${a} != ${b}`);
  assert.equal(g.platform, "android"); assert.equal(g.ready, "true"); assert.equal(g.ratio, ratio);
  assert.equal(g.placement, "custom"); assert(f?.width > 0 && f.height > 0 && b?.width > 0);
  assert(Math.abs(f.width / f.height - rw / rh) < .003); assert(g.overflow <= 1);
  // Actual UI-authored rect: x50/y10/width60/height6/top_center. It is well
  // inside native safe bounds, so this expected geometry needs no fake insets.
  const scale = Math.min(.6 * f.width / (9 * 62 + 8 * 6), .06 * f.height / 32);
  near(b.width, (9 * 62 + 8 * 6) * scale, "row width"); near(b.height, 32 * scale, "row height");
  near(b.x + b.width / 2, f.x + f.width / 2, "authored center"); near(b.y, f.y + f.height * .1, "authored top");
  assert(b.x > f.x && b.right < f.right && b.y > f.y && b.bottom < f.bottom);
  assert.equal(g.buttons.length, 9);
  for (const button of g.buttons) {
    assert(button.hit && !button.clipped && button.rect.width > 0 && button.rect.height > 0);
    near(button.rect.y, b.y, "single row y"); near(button.rect.height, b.height, "button height");
  }
  assert((g.text?.height > 12) || (g.nvl?.height > 12), "Dialogue/NVL must stay readable");
}
async function exercise({ page, tap, cmd, text, capture, settle, save, report, row }) {
  const story = async () => page.evaluate(() => ({ scene: document.querySelector(".story-player")?.dataset.currentSceneId,
    command: document.querySelector(".story-player")?.dataset.currentCommandIndex }));
  const wait = fn => page.waitForFunction(fn);
  await tap(page.getByTestId("start-new-game")); await settle(page);
  await page.locator(".dialog-box").waitFor();
  if (await page.locator(".story-player").getAttribute("data-is-typing") === "true") await tap(page.locator(".dialog-box"));
  await wait(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  const original = await story(); assert.equal(original.scene, "ui_acceptance");
  row.displayCases = []; save();
  for (const size of report.inheritedDisplayCases ? ["2400x1080"] : ["1920x1080", "2400x1080"]) {
    cmd(["shell", "wm", "size", size]);
    const [physicalWidth, physicalHeight] = size.split("x").map(Number);
    await page.waitForFunction(({ physicalWidth, physicalHeight }) => Math.abs(innerWidth * devicePixelRatio - physicalWidth) <= 1
      && Math.abs(innerHeight * devicePixelRatio - physicalHeight) <= 1, { physicalWidth, physicalHeight });
    for (const ratio of ["16:9", "16:10", "4:3"]) {
      const test = { size, ratio, status: "RUNNING" }; row.displayCases.push(test); save();
      await tap(page.getByTestId("renpy-quick-settings")); await settle(page);
      await tap(page.locator(".settings-tabs button").first());
      await tap(page.getByTestId("settings-aspect-" + ratio));
      await page.getByTestId("settings-aspect-" + ratio).waitFor({ state: "visible" });
      assert.equal(await page.getByTestId("settings-aspect-" + ratio).getAttribute("aria-pressed"), "true");
      await tap(page.getByTestId("settings-finish")); await settle(page);
      await page.waitForFunction(ratio => document.querySelector('.ui-skin-scope[data-ui-screen="player"]')?.dataset.gameAspectRatio === ratio, ratio);
      test.geometry = await page.evaluate(measure); validate(test.geometry, ratio);
      assert.deepEqual(await story(), original, "Settings must not advance the story");
      test.status = "PASS"; save();
    }
  }
  await capture("renpy-custom-4-3");
  await tap(page.getByTestId("renpy-quick-history")); await settle(page);
  await tap(page.getByTestId("renpy-menu-return"));
  await settle(page); assert.deepEqual(await story(), original);
  await tap(page.getByTestId("renpy-quick-hide"));
  await wait(() => document.querySelector('.story-interface[data-hidden="true"]'));
  const hiddenPoint = await page.locator(".story-player").evaluate(e => {
    const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, dpr: devicePixelRatio };
  });
  cmd(["shell", "input", "tap", String(Math.round(hiddenPoint.x * hiddenPoint.dpr)), String(Math.round(hiddenPoint.y * hiddenPoint.dpr))]);
  report.touches.push({ restoringHidden: true, ...hiddenPoint });
  await wait(() => document.querySelector('.story-interface[data-hidden="false"]'));
  await settle(page); assert.deepEqual(await story(), original, "Restore tap must be consumed");
  row.historyReturnAndHiddenTouchRestore = true; save();
  // The shipped Activity explicitly supports sensorLandscape. Rotate between
  // its two supported landscape orientations, recording actual native state.
  row.rotationSamples = [];
  row.rotationBefore = { policy: text(["shell", "cmd", "window", "user-rotation"]),
    acceleration: text(["emu", "sensor", "get", "acceleration"]).match(/acceleration\s*=\s*(-?[\d.]+:-?[\d.]+:-?[\d.]+)/)?.[1] };
  assert(/^(free|lock [0-3])$/.test(row.rotationBefore.policy) && row.rotationBefore.acceleration);
  for (const rotation of [3, 1]) {
    cmd(["shell", "cmd", "window", "user-rotation", "lock", String(rotation)]);
    cmd(["emu", "sensor", "set", "acceleration", rotation === 3 ? "-9.81:0:0" : "9.81:0:0"]);
    await page.waitForFunction(rotation => screen.orientation.angle === rotation * 90 && innerWidth > innerHeight, rotation);
    const native = text(["shell", "dumpsys", "window", "displays"]);
    await settle(page); const g = await page.evaluate(measure); validate(g, "4:3");
    assert.deepEqual(await story(), original); row.rotationSamples.push({ rotation, native, geometry: g }); save();
  }
  cmd(["shell", "cmd", "window", "user-rotation", ...row.rotationBefore.policy.split(" ")]);
  cmd(["emu", "sensor", "set", "acceleration", row.rotationBefore.acceleration]);
  await settle(page); row.rotation = await page.evaluate(measure); validate(row.rotation, "4:3");
  assert.deepEqual(await story(), original); row.rotationStatePreserved = true;
  await tap(page.locator(".dialog-box"));
  await page.locator(".nvl-page").waitFor(); await settle(page);
  row.nvl = await page.evaluate(measure); validate(row.nvl, "4:3");
  assert(row.nvl.nvl.height > 12 && row.nvl.bar.bottom < row.nvl.nvl.top, "Custom top bar must not compress NVL");
  await capture("renpy-custom-nvl");
  row.actualNativeSize = text(["shell", "wm", "size"]); save();
}
function selfTest() {
  const rect = (x, y, width, height) => ({ x, y, width, height, right: x + width, bottom: y + height });
  const scale = 720 / 606;
  const valid = { platform: "android", ready: "true", ratio: "16:9", placement: "custom", overflow: 0,
    frame: rect(0, 0, 1200, 675), bar: rect(240, 67.5, 720, 32 * scale), text: rect(40, 450, 1000, 100),
    buttons: Array.from({ length: 9 }, (_, i) => ({ hit: true, clipped: false, rect: rect(240 + i * 68 * scale, 67.5, 62 * scale, 32 * scale) })) };
  validate(valid, "16:9");
  const corruptions = [g => g.placement = "bottom", g => g.bar.y += 50, g => g.bar.width -= 50,
    g => g.buttons.pop(), g => g.buttons[0].hit = false, g => g.buttons[0].clipped = true,
    g => g.buttons[3].rect.y += 20, g => g.text.height = 0, g => g.overflow = 20, g => g.platform = "windows"];
  for (const change of corruptions) { const g = structuredClone(valid); change(g); assert.throws(() => validate(g, "16:9")); }
  return { status: "PASS", rejected: corruptions.length, deviceInputs: 0 };
}
module.exports = { measure, validate, exercise, selfTest };
if (require.main === module) console.log(JSON.stringify(selfTest()));
