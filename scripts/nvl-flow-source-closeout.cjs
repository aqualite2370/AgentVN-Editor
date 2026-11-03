"use strict";
// Source/build receipt only. Does not promote historical installed failures.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/NVL-Flow-Source-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/NVL-Flow-Source-20261020-01";
const out = path.join(root, "output/nvl-flow-source-20261020-01");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const describe = file => ({ path: path.resolve(file), sha256: hash(fs.readFileSync(file)),
  bytes: fs.statSync(file).size, modifiedAt: fs.statSync(file).mtime.toISOString() });
(async () => {
  const green = read(path.join(qa, "green-full-01/report.json"));
  const checks = read(path.join(out, "check-01/report.json")), dev = read(path.join(out, "dev-02/report.json"));
  const firstDev = read(path.join(out, "dev-01/report.json"));
  assert.equal(firstDev.status, "FAILED");
  assert(fs.readFileSync(firstDev.commands[0].logFile, "utf8").includes("os error 1224"));
  const lockDiagnostic = read(path.join(qa, "cargo-lock-diagnostic-01.json"));
  assert.equal(lockDiagnostic.exclusiveNontruncatingOpen, "PASS");
  assert.equal(lockDiagnostic.beforeSha256, lockDiagnostic.afterSha256);
  assert.equal(green.status, "PASS"); assert.equal(green.cases.length, 48);
  assert.equal(new Set(green.cases.map(c => c.key)).size, 48);
  assert.equal(checks.status, "PASS"); assert.equal(checks.commands.length, 13);
  assert.equal(dev.status, "PASS"); assert.equal(dev.commands.length, 1);
  assert([...checks.commands, ...dev.commands].every(c => c.exitCode === 0));
  assert.deepEqual(green.sources, checks.sources); assert.deepEqual(green.sources, dev.sources);
  const screenshots = [];
  for (const c of green.cases) {
    assert.equal(c.status, "PASS");
    assert.equal(c.checks.length, c.scenario === "capacity-choices" ? 7 : c.layout === "agentvn" ? 6 : 3);
    assert(c.checks.every(t => t.status === "PASS"));
    assert.deepEqual(c.screenshot.before, c.screenshot.after);
    assert.deepEqual(c.screenshot.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
    const png = fs.readFileSync(c.screenshot.path);
    assert.equal(hash(png), c.screenshot.sha256);
    assert.equal(png.readUInt32BE(16), c.width * c.dpr); assert.equal(png.readUInt32BE(20), c.height * c.dpr);
    assert.equal(c.observation.clippedGlyphs, 0);
    if (c.scenario === "capacity-choices") {
      const b = c.observation.panel;
      assert.equal(c.observation.nestedButtons, 0); assert.equal(c.observation.choices.length, 3);
      assert(c.observation.choices.every(n => n.hit && !n.disabled && !n.glyphOverlap
        && n.rect.left >= b.left - 1 && n.rect.right <= b.right + 1
        && n.rect.top >= b.top - 1 && n.rect.bottom <= b.bottom + 1));
    } else {
      assert.equal(c.observation.controlHits.length, 0);
      if (c.layout === "agentvn") {
        assert.equal(c.expanded.controlHits.length, 0); assert.equal(c.expanded.controls.length, 8);
      }
    }
    screenshots.push(c.screenshot);
  }
  const sources = green.sources.map(s => {
    const source = describe(path.join(root, s.file));
    const bundled = describe(path.join(root, "editor/src-tauri/bundle-workspace", s.file));
    assert.equal(source.sha256, s.sha256); assert.equal(bundled.sha256, s.sha256);
    return { ...source, bundled };
  });
  const manifest = read(path.join(checkpoint, "manifest.json"));
  const changed = ["plans/ACTIVE_TASKS.md", "GameCli_framework/src/components/player/ChoicePanel.tsx",
    "GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/components/player/PlaybackControls.tsx",
    "GameCli_framework/src/components/player/StoryPlayer.tsx", "GameCli_framework/src/styles/player.css"];
  const preserved = manifest.files.filter(f => !changed.includes(f.file));
  assert.equal(preserved.length, 3);
  for (const s of preserved) assert.equal(describe(path.join(root, s.file)).sha256, s.sha256);
  const rootDev = describe(path.join(root, "AgentVN Dev.exe"));
  const debug = describe(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
  assert.equal(rootDev.sha256, debug.sha256); assert.equal(rootDev.sha256, dev.devReplacement.afterSha256);
  assert(!dev.devReplacement.observerError && dev.devReplacement.events.some(e =>
    Date.parse(e.at) >= Date.parse(dev.commands[0].startedAt) && Date.parse(e.at) <= Date.parse(dev.commands[0].finishedAt)));
  const player = describe(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
  assert.equal(player.sha256, describe(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")).sha256);
  const installedRoot = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor";
  const frozen = describe(path.join(installedRoot, "agentvn-editor.exe")), frozenPlayer = describe(path.join(installedRoot, "agentvn-player.exe"));
  assert.equal(frozen.sha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
  assert.equal(frozenPlayer.sha256, "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
  const history = [];
  for (const name of ["red-smoke-01", "red-smoke-02", "green-smoke-01", "green-smoke-02", "green-full-01",
    "nvl-regression-01", "nvl-authored-regression-01"]) {
    const file = path.join(qa, name, "report.json"), r = read(file);
    assert.equal(r.cleanup.status, "PASS");
    let responding = false;
    try { responding = (await fetch(r.service.url, { signal: AbortSignal.timeout(1200) })).ok; } catch {}
    assert(!responding, `Owned service still responds: ${name}`);
    assert.equal(describe(path.join(path.dirname(file), "executed-test.cjs")).sha256, r.testSha256);
    history.push({ name, ...describe(file), status: r.status, service: r.service, responds: responding });
  }
  const receipt = { status: "SOURCE_REGRESSION_AND_DEV_PASS", at: new Date().toISOString(), layer: "GameCLI Runtime",
    version: read(path.join(root, "editor/src-tauri/tauri.conf.json")).version,
    scope: "NVL choices and AgentVN control geometry; source Chromium/public preview + full Dev build",
    behavior: { scenarios: 48, displayCombinations: 24, assertions: green.cases.reduce((n, c) => n + c.checks.length, 0),
      supplementalCases: 24, physical4K: false },
    screenshots, history, sources, preserved, rootDev, debug, player, frozen, frozenPlayer,
    gates: describe(path.join(out, "check-01/report.json")), dev: describe(path.join(out, "dev-02/report.json")),
    previousDevFailure: describe(path.join(out, "dev-01/report.json")),
    lockDiagnostic: describe(path.join(qa, "cargo-lock-diagnostic-01.json")),
    devReplacement: dev.devReplacement, checkpoint, modelRequests: 0,
    notProven: ["New native Dev UI", "New installed Release", "Windows/Android exports, devices or upgrades",
      "NVL/bubble portraits or avatar position editor", "Live position-only NVL layout edits during active playback",
      "Other historical feature groups, real AI tasks and final-project acceptance"] };
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: receipt.status, behavior: receipt.behavior, rootDev, player, out }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
