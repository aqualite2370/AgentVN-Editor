import assert from "node:assert/strict";
import * as viewportMath from "../GameCli_framework/src/uiSkin/runtimeViewportMath.mjs";

assert.equal(typeof viewportMath.normalizeNativeSafeInsets, "function",
  "Runtime must normalize the native physical-pixel contract at the browser boundary");
const normalize = viewportMath.normalizeNativeSafeInsets;
const raw = { top: 74, right: 132, bottom: 84, left: 0 };
assert.deepEqual(normalize(raw, 2.625), { top: 74 / 2.625, right: 132 / 2.625, bottom: 32, left: 0 });
assert.deepEqual(normalize({ ...raw, coordinateSpace: "physical" }, 2), { top: 37, right: 66, bottom: 42, left: 0 });
assert.deepEqual(normalize({ ...raw, coordinateSpace: "css" }, 2), raw);
assert.deepEqual(normalize(raw, 1), raw);
for (const invalidDpr of [undefined, 0, -1, Infinity, NaN]) {
  assert.deepEqual(normalize(raw, invalidDpr), raw);
}
assert.deepEqual(normalize({ top: -1, right: NaN, bottom: Infinity, left: "12" }, 2),
  { top: 0, right: 0, bottom: 0, left: 0 });
assert.deepEqual(normalize(undefined, 2), { top: 0, right: 0, bottom: 0, left: 0 });
assert.deepEqual(raw, { top: 74, right: 132, bottom: 84, left: 0 }, "Conversion must not mutate raw insets");
assert.equal(normalize(raw, 2).bottom, 42);
assert.equal(normalize(raw, 3).bottom, 28, "DPI changes must recompute from raw pixels");
console.log("PASS Android native insets units, legacy events, invalid input and DPI recomputation");
