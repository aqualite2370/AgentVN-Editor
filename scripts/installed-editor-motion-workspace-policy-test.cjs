"use strict";
// Oracle-only fixtures. These never count as product or installed UI evidence.
const assert = require("node:assert/strict");
const { workspaceFrameFailures, workspaceSequenceFailures, policy } = require("./lib/installed-editor-motion-workspace-policy.cjs");
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const visual = rect => ({ rect, display: "block", visibility: "visible", opacity: 1, className: "", transform: "none" });
const baseline = { paletteRect: box(0, 60, 200, 1000), flowRect: box(200, 60, 1200, 1000),
  inspectorRect: box(1400, 60, 520, 1000) };
function frame(tab = "layout", wide = true) {
  return { palette: visual(baseline.paletteRect), flow: visual(baseline.flowRect),
    inspector: visual(baseline.inspectorRect), paletteFilteredAncestors: [],
    task: "options", activeTab: tab, leavingTab: null,
    panel: { ...visual(box(212, 70, wide ? 1696 : 1176, 978)),
      className: `workspace-task-panel is-open${wide ? " is-layout-mode" : ""}`, animations: [] },
    layers: [{ tab, opacity: 1, className: "advanced-tab-content is-active" }] };
}
const failures = f => workspaceFrameFailures(f, baseline, { width: 1920, height: 1080 }, policy);
for (const tab of ["layout", "theme", "assets", "animation"]) assert.deepEqual(failures(frame(tab)), []);
assert.deepEqual(failures(frame("settings", false)), []);
const shrinking = frame("settings", false);
shrinking.panel.rect = box(212, 70, 1600, 978);
shrinking.panel.className += " is-morphing";
shrinking.panel.transform = "matrix(1.2, 0, 0, 1, 0, 0)";
shrinking.leavingTab = "layout";
shrinking.layers.push({ tab: "layout", opacity: .4, className: "advanced-tab-content is-leaving" });
assert.deepEqual(failures(shrinking), []);
const cases = [
  ["ordinary settings cannot cover Inspector", f => { f.activeTab = "settings"; f.layers[0].tab = "settings"; }],
  ["AI cannot inherit wide permission", f => { f.task = "assistant"; }],
  ["left rail never covered", f => { f.panel.rect.left = 190; }],
  ["left rail never hidden", f => { f.palette.display = "none"; }],
  ["Inspector remains mounted/visible", f => { f.inspector = null; }],
  ["grid width must not change", f => { f.flow.rect = { ...f.flow.rect, width: 1100 }; }],
  ["Inspector track must not move", f => { f.inspector.rect = { ...f.inspector.rect, left: 1300 }; }],
  ["left rail stays clear", f => { f.paletteFilteredAncestors = [{ filter: "blur(2px)" }]; }],
  ["panel must fit actual viewport", f => { f.panel.rect.right = 2000; }],
  ["wide CSS class alone cannot authorize a hidden/inactive page", f => {
    f.layers[0].className = "advanced-tab-content is-warm"; f.layers[0].opacity = 0;
  }],
];
for (const [name, change] of cases) { const f = structuredClone(frame()); change(f); assert(failures(f).length, name); }
for (const change of [
  f => { f.panel.className = "workspace-task-panel"; },
  f => { f.layers[1].className = "advanced-tab-content is-warm"; },
  f => { f.layers[1].tab = "settings"; },
  f => { f.panel.transform = "none"; },
]) {
  const f = structuredClone(shrinking); change(f); assert(failures(f).length, "Unproven/stale wide state must not permit overlap");
}
assert.throws(() => workspaceFrameFailures(frame(), baseline, { width: 1920, height: 1080 }, "UNKNOWN_POLICY"));
// A target at opacity=0 already owns a wide destination; the content clock can
// also finish before its containing morph. Require observed source provenance.
const entering = frame(); entering.panel.className += " is-morphing"; entering.layers[0].opacity = 0;
assert.deepEqual(failures(entering), []);
const tail = structuredClone(shrinking); tail.leavingTab = null; tail.layers = [tail.layers[0]];
assert.deepEqual(workspaceSequenceFailures([frame("animation"), tail], baseline, { width: 1920, height: 1080 }, policy), []);
assert(workspaceSequenceFailures([frame("settings", false), tail], baseline, { width: 1920, height: 1080 }, policy).length);
console.log(`PASS workspace oracle: 5 final states, 1 observed shrink, ${cases.length + 5} invalid variants rejected; no product verdict`);
