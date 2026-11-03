"use strict";
// Compute the export contract from the exact installed distribution, never
// from the mutable development copy. This is a byte/layout oracle, not a UI pass.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), esbuild = require("../../editor/node_modules/esbuild");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
function normalizeInstalledControls(installation, authored) {
  assert.equal(installation.status, "PASS");
  const files = ["uiSkin.ts", "controlPresentation.ts"].map(n =>
    path.join(installation.installRoot, "shared/cartridge", n));
  const built = esbuild.buildSync({ stdin: {
    contents: 'export { normalizeUISkinLayoutForRuntime } from "./uiSkin"; export { resolveLayoutPresentations } from "./controlPresentation";',
    resolveDir: path.dirname(files[0]), loader: "ts",
  }, bundle: true, platform: "node", format: "cjs", write: false, metafile: true });
  const loaded = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(loaded, loaded.exports, require);
  const layout = JSON.parse(JSON.stringify(loaded.exports.normalizeUISkinLayoutForRuntime(
    loaded.exports.resolveLayoutPresentations(authored)).layout));
  const sources = Object.keys(built.metafile.inputs).filter(f => f !== "<stdin>").map(f => {
    const absolute = path.resolve(f);
    assert(path.relative(installation.installRoot, absolute).split(path.sep)[0] !== "..");
    const bytes = fs.readFileSync(absolute);
    return { path: absolute, sha256: hash(bytes), bytes: bytes.length };
  });
  return { layout, evidence: { sources, compiledSha256: hash(built.outputFiles[0].text),
    helper: { path: __filename, sha256: hash(fs.readFileSync(__filename)) },
    scope: "EXACT_INSTALLED_EXPORT_NORMALIZATION_NOT_RAW_AUTHOR_LAYOUT_EQUALITY" } };
}
module.exports = { normalizeInstalledControls };
