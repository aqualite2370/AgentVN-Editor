"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { displayMatches } = require("./lib/android-display-observer.cjs");
const physical = { width: 1920, height: 1080 };
const v = { width: 1280, height: 720, dpr: 1.5, visualWidth: 1280, visualHeight: 720,
  scopeWidth: 1280, scopeHeight: 720, ready: true };
test("physical pixels, CSS, DPR and runtime frame all agree", () => assert(displayMatches(v, physical, physical)));
test("old CSS readiness after wm reset does not prove coordinate ownership", () =>
  assert(!displayMatches({ ...v, width: 1600, height: 900, visualWidth: 1600, visualHeight: 900,
    scopeWidth: 1600, scopeHeight: 900 }, physical, physical)));
test("old physical display cannot certify new requested size", () =>
  assert(!displayMatches(v, physical, { width: 2400, height: 1080 })));
test("runtime scope must also finish its resize", () =>
  assert(!displayMatches({ ...v, scopeWidth: 1600 }, physical, physical)));
test("compositor viewport mismatch is rejected", () =>
  assert(!displayMatches({ ...v, visualHeight: 900 }, physical, physical)));
test("unready runtime cannot own input", () =>
  assert(!displayMatches({ ...v, ready: false }, physical, physical)));
test("actual DPR required", () =>
  assert(!displayMatches({ ...v, dpr: NaN }, physical, physical)));
