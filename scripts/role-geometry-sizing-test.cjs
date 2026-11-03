"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const root = path.resolve(__dirname, ".."), mod = { exports: {} };
new Function("module", "exports", require("../editor/node_modules/esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents:
    'export { resolveRenpyButtonRole } from "./shared/cartridge/renpyGui";' },
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text)(mod, mod.exports);
const resolve = mod.exports.resolveRenpyButtonRole;
let count = 0;
for (const role of ["page_navigation", "modal_action"]) {
  const gui = { shared: { buttonRoles: { [role]: { geometry: { fontSize: 29 },
    states: { normal: { textColor: "#123456" }, hover: { textColor: "#654321" } } } } } };
  const before = JSON.stringify(gui);
  assert.deepEqual(resolve(gui, role, "help").sizing, { width: "content", height: "content" });
  count++;
  for (const scope of ["shared", "help"]) for (const state of [null, "normal", "hover", "selected", "disabled"])
    for (const field of ["width", "height"]) {
      const input = structuredClone(gui);
      input[scope] ??= {}; input[scope].buttonRoles ??= {}; input[scope].buttonRoles[role] ??= {};
      const target = input[scope].buttonRoles[role];
      if (state) { target.states ??= {}; target.states[state] ??= {}; target.states[state].geometry = { [field]: 197 }; }
      else target.geometry = { ...target.geometry, [field]: 197 };
      const resolved = resolve(input, role, "help");
      assert.equal(resolved.sizing[field], "fixed", `${role}/${scope}/${state}/${field}`);
      assert.equal(resolved.sizing[field === "width" ? "height" : "width"], "content");
      for (const s of Object.values(resolved.states)) assert.equal(s.geometry[field], resolved.geometry[field]);
      assert(resolved.geometry[field] >= 197); count++;
    }
  assert.equal(JSON.stringify(gui), before);
}
for (const role of ["title_action", "category_pagination", "story_choice", "quick_bar"]) {
  const resolved = resolve({ shared: { buttonRoles: { [role]: { geometry: { fontSize: 29 } } } } }, role, "player");
  assert.deepEqual(resolved.sizing, { width: "fixed", height: "fixed" }, `${role} solver must remain unchanged`); count++;
}
const explicit = resolve({ shared: { buttonRoles: { modal_action: {
  geometry: { width: 120, height: 30, fontSize: 29 },
  states: { hover: { geometry: { width: 180, height: 55 } } },
} } } }, "modal_action", "confirmation");
assert.equal(explicit.geometry.width, 180); assert.equal(explicit.geometry.height, 55);
assert.deepEqual(explicit.sizing, { width: "fixed", height: "fixed" }); count++;
console.log(JSON.stringify({ status: "PASS", cases: count, scope: "role sizing provenance and exact authored envelopes" }));
