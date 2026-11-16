"use strict";
// Finish only the missing native rotation/NVL/restart checks on the same APK.
const assert = require("node:assert/strict");
const { measure, validate } = require("./android-custom-quick-bar-flow.cjs");

function landscapeTargets({ type, angle }) {
  assert.match(type, /^landscape-(primary|secondary)$/);
  assert([0, 90, 180, 270].includes(angle));
  const primary = type === "landscape-primary" ? angle : (angle + 180) % 360;
  return [(primary + 180) % 360, primary].map(degrees => ({
    rotation: degrees / 90, degrees,
    acceleration: primary % 180 === 0
      ? (degrees === primary ? "0:9.81:0" : "0:-9.81:0")
      : (degrees === primary ? "9.81:0:0" : "-9.81:0:0"),
  }));
}

async function exercise({ page, tap, cmd, text, capture, settle, save, report, row }) {
  const story = () => page.evaluate(() => ({ scene: document.querySelector(".story-player")?.dataset.currentSceneId,
    command: document.querySelector(".story-player")?.dataset.currentCommandIndex }));
  await tap(page.getByTestId("start-new-game")); await settle(page);
  await page.locator(".dialog-box").waitFor();
  if (await page.locator(".story-player").getAttribute("data-is-typing") === "true") await tap(page.locator(".dialog-box"));
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  const original = await story(); assert.equal(original.scene, "ui_acceptance");
  // Establish the final inherited ratio, without re-running any display case.
  await tap(page.getByTestId("renpy-quick-settings")); await settle(page);
  await tap(page.locator(".settings-tabs button").first());
  await tap(page.getByTestId("settings-aspect-4:3"));
  assert.equal(await page.getByTestId("settings-aspect-4:3").getAttribute("aria-pressed"), "true");
  await tap(page.getByTestId("settings-finish")); await settle(page);
  validate(await page.evaluate(measure), "4:3"); assert.deepEqual(await story(), original);
  row.displayCases = []; row.rotationSamples = [];
  row.rotationBefore = { policy: text(["shell", "cmd", "window", "user-rotation"]),
    acceleration: text(["emu", "sensor", "get", "acceleration"]).match(/acceleration\s*=\s*(-?[\d.]+:-?[\d.]+:-?[\d.]+)/)?.[1],
    screen: await page.evaluate(() => ({ angle: screen.orientation.angle, type: screen.orientation.type })),
    native: text(["shell", "dumpsys", "window", "displays"]) };
  assert(/^(free|lock [0-3])$/.test(row.rotationBefore.policy) && row.rotationBefore.acceleration);
  row.rotationTargets = landscapeTargets(row.rotationBefore.screen); save();
  try {
    for (const target of row.rotationTargets) {
      cmd(["shell", "cmd", "window", "user-rotation", "lock", String(target.rotation)]);
      cmd(["emu", "sensor", "set", "acceleration", target.acceleration]);
      await page.waitForFunction(degrees => screen.orientation.angle === degrees && innerWidth > innerHeight, target.degrees);
      await settle(page);
      const geometry = await page.evaluate(measure); validate(geometry, "4:3");
      assert.deepEqual(await story(), original, "Rotation must preserve the scene and event");
      const native = text(["shell", "dumpsys", "window", "displays"]);
      assert(native.includes("ROTATION_" + target.degrees) || native.includes("mRotation=" + target.rotation), "Native display must confirm requested rotation");
      row.rotationSamples.push({ ...target, native, geometry,
        screen: await page.evaluate(() => ({ angle: screen.orientation.angle, type: screen.orientation.type })) }); save();
      await capture("renpy-rotation-" + target.degrees);
    }
    row.rotationStatePreserved = true;
  } finally {
    row.rotationOnRestore = await page.evaluate(() => ({ angle: screen.orientation.angle, type: screen.orientation.type }));
    cmd(["shell", "cmd", "window", "user-rotation", ...row.rotationBefore.policy.split(" ")]);
    cmd(["emu", "sensor", "set", "acceleration", row.rotationBefore.acceleration]); save();
  }
  await settle(page); validate(await page.evaluate(measure), "4:3");
  await tap(page.locator(".dialog-box")); await page.locator(".nvl-page").waitFor(); await settle(page);
  row.nvl = await page.evaluate(measure); validate(row.nvl, "4:3");
  assert(row.nvl.nvl.height > 12 && row.nvl.bar.bottom < row.nvl.nvl.top);
  await capture("renpy-custom-nvl"); row.actualNativeSize = text(["shell", "wm", "size"]); save();
}

function selfTest() {
  assert.deepEqual(landscapeTargets({ type: "landscape-primary", angle: 0 }).map(x => x.rotation), [2, 0]);
  assert.deepEqual(landscapeTargets({ type: "landscape-secondary", angle: 180 }).map(x => x.rotation), [2, 0]);
  assert.deepEqual(landscapeTargets({ type: "landscape-primary", angle: 90 }).map(x => x.rotation), [3, 1]);
  assert.deepEqual(landscapeTargets({ type: "landscape-secondary", angle: 270 }).map(x => x.rotation), [3, 1]);
  assert.throws(() => landscapeTargets({ type: "portrait-primary", angle: 0 }));
  assert.throws(() => landscapeTargets({ type: "landscape-primary", angle: 40 }));
  return { status: "PASS", naturalOrientationChecks: 6, deviceInputs: 0 };
}
module.exports = { exercise, landscapeTargets, selfTest };
if (require.main === module) console.log(JSON.stringify(selfTest()));
