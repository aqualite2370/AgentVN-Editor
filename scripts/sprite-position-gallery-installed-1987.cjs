"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), net = require("node:net");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { IsolatedPlayer } = require("./lib/isolated-native-player-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const base = path.resolve(process.argv[2] || "");
assert.equal(base, path.resolve("F:/testavn/Windows-Isolated-1987-20261117-01"));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const owner = read(path.join(base, "account-controller.json")), candidate = read(path.join(base, "candidate.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", stages: [], cases: [], screenshots: [], errors: [], launches: [], cleanups: [],
  scope: "ACTUAL1987_NSIS_DEFAULT_QA_EDITOR_AND_NATIVE_PLAYER_PREVIEW_RESTART_FIXED_CONSUMPTION",
  boundaries: ["Controlled real-art cartridges derived from retained author-export layouts; not new UI author exports",
    "Native 1080p/DPR1 normal; no new Android/upgrade/full-story claim", "Player stops by process ownership, not normal-close acceptance"],
  installations: 0, modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let installation, editor;
const player = new IsolatedPlayer({ out, report, save, nativeProfile: true });
async function step(name, fn) {
  const row = { name, status: "RUNNING" }; report.stages.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = e.stack; throw e; }
  finally { save(); console.log(JSON.stringify({ name, status: row.status, error: row.error })); }
}
function install(action) {
  const r = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "editor-autosave-upgrade-install.ps1"), "-SessionRoot", base, "-Action", action],
  { encoding: "utf8", windowsHide: true, timeout: 240000 });
  fs.writeFileSync(path.join(out, `install-${action}.log`), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr);
  if (action === "New") return read(path.join(base, "install-new.json"));
}
async function at(text) {
  await player.page.locator(".dialog-text").filter({ hasText: text }).waitFor();
  await player.page.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-is-typing") === "false");
  await settleRuntime(player.page);
}
async function next(text) { await player.page.locator(".dialog-box").click(); await at(text); }
async function rect() {
  return player.page.locator('.sprite-slot[data-character-id="alice"]:not(.is-exiting) img').evaluate(e => e.getBoundingClientRect().toJSON());
}
async function galleryCard() {
  await player.page.getByTestId("open-gallery").click(); await player.ready("gallery");
  return player.page.getByTestId("gallery-item-shared_anchor").getByRole("button").first();
}
function retainGallery(id, label) {
  const found = fs.readdirSync(process.env.APPDATA).filter(n => n.startsWith("com.agentvn.")).map(n =>
    path.join(process.env.APPDATA, n, "gallery", id, "shared_anchor.json")).filter(f => fs.existsSync(f));
  assert.equal(found.length, 1, "Exact QA default gallery file");
  const retained = path.join(out, label + ".json"); fs.copyFileSync(found[0], retained, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(found[0]), sha(retained)); return { path: retained, source: found[0], sha256: sha(retained) };
}
(async () => {
  await step("actual-nsis-install-new-player", async () => {
    install("Snapshot"); installation = install("New"); report.installations++;
    assert.equal(installation.executable.version, "1.9.87");
    assert.equal(sha(installation.executable.path), read(candidate.payloadReport.path).deployments
      .find(d => d.kind === "NSIS actual payload").executable.sha256);
    assert.equal(sha(path.join(installation.installRoot, "agentvn-player.exe")), candidate.player.sha256);
    assert.notEqual(candidate.player.sha256, candidate.oldPlayer.sha256); return installation.executable;
  });
  await step("installed-editor-default-profile-start-and-normal-close", async () => {
    const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => {
      const p = s.address().port; s.close(() => resolve(p)); }); });
    editor = defaultEditorSession({ installation, out, report, save, label: "position1987",
      expectedQaUser: owner.account.name, isolatedBackendPort: port });
    const p = await editor.start(); await p.locator(".project-home").waitFor();
    await editor.shot("installed-editor-home"); return editor.naturalClose();
  });
  const exe = path.join(installation.installRoot, "agentvn-player.exe");
  const receipts = read(path.join(base, "cartridges.json"));
  for (const theme of ["agentvn", "renpy"]) await step(theme + "-native-preview-position-and-gallery-restart", async () => {
    const a = receipts.find(r => r.theme === theme && r.project === "A"), b = receipts.find(r => r.theme === theme && r.project === "B");
    assert.equal(sha(a.path), a.sha256); assert.equal(sha(b.path), b.sha256);
    const row = { theme, status: "RUNNING", samples: [] }; report.cases.push(row); save();
    const galleryId = "preview_gallery_" + crypto.createHash("sha256").update(a.gameId).digest("hex");
    await player.start(exe, ["--mode", "preview", "--cartridge", a.path]); await player.page.getByTestId("start-new-game").waitFor({ timeout: 60000 });
    assert(!(await player.native("list_gallery_unlocks", { installId: galleryId })).includes("shared_anchor"));
    await player.page.getByTestId("start-new-game").click(); await at("SOLO");
    const baseline = await rect();
    for (const text of ["PAIR", "TRIO", "SOLO_AGAIN", "UNLOCKED"]) {
      await next(text); const value = await rect(); row.samples.push({ text, rect: value });
      for (const k of ["x", "y", "width", "height"]) assert(Math.abs(value[k] - baseline[k]) < .6, text + ":" + k);
      if (text === "PAIR") await player.shot(theme + "-pair-stable");
    }
    await player.page.waitForFunction(() => document.body.innerText.includes("已解锁画廊"));
    assert((await player.native("list_gallery_unlocks", { installId: galleryId })).includes("shared_anchor"));
    row.previewFile = retainGallery(galleryId, theme + "-preview-unlock");
    await player.stop();
    await player.start(exe, ["--mode", "preview", "--cartridge", b.path]); await player.page.getByTestId("start-new-game").waitFor({ timeout: 60000 });
    assert(await (await galleryCard()).isDisabled(), "Different project with same anchor remains locked"); await player.stop();
    await player.start(exe, ["--mode", "preview", "--cartridge", a.path]); await player.page.getByTestId("start-new-game").waitFor({ timeout: 60000 });
    const card = await galleryCard(); assert(await card.isEnabled()); await card.click();
    await player.page.locator(".gallery-viewer-image").evaluate(e => e.decode()); await player.ready("gallery");
    await player.shot(theme + "-preview-restart-viewer");
    assert.equal(sha(row.previewFile.source), row.previewFile.sha256);
    await player.stop();
    // Exported/fixed runtime owns a separate gallery namespace.
    await player.start(exe, ["--mode", "fixed", "--cartridge", a.path]); await player.page.getByTestId("start-new-game").waitFor({ timeout: 60000 });
    assert(await (await galleryCard()).isDisabled(), "Preview unlocks must not unlock the fixed game");
    await player.page.keyboard.press("Escape"); await player.ready("title_menu");
    await player.page.getByTestId("start-new-game").click(); await at("SOLO");
    for (const t of ["PAIR", "TRIO", "SOLO_AGAIN", "UNLOCKED"]) await next(t);
    await player.page.waitForFunction(() => document.body.innerText.includes("已解锁画廊"));
    row.fixedFile = retainGallery("fixed_embedded_game", theme + "-fixed-unlock");
    await player.stop();
    await player.start(exe, ["--mode", "fixed", "--cartridge", a.path]); await player.page.getByTestId("start-new-game").waitFor({ timeout: 60000 });
    assert(await (await galleryCard()).isEnabled()); await player.shot(theme + "-fixed-restart-unlocked");
    assert.equal(sha(row.fixedFile.source), row.fixedFile.sha256);
    await player.stop();
    // The shared fixed namespace is the existing product behavior, not changed here.
    // Remove only this QA anchor before the next isolated controlled fixed game.
    await step(theme + "-retire-fixed-qa-anchor", async () => {
      assert(row.fixedFile.source.startsWith(process.env.APPDATA + path.sep));
      assert.equal(sha(row.fixedFile.source), row.fixedFile.sha256);
      fs.unlinkSync(row.fixedFile.source); return { retained: row.fixedFile, removedQaFile: true };
    });
    row.status = "PASS"; return row;
  });
  await step("restore-QA-install-registration", async () => { install("Restore"); return read(path.join(base, "metadata-restoration.json")); });
  assert.equal(report.cases.length, 2); assert(report.cases.every(c => c.status === "PASS"));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = e.stack; process.exitCode = 1; })
.finally(async () => {
  try {
    if (player.page && report.status !== "PASS") await player.shot("failure-terminal").catch(() => {});
    await player.stop(); await editor?.stop();
    if (fs.existsSync(path.join(base, "metadata-before.json")) && !fs.existsSync(path.join(base, "metadata-restoration.json"))) install("Restore");
    report.cleanupStatus = "PASS";
  } catch (e) { report.cleanupStatus = "FAILED"; report.cleanupError = e.stack; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  save(); console.log(JSON.stringify({ status: report.status, error: report.error, out }));
});
