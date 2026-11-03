"use strict";
const assert = require("node:assert/strict");
function validateDefaultTitleInput(fixture, manifest, layout) {
  assert.equal(fixture.status, "FIXTURE_VALIDATED");
  assert.equal(fixture.layoutType, "agentvn", "Ren'Py cannot prove AgentVN title coverage");
  assert.equal(fixture.layoutSource, "absent-project-default", "Require an unauthored default layout");
  assert(fixture.projectId.startsWith("installed_resource_flow_story_"), "Isolated fixture required");
  assert.equal(manifest.game_id, fixture.projectId);
  assert.notEqual(layout.layout_type, "renpy");
  const hero = layout.screens.find(s => s.screen_id === "title")?.components
    .find(c => c.component_type === "main_menu_hero");
  assert(hero, "Exported default title hero missing");
  assert.equal(hero.style?.color, undefined, "Explicit hero color cannot prove the inheritance fix");
  // Export materializes the canonical default skin, including its default ink.
  // The input .vnproj is unconfigured; do not mistake generated defaults for
  // user overrides, or accept an arbitrary authored token instead.
  assert([undefined, "#f6f8ff"].includes(layout.tokens?.colorInk),
    "Non-default ink token cannot prove the default fix");
}
function readDefaultTitle() {
  const node = document.querySelector(".menu-hero h1");
  if (!node) return null;
  const style = getComputedStyle(node), scope = node.closest(".ui-skin-scope");
  const range = document.createRange(); range.selectNodeContents(node);
  return { text: node.textContent, color: style.color, fontSize: style.fontSize,
    scopeInk: getComputedStyle(scope).getPropertyValue("--ink").trim(),
    rect: node.getBoundingClientRect().toJSON(),
    glyphs: [...range.getClientRects()].map(r => r.toJSON()),
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    overflow: document.documentElement.scrollWidth - innerWidth,
    renpyCount: document.querySelectorAll(".renpy-title, .renpy-title-heading").length };
}
function assertDefaultTitle(sample, title, background) {
  assert(sample && sample.viewport && sample.glyphs?.length, "Real title/glyph measurements required");
  assert.equal(sample.text, title); assert.equal(sample.renpyCount, 0);
  assert.equal(sample.color, "rgb(246, 248, 255)", "Default title must use scoped light ink");
  assert(sample.overflow <= 1, "Title page overflows horizontally");
  for (const r of [sample.rect, ...sample.glyphs])
    assert(r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1
      && r.right <= sample.viewport.width + 1 && r.bottom <= sample.viewport.height + 1,
    "Title/glyph outside viewport");
  assert(background?.length === 3 && background.every(v => Number.isFinite(v) && v >= 0 && v <= 255));
  const lum = rgb => {
    const c = rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  };
  const a = lum(sample.color.match(/[\d.]+/g).slice(0, 3).map(Number)), b = lum(background);
  const contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  assert(contrast >= 3, `Large title contrast ${contrast.toFixed(3)} < 3`);
  return { contrast, background };
}
module.exports = { validateDefaultTitleInput, readDefaultTitle, assertDefaultTitle };
