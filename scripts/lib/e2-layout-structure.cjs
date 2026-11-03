"use strict";

function readLayoutStructure(warm) {
  const content = document.querySelector(
    `.advanced-tab-content.${warm ? "is-warm" : "is-active"}[data-tab="layout"]`);
  if (!content) throw new Error("expected layout content absent");
  const state = window.__e2LayoutStructure ||= { ids: new WeakMap(), nextId: 1 };
  const identify = node => {
    if (!node) return null;
    if (!state.ids.has(node)) state.ids.set(node, state.nextId++);
    return state.ids.get(node);
  };
  const regions = {
    content,
    scroll: content.querySelector(".advanced-tab-scroll"),
    designer: content.querySelector(".runtime-layout-designer"),
    grid: content.querySelector(".runtime-layout-grid"),
    sidebar: content.querySelector(".runtime-layout-sidebar"),
    center: content.querySelector(".runtime-layout-center"),
    inspector: content.querySelector(".runtime-layout-inspector"),
    stageWrap: content.querySelector(".runtime-layout-stage-wrap"),
    stage: content.querySelector(".runtime-layout-stage"),
  };
  const properties = ["display", "position", "contain", "overflowX", "overflowY",
    "width", "height", "boxSizing", "alignSelf", "gridTemplateRows", "gridTemplateColumns"];
  return Object.fromEntries(Object.entries(regions).map(([name, node]) => {
    if (!node) throw new Error(`layout structure region missing: ${name}`);
    const style = getComputedStyle(node);
    return [name, { nodeId: identify(node), parentId: identify(node.parentElement),
      styles: Object.fromEntries(properties.map(property => [property, style[property]])) }];
  }));
}

function compareLayoutStructure(before, after) {
  const keys = Object.keys(before || {});
  if (!keys.length) throw new Error("nonempty layout structure required");
  if (keys.length !== Object.keys(after || {}).length || keys.some(key => !after[key]))
    throw new Error("both snapshots must have the same regions");
  const replaced = [], reparented = [], styleChanges = [];
  for (const key of keys) {
    const left = before[key], right = after[key];
    if (left.nodeId !== right.nodeId) replaced.push(key);
    if (left.parentId !== right.parentId) reparented.push(key);
    for (const [property, value] of Object.entries(left.styles)) {
      if (value !== right.styles[property]) styleChanges.push({
        region: key, property, before: value, after: right.styles[property],
      });
    }
  }
  return { replaced, reparented, styleChanges };
}

module.exports = { readLayoutStructure, compareLayoutStructure };
