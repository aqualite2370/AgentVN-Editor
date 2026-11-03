"use strict";
const assert = require("node:assert/strict");
const { validateDefaultTitleInput, assertDefaultTitle } = require("./lib/agentvn-default-title.cjs");
const fixture = { status: "FIXTURE_VALIDATED", layoutType: "agentvn", layoutSource: "absent-project-default",
  projectId: "installed_resource_flow_story_test" };
const manifest = { game_id: fixture.projectId };
const layout = { screens: [{ screen_id: "title", components: [{ component_type: "main_menu_hero" }] }] };
const rect = { width: 800, height: 120, left: 100, top: 100, right: 900, bottom: 220 };
const sample = { text: "默认标题", color: "rgb(246, 248, 255)", viewport: { width: 1920, height: 1080 },
  glyphs: [rect], rect, overflow: 0, renpyCount: 0 };
const cases = [];
function test(name, run) { run(); cases.push({ name, status: "PASS" }); }
test("default input", () => validateDefaultTitleInput(fixture, manifest, layout));
test("materialized canonical default ink", () => validateDefaultTitleInput(fixture, manifest, { ...layout, tokens: { colorInk: "#f6f8ff" } }));
test("RenPy fixture rejected", () => assert.throws(() => validateDefaultTitleInput({ ...fixture, layoutType: "renpy" }, manifest, layout)));
test("wrong identity rejected", () => assert.throws(() => validateDefaultTitleInput(fixture, { game_id: "other" }, layout)));
test("non-default source rejected", () => assert.throws(() => validateDefaultTitleInput({ ...fixture, layoutSource: "authored" }, manifest, layout)));
test("RenPy layout rejected", () => assert.throws(() => validateDefaultTitleInput(fixture, manifest, { ...layout, layout_type: "renpy" })));
test("explicit token rejected", () => assert.throws(() => validateDefaultTitleInput(fixture, manifest, { ...layout, tokens: { colorInk: "#fff" } })));
test("explicit hero color rejected", () => {
  const explicit = structuredClone(layout); explicit.screens[0].components[0].style = { color: "#fff" };
  assert.throws(() => validateDefaultTitleInput(fixture, manifest, explicit));
});
test("default contrast measured", () => assert(assertDefaultTitle(sample, sample.text, [11, 29, 46]).contrast > 3));
for (const [name, patch] of [["old dark inherited color", { color: "rgb(11, 29, 46)" }],
  ["wrong title", { text: "another game" }], ["RenPy DOM", { renpyCount: 1 }],
  ["missing glyphs", { glyphs: [] }], ["horizontal overflow", { overflow: 20 }],
  ["clipped title", { rect: { ...rect, right: 2000 } }]]) {
  test(`${name} rejected`, () => assert.throws(() => assertDefaultTitle({ ...sample, ...patch }, sample.text, [11, 29, 46])));
}
test("light background contrast failure", () => assert.throws(() => assertDefaultTitle(sample, sample.text, [246, 248, 255])));
console.log(JSON.stringify({ status: "PASS", scope: "Title evidence guard unit tests, not a product/device pass", cases }));
