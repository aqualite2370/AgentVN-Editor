"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { buildSync } = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, ".."), out = process.argv[2];
assert(out && !fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const mod = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts", contents: `
export * from "./shared/cartridge/runtimeCapabilities";
export * from "./shared/cartridge/compatibility";
export * from "./shared/cartridge/constants";
export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";
export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";` },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports);
const api = mod.exports, cases = [];
for (const [type, layout] of [["agentvn", api.getDefaultUISkinLayout()], ["renpy", api.createRenpyUILayout()]]) {
  try {
    const original = JSON.stringify(layout);
    const minimum = api.minimumRuntimeVersionForLayout("0.2.0", layout);
    assert.equal(minimum, "0.25.0");
    assert(!api.isRuntimeCompatible(minimum, "0.24.0"));
    assert(api.isRuntimeCompatible(minimum, api.SUPPORTED_RUNTIME_VERSION));
    assert.equal(api.minimumRuntimeVersionForLayout("99.0.0", layout), "99.0.0");
    assert.equal(JSON.stringify(layout), original);
    cases.push({ type, status: "PASS", minimum });
  } catch (error) { cases.push({ type, status: "FAILED", error: String(error.stack || error) }); }
}
assert.equal(api.minimumRuntimeVersionForLayout("0.2.0"), "0.2.0", "No implicit capability for absent layout");
const status = cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ status,
  scope: "SOURCE_CAPABILITY_DECLARATION_NOT_REAL_OLD_BINARY", cases }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status, cases, out }));
if (status !== "PASS") process.exitCode = 1;
