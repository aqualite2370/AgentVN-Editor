"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Layout-Opacity-Source-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/Layout-Opacity-Source-20261020-01";
const out = path.join(root, "output/layout-opacity-source-20261020-01");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedAt: fs.statSync(f).mtime.toISOString() });
(async () => {
  const fullFile = process.env.AGENTVN_OPACITY_GREEN;
  assert(fullFile, "Explicit full behavior report required");
  const full = read(fullFile), check = read(path.join(out, "check-01/report.json"));
  const devFile = process.env.AGENTVN_OPACITY_DEV ?? path.join(out, "dev-01/report.json"), dev = read(devFile);
  assert.equal(full.status, "PASS"); assert.equal(full.cases.length, 12);
  assert.equal(new Set(full.cases.map(c => `${c.width}-${c.dpr}-${c.motion}`)).size, 12);
  assert.equal(check.status, "PASS"); assert.equal(check.commands.length, 12);
  assert.equal(dev.status, "PASS"); assert.equal(dev.commands.length, 1);
  assert([...check.commands, ...dev.commands].every(c => c.exitCode === 0));
  assert.deepEqual(check.sources, full.sources); assert.deepEqual(dev.sources, full.sources);
  for (const c of full.cases) {
    assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 17);
    assert(c.checks.every(t => t.status === "PASS")); assert.equal(c.otherPages.length, 6);
    assert.equal(c.inherited.displayed, .78); assert.equal(c.restored.displayed, .78);
    assert.equal(c.reimported.displayed, .78);
    assert.equal(sha(c.portable.path), c.portable.sha256);
    assert.deepEqual(c.screenshot.before, c.screenshot.after);
    assert.deepEqual(c.screenshot.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.motion === "reduce" });
    const png = fs.readFileSync(c.screenshot.path);
    assert.equal(sha(c.screenshot.path), c.screenshot.sha256);
    assert.equal(png.readUInt32BE(16), c.width * c.dpr); assert.equal(png.readUInt32BE(20), c.height * c.dpr);
  }
  const sources = full.sources.map(s => {
    const source = describe(path.join(root, s.file));
    assert.equal(source.sha256, s.sha256);
    if (s.file.startsWith("editor/")) return { ...source, bundled: null,
      note: "Editor source compiles to editor/dist; game build workspace intentionally omits Editor source" };
    const bundled = describe(path.join(root, "editor/src-tauri/bundle-workspace", s.file));
    assert.equal(bundled.sha256, s.sha256);
    return { ...source, bundled };
  });
  const editorAssets = fs.readdirSync(path.join(root, "editor/dist/assets"))
    .filter(name => /^(RuntimeLayoutDesigner|RenpyRuntimePreview)-.*\.(?:js|css)$/.test(name))
    .map(name => describe(path.join(root, "editor/dist/assets", name)));
  assert.equal(editorAssets.length, 4);
  const manifest = read(path.join(checkpoint, "manifest.json"));
  const modified = ["plans/ACTIVE_TASKS.md", "shared/cartridge/uiSkin.ts",
    "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx", "editor/src/components/advanced/RenpyTitleEditor.tsx"];
  const preserved = manifest.files.filter(s => !modified.includes(s.file));
  assert.equal(preserved.length, 6);
  for (const s of preserved) assert.equal(sha(path.join(root, s.file)), s.sha256);
  assert.equal(sha(path.join(root, manifest.historicalFailure.file)), manifest.historicalFailure.sha256);
  const rootDev = describe(path.join(root, "AgentVN Dev.exe"));
  const debug = describe(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
  assert.equal(rootDev.sha256, debug.sha256); assert.equal(rootDev.sha256, dev.devReplacement.afterSha256);
  assert(!dev.devReplacement.observerError && dev.devReplacement.events.some(e =>
    Date.parse(e.at) >= Date.parse(dev.commands[0].startedAt) && Date.parse(e.at) <= Date.parse(dev.commands[0].finishedAt)));
  const player = describe(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
  assert.equal(player.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
  const installed = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor";
  const frozen = describe(path.join(installed, "agentvn-editor.exe"));
  const frozenPlayer = describe(path.join(installed, "agentvn-player.exe"));
  assert.equal(frozen.sha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
  assert.equal(frozenPlayer.sha256, "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
  const history = [];
  for (const name of ["red-smoke-01", "green-smoke-01", "green-smoke-02", path.basename(path.dirname(fullFile))]) {
    const file = path.join(qa, name, "report.json"), r = read(file);
    assert.equal(r.modelRequests, 0); assert.equal(r.cleanup.status, "PASS");
    assert.equal(sha(path.join(path.dirname(file), "executed-test.cjs")), r.testSha256);
    let responds = false;
    try { responds = (await fetch(r.service.url, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    assert(!responds, `Owned test service still responds: ${name}`);
    history.push({ name, ...describe(file), status: r.status, service: r.service, responds });
  }
  const receipt = { status: "INHERITED_OPACITY_SOURCE_AND_DEV_PASS", at: new Date().toISOString(),
    version: read(path.join(root, "editor/src-tauri/tauri.conf.json")).version,
    scope: "Author display/material-default inheritance, real backend persistence, browser project download/reimport",
    behavior: { displayCombinations: 12, assertions: full.cases.reduce((n, c) => n + c.checks.length, 0),
      pagesPerCombination: 7, physical4K: false, matrixAppliesTo: "Outer Editor Chromium viewport",
      runtimeIframeLogicalCanvas: { width: 1280, height: 720 } },
    sources, editorAssets, preserved, history, screenshots: full.cases.map(c => c.screenshot),
    portableProjects: full.cases.map(c => c.portable),
    check: describe(path.join(out, "check-01/report.json")), dev: describe(devFile),
    rootDev, debug, player, frozen, frozenPlayer, devReplacement: dev.devReplacement, checkpoint, modelRequests: 0,
    independentUnresolvedDefect: {
      id: "LAYOUT-OPACITY-02",
      observed: "Generic style.opacity=.5 applies to both background alpha and element opacity, yielding .25 effective alpha",
      evidence: path.join(qa, "red-smoke-01/report.json"),
      status: "REPRODUCED_NOT_FIXED_NEEDS_SEMANTICS_DECISION",
    },
    notProven: ["New Dev native UI", "New installed Release, Windows/Android export/device/upgrade",
      "Standalone Runtime 1080p/2K/4K display matrix",
      "Full layout-authoring group", "Correction of legacy explicit-opacity multiplication",
      "Real AI tasks or final user-project acceptance"] };
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: receipt.status, behavior: receipt.behavior, rootDev, player, out }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
