"use strict";
// Source/build receipt only: never promotes the frozen installed failure.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Dialog-Portrait-Source-20261019-01";
const checkpoint = "F:/AgentVN/Checkpoints/Dialog-Portrait-Source-20261019-01";
const out = path.join(root, "output/dialog-portrait-source-20261020-01");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hashBytes = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const hash = file => hashBytes(fs.readFileSync(file));
const describe = file => ({ path: path.resolve(file), sha256: hash(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const within = (a, b) => ["left", "top", "width", "height"].every(k => Math.abs(a[k] - b[k]) <= 1);
(async () => {
  const greenFile = path.join(qa, "name-left-green-full-01/report.json");
  const extendedFile = path.join(qa, "name-left-extended-02/report.json");
  const green = read(greenFile), extended = read(extendedFile);
  const gates = read(path.join(out, "check-01/report.json")), dev = read(path.join(out, "dev-01/report.json"));
  assert.equal(green.status, "PASS"); assert.equal(green.cases.length, 24);
  assert.equal(new Set(green.cases.map(c => c.key)).size, 24);
  assert.equal(extended.status, "PASS"); assert.equal(extended.variants.length, 8);
  assert.equal(new Set(extended.variants.map(c => c.key)).size, 8);
  assert.equal(gates.status, "PASS"); assert.equal(gates.commands.length, 12);
  assert.equal(dev.status, "PASS"); assert.equal(dev.commands.length, 1);
  assert([...gates.commands, ...dev.commands].every(c => c.exitCode === 0));
  assert.deepEqual(green.sources, extended.sources);
  assert.deepEqual(green.sources, gates.sources); assert.deepEqual(gates.sources, dev.sources);
  const screenshots = [];
  for (const c of green.cases) {
    assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 9);
    assert(c.checks.every(t => t.status === "PASS"));
    const image = c.bound.images.find(i => i.inDialog && i.visible
      && i.sha256 === "6ee60904616cc7d555748f43fd6439969fb5e2ae466a04193e9f9c89d066fb59");
    assert(image?.hit && image.insideViewport && image.objectFit === "contain");
    const r = image.rect, s = c.bound.speakerRect;
    assert(r.right <= s.left + 1 && r.top < s.bottom && r.bottom > s.top);
    assert(c.bound.glyphRects.every(t => r.right <= t.left + 1 || r.left >= t.right - 1
      || r.bottom <= t.top + 1 || r.top >= t.bottom - 1));
    assert(!c.bound.textPadding.reservation);
    assert(Math.abs(c.bound.textPadding.actual - c.bound.textPadding.authored) <= .1);
    assert(within(s, c.control.speakerRect) && within(c.bound.textRect, c.control.textRect));
    assert(!c.control.images.some(i => i.inDialog && i.visible));
    assert.deepEqual(c.screenshot.before, c.screenshot.after);
    assert.deepEqual(c.screenshot.before, { width: c.width, height: c.height, dpr: c.dpr, reduced: c.reduced });
    const png = fs.readFileSync(c.screenshot.path);
    assert.equal(hashBytes(png), c.screenshot.sha256);
    assert.equal(png.readUInt32BE(16), c.width * c.dpr); assert.equal(png.readUInt32BE(20), c.height * c.dpr);
    screenshots.push(c.screenshot);
  }
  const pageCounts = [];
  for (const c of extended.variants) {
    assert.equal(c.status, "PASS"); assert(c.checks.length >= 2 && c.checks.every(t => t.status === "PASS"));
    assert.deepEqual(c.observation.viewport, { width: 1920, height: 1080, dpr: 1, reduced: false });
    const png = fs.readFileSync(path.join(qa, `name-left-extended-02/${c.key}.png`));
    assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
    if (c.variant === "extreme-pages") {
      assert(c.pages.length > 1 && c.pages.length === c.pages[0].count);
      assert(c.pages.every((p, i) => p.index === i + 1 && p.font >= 12 && p.x <= 1 && p.y <= 1));
      assert.equal(c.pages.map(p => p.text).join(""), "头像旁的超长对白必须完整分页，不能被遮住或丢失。".repeat(220));
      pageCounts.push({ layout: c.layout, pages: c.pages.length, font: c.pages[0].font });
    }
  }
  const latestTest = fs.readFileSync(path.join(root, "scripts/dialog-portrait-source-playwright.cjs"), "utf8").replace(/\r\n/g, "\n");
  const fullTest = fs.readFileSync(path.join(qa, "name-left-green-full-01/executed-test.cjs"), "utf8").replace(/\r\n/g, "\n");
  // Full matrix does not use instant=true. Only the extended preparation
  // changed after that run, from a hidden label to the real slider's value.
  assert.equal(fullTest.replace('    await page.getByText("瞬显", { exact: true }).waitFor();',
    '    // The styled slider deliberately hides the sibling numeric output.\n'
    + '    // Verify the value reached through real keyboard input, not visibility\n'
    + '    // of that hidden implementation label.\n'
    + '    assert.equal(await speed.inputValue(), "0");'), latestTest);
  for (const [r, file] of [[green, greenFile], [extended, extendedFile]]) {
    assert.equal(r.modelRequests, 0); assert.equal(r.cleanup.status, "PASS");
    assert.equal(hash(path.join(path.dirname(file), "executed-test.cjs")), r.testSha256);
  }
  const sources = green.sources.map(s => {
    assert.equal(hash(path.join(root, s.file)), s.sha256);
    const bundled = path.join(root, "editor/src-tauri/bundle-workspace", s.file);
    assert.equal(hash(bundled), s.sha256);
    return { ...describe(path.join(root, s.file)), bundled: describe(bundled) };
  });
  const baseline = read(path.join(checkpoint, "manifest.json"));
  const preserved = baseline.files.filter(f => !["plans/ACTIVE_TASKS.md",
    "GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/styles/player.css"].includes(f.file));
  assert.equal(preserved.length, 5);
  preserved.forEach(f => assert.equal(hash(path.join(root, f.file)), f.sha256));
  const rootDev = describe(path.join(root, "AgentVN Dev.exe"));
  const debug = describe(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
  assert.equal(rootDev.sha256, debug.sha256);
  assert.equal(dev.devReplacement.afterSha256, rootDev.sha256);
  assert(!dev.devReplacement.observerError && dev.devReplacement.events.some(e =>
    Date.parse(e.at) >= Date.parse(dev.commands[0].startedAt)
    && Date.parse(e.at) <= Date.parse(dev.commands[0].finishedAt)));
  const player = describe(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
  assert.equal(player.sha256, hash(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
  const frozen = describe("F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe");
  assert.equal(frozen.sha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
  const frozenPlayer = describe(path.join(path.dirname(frozen.path), "agentvn-player.exe"));
  assert.equal(frozenPlayer.sha256, "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
  const history = [];
  for (const name of ["red-01", "green-smoke-01", "green-smoke-02", "hit-probe-01", "green-smoke-03",
    "green-full-01", "name-left-red-01", "name-left-red-02", "name-left-green-smoke-01",
    "name-left-green-full-01", "name-left-extended-01", "name-left-extended-02"]) {
    const file = path.join(qa, name, "report.json"), r = read(file);
    assert.equal(r.cleanup.status, "PASS");
    let responding = false;
    try { responding = (await fetch(r.service.url, { signal: AbortSignal.timeout(1200) })).ok; } catch {}
    assert(!responding, `Test service still responds: ${name}`);
    history.push({ name, ...describe(file), status: r.status, service: r.service, responds: responding });
  }
  const receipt = { status: "SOURCE_REGRESSION_AND_DEV_PASS", at: new Date().toISOString(),
    version: read(path.join(root, "editor/src-tauri/tauri.conf.json")).version, layer: "GameCLI Runtime",
    scope: "Ordinary dialogue source Chromium/public preview protocol + complete Dev build",
    decision: "Follow the unchanged nameplate on the left, including outside panel; full body area unchanged",
    behavior: { combinations: 24, assertions: green.cases.reduce((n, c) => n + c.checks.length, 0),
      variants: 8, variantAssertions: extended.variants.reduce((n, c) => n + c.checks.length, 0), pageCounts,
      physical4K: false }, screenshots, history, sources, preserved, rootDev, debug, player, frozen, frozenPlayer,
    gates: describe(path.join(out, "check-01/report.json")), dev: describe(path.join(out, "dev-01/report.json")),
    devReplacement: dev.devReplacement, checkpoint, modelRequests: 0,
    notProven: ["Client layout portrait position editing (follow-up)", "NVL/bubble portrait scenarios",
      "New native Dev UI", "New installed Release", "Windows/Android exports, runtime or upgrades",
      "Other historical defects and final project acceptance"] };
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: receipt.status, behavior: receipt.behavior, rootDev, player, out }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
