"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const base = path.resolve(process.argv[2] || ""), root = path.resolve(__dirname, "..");
assert(base.toLowerCase().startsWith("f:\\agentvn\\qa\\"));
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const bound = relative => {
  const file = path.resolve(base, relative);
  assert(file.startsWith(base + path.sep)); return file;
};
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const browserFile = bound("browser-matrix-01/report.json"), previewFile = bound("embedded-preview-01/report.json");
const browser = read(browserFile), preview = read(previewFile);
for (const report of [browser, preview]) {
  assert.equal(report.status, "PASS"); assert.equal(report.cleanup, "PASS");
  assert.equal(report.scope, "SOURCE_REAL_BROWSER_NOT_INSTALLED_OR_DEVICE");
  assert.equal(report.modelRequests, 0); assert(report.cases.length > 0);
  assert(report.cases.every(item => item.status === "PASS"));
  for (const [file, value] of Object.entries(report.sourceHashes)) assert.equal(hash(path.join(root, file)), value);
  for (const image of report.artifacts) {
    assert.equal(hash(image.file), image.sha256);
    const png = fs.readFileSync(image.file);
    assert.equal(png.readUInt32BE(16), image.w * image.dpr);
    assert.equal(png.readUInt32BE(20), image.h * image.dpr);
  }
}
assert.deepEqual(browser.sourceHashes, preview.sourceHashes);
const cases = name => browser.cases.filter(item => item.name === name);
assert.equal(cases("select-save-reload-reopen").length, 6);
assert.equal(cases("portable-both-profiles-roundtrip-real-import").length, 1);
assert.equal(cases("real-ui-cartridge-export").length, 6);
for (const item of cases("real-ui-cartridge-export")) {
  assert.equal(hash(item.file), item.sha256); assert.equal(item.requiredRuntime, "0.27.0");
}
const portable = cases("portable-both-profiles-roundtrip-real-import")[0];
assert.equal(hash(portable.portable), portable.sha256);
const editor = cases("editor-real-ratio-selection-and-preview-frame");
const runtime = cases("exported-cartridge-title-settings-playing");
assert.equal(editor.length, 72); assert.equal(runtime.length, 78);
for (const group of [editor, runtime.filter(item => !item.mobile)]) {
  const keys = group.map(c => [c.type, c.ratio, c.width, c.height, c.dpr, c.reduced].join("|"));
  assert.equal(new Set(keys).size, 72, "No repeated combinations masquerading as full coverage");
  for (const type of ["agentvn", "renpy"]) for (const ratio of ["16:9", "16:10", "4:3"])
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true])
        assert(keys.includes([type, ratio, w, h, dpr, reduced].join("|")));
}
const mobile = runtime.filter(item => item.mobile);
assert.equal(mobile.length, 6);
assert(mobile.every(c => c.mobileEmulationOnly && c.width === 2400 && c.height === 1080));
for (const item of runtime) {
  for (const state of [item.title, item.settings, item.playing]) {
    assert.equal(state.ratio, item.ratio);
    assert.deepEqual(state.viewport, { width: item.width, height: item.height, dpr: item.dpr, reduced: item.reduced });
  }
  if (item.type === "renpy") assert.equal(item.quick.buttons.length, 9);
}
const embedded = preview.cases.filter(c => c.name === "editor-embedded-actual-runtime-preview");
assert.equal(embedded.length, 6);
assert.equal(new Set(embedded.map(c => `${c.ratio}|${c.mobile}`)).size, 6);
const unitFile = bound("unit-green-03/report.json"), unit = read(unitFile);
assert.equal(unit.status, "PASS"); assert.equal(unit.checks.length, 6);
assert(unit.checks.every(c => c.status === "PASS"));
const logs = ["final-typecheck.log", "final-editor-build.log", "final-runtime-build.log"].map(name => {
  const file = bound(name), text = fs.readFileSync(file, "utf8");
  assert(text.length > 0);
  if (name !== "final-typecheck.log") assert(text.includes("built in"));
  assert(!/error TS\d+|error during build|npm error/.test(text));
  return { file, sha256: hash(file) };
});
const output = bound("evidence-audit-01.json");
assert(!fs.existsSync(output), "Preserve past audit attempts");
fs.writeFileSync(output, JSON.stringify({
  status: "PASS", auditedAt: new Date().toISOString(),
  scope: "CURRENT_SOURCE_BROWSER_FUNCTIONAL_ONLY",
  reports: [browserFile, previewFile, unitFile].map(file => ({ file, sha256: hash(file) })), logs,
  counts: { editorMatrix: 72, runtimeDesktopMatrix: 72, browserMobileSafeArea: 6,
    realUiExports: 6, reloads: 6, portableRoundtrip: 1, embeddedRuntimePreviews: 6,
    screenshots: browser.artifacts.length + preview.artifacts.length },
  sourceHashes: browser.sourceHashes,
  limits: [
    "Installed Editor, native Player and physical Android NOT_RUN for this new source.",
    "Mobile tests emulate browser UA, touch and native inset event; they do not prove device behavior.",
    "Unit compatibility rejection is not evidence of running a real old binary.",
    "Embedded-preview input referenced the then-running matrix report; this audit binds both final reports and unchanged source/artifacts instead.",
    "Earlier browser-01/02 export failures and browser-03/04 QA failures are retained, never rewritten.",
  ],
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", output, sha256: hash(output) }));
