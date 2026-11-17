"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), net = require("node:net");
const assert = require("node:assert/strict");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { IsolatedPlayer } = require("./lib/isolated-native-player-session.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const base = path.resolve(process.argv[2] || "");
assert.equal(base, path.resolve("F:/testavn/Windows-Isolated-1989-20261117-01"));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const candidate = read(path.join(base, "candidate.json")), owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), stages: [], screenshots: [], errors: [], launches: [], cleanups: [],
  scope: "ACTUAL_NSIS_DEFAULT_QA_EDITOR_AND_NATIVE_RUNTIME033",
  boundaries: ["Native 1080p DPR1 normal only", "Controlled media cartridges; not whole user story or Android",
    "Real HTML audio state/volume inspected; no new audible judgement", "Editor preview checkbox UI checked; native flag consumed separately"],
  modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const player = new IsolatedPlayer({ out, report, save, nativeProfile: true }); let installation, editor;
async function step(name, fn) {
  const row = { name, status: "RUNNING" }; report.stages.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = e.stack; throw e; }
  finally { save(); console.log(JSON.stringify(row)); }
}
function install(action) {
  const r = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "editor-autosave-upgrade-install.ps1"), "-SessionRoot", base, "-Action", action],
  { encoding: "utf8", windowsHide: true, timeout: 240000 });
  fs.writeFileSync(path.join(out, `install-${action}.log`), (r.stdout || "") + (r.stderr || ""), { flag: "wx" });
  assert.ifError(r.error); assert.equal(r.status, 0); if (action === "New") return read(path.join(base, "install-new.json"));
}
async function at(text) {
  await player.page.locator(".dialog-text").filter({ hasText: text }).waitFor();
  await player.page.waitForFunction(() => document.querySelector(".story-player")?.getAttribute("data-is-typing") === "false");
}
async function next(text) { await player.page.locator(".dialog-box").click(); await at(text); }
async function card() {
  await player.page.getByTestId("open-gallery").click(); await player.ready("gallery");
  return player.page.getByTestId("gallery-item-anchor").getByRole("button").first();
}
(async () => {
  await step("actual-nsis-install-and-fresh-runtime033", async () => {
    install("Snapshot"); installation = install("New"); assert.equal(installation.executable.version, "1.9.89");
    assert.equal(sha(path.join(installation.installRoot, "agentvn-player.exe")), candidate.player.sha256);
    return installation.executable;
  });
  await step("actual-default-editor-profile-preview-checkbox", async () => {
    const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => {
      const p = s.address().port; s.close(() => resolve(p)); }); });
    editor = defaultEditorSession({ installation, out, report, save, label: "preview1989", expectedQaUser: owner.account.name, isolatedBackendPort: port });
    const p = await editor.start(), fixture = read(path.join(base, "fixture.vnproj"));
    const response = await fetch(`http://127.0.0.1:${port}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(response.ok && (await response.json()).ok);
    await p.reload(); await p.locator(".recent-project-open:not(:disabled)").filter({ hasText: fixture.title }).click();
    await p.locator(".editor-toolbar").waitFor(); await settleEditor(p);
    await p.locator('[data-workspace-surface="preview"]:visible').click(); await settleEditor(p);
    const checkbox = p.locator(".preview-launch-panel").getByRole("checkbox", { name: "直接解锁全部画廊" });
    await checkbox.waitFor(); assert(!await checkbox.isChecked()); await checkbox.check(); assert(await checkbox.isChecked());
    await editor.shot("installed-preview-checkbox"); return editor.naturalClose();
  });
  const exe = path.join(installation.installRoot, "agentvn-player.exe"), carts = read(path.join(base, "cartridges.json"));
  for (const c of carts) {
    assert.equal(sha(c.path), c.sha256);
    await step(c.theme + "-native-preview-option-default-and-full", async () => {
      await player.start(exe, ["--mode", "preview", "--cartridge", c.path]);
      await player.page.getByTestId("start-new-game").waitFor({ timeout: 60000 }); assert(await (await card()).isDisabled()); await player.stop();
      await player.start(exe, ["--mode", "preview", "--cartridge", c.path, "--preview-unlock-all-gallery"]);
      await player.page.getByTestId("start-new-game").waitFor({ timeout: 60000 }); assert(await (await card()).isEnabled());
      await player.shot(c.theme + "-preview-full-gallery");
      await player.stop();
      await player.start(exe, ["--mode", "preview", "--cartridge", c.path]);
      await player.page.getByTestId("start-new-game").waitFor({ timeout: 60000 }); assert(await (await card()).isDisabled()); await player.stop();
      return { defaultLocked: true, flagUnlocked: true, restartNotPersisted: true };
    });
    await step(c.theme + "-native-stop-fade-and-formal-ignore-preview-option", async () => {
      await player.start(exe, ["--mode", "fixed", "--cartridge", c.path, "--preview-unlock-all-gallery"]);
      await player.page.getByTestId("start-new-game").waitFor({ timeout: 60000 }); assert(await (await card()).isDisabled());
      await player.page.keyboard.press("Escape"); await player.ready("title_menu");
      await player.page.evaluate(() => {
        window.__sfxAudio = []; const Original = window.Audio;
        window.Audio = function(url) { const a = new Original(url); window.__sfxAudio.push(a); return a; };
        window.Audio.prototype = Original.prototype;
      });
      await player.page.getByTestId("start-new-game").click(); await at("PLAYING");
      await player.page.waitForFunction(() => __sfxAudio.length === 3 && __sfxAudio.every(a => !a.paused));
      const sampling = player.page.evaluate(() => new Promise(resolve => {
        const frames = [], start = performance.now();
        function sample() {
          frames.push({ time: performance.now(), volume: __sfxAudio[0].volume, paused: __sfxAudio[0].paused });
          if (__sfxAudio[0].paused || performance.now() - start > 5000) resolve(frames); else requestAnimationFrame(sample);
        } sample();
      }));
      await next("STOPPING"); const frames = await sampling;
      assert(frames.length > 4); assert(frames.some(f => f.volume > 0 && f.volume < frames[0].volume - .05));
      for (let i = 1; i < frames.length; i++) assert(frames[i].volume <= frames[i - 1].volume + .0001);
      assert.deepEqual(await player.page.evaluate(() => __sfxAudio.map(a => a.paused)), [true, true, false]);
      await next("NEW_SOUND"); await player.page.waitForFunction(() => __sfxAudio.length === 4 && !__sfxAudio[3].paused);
      await next("ALL_STOPPED"); await player.page.waitForFunction(() => __sfxAudio.every(a => a.paused));
      await player.shot(c.theme + "-native-all-stopped"); await player.stop(); return { frames, stopAll: true, newSoundSurvives: true };
    });
  }
  await step("real-frozen032-rejects-new033-cartridge", async () => {
    assert.equal(sha(candidate.oldPlayer.path), candidate.oldPlayer.sha256);
    await player.start(candidate.oldPlayer.path, ["--mode", "fixed", "--cartridge", carts[0].path]);
    await player.page.getByText(/GameCLI 版本过低（runtime_version）/).first().waitFor({ timeout: 60000 });
    const text = await player.page.locator("body").innerText(); assert.match(text, /卡带要求 0\.33\.0/); assert.match(text, /当前 GameCLI 为 0\.32\.0/);
    await player.shot("old032-rejects033"); await player.stop(); return { text, actualOldBinary: candidate.oldPlayer };
  });
  await step("restore-QA-install-registration", async () => { install("Restore"); return read(path.join(base, "metadata-restoration.json")); });
  assert.equal(report.stages.length, 8); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = e.stack; process.exitCode = 1; }).finally(async () => {
  try {
    if (player.page && report.status !== "PASS") await player.shot("failure").catch(() => {});
    await player.stop(); await editor?.stop();
    if (fs.existsSync(path.join(base, "metadata-before.json")) && !fs.existsSync(path.join(base, "metadata-restoration.json"))) install("Restore");
    report.cleanupStatus = "PASS";
  } catch (e) { report.cleanupStatus = "FAILED"; report.cleanupError = e.stack; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, error: report.error }));
});
