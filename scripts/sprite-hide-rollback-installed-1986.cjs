"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), net = require("node:net");
const assert = require("node:assert/strict");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { IsolatedPlayer } = require("./lib/isolated-native-player-session.cjs");
const { settleRuntime, settleEditor, dismissEnvironmentCompletion } = require("./lib/installed-acceptance.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const base = path.resolve(process.argv[2] || "");
assert.equal(base, path.resolve("F:/testavn/Windows-Isolated-1986-20261117-01"));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const owner = read(path.join(base, "account-controller.json")), candidate = read(path.join(base, "candidate.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const fixture = read(path.join(base, "fixture.vnproj"));
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", stages: [], cases: [], screenshots: [], errors: [], launches: [], cleanups: [],
  scope: "ACTUAL1986_NSIS_DEFAULT_QA_EDITOR_CONFIRMATION_NATIVE_PLAYER_DERIVED_REAL_ART_CARTRIDGES",
  boundaries: ["Controlled cartridges, not new author UI exports", "1080p/DPR1 normal native WebView only",
    "No Android/upgrade/full-user-project claim", "Player stopped by owned process identity, not normal-close acceptance"],
  startedAt: new Date().toISOString(), installations: 0, modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let installation, editor, page;
const player = new IsolatedPlayer({ out, report, save, nativeProfile: true });
async function step(name, fn) {
  const row = { name, status: "RUNNING" }; report.stages.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; row.error = e.stack; throw e; }
  finally { save(); console.log(JSON.stringify(row)); }
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
  await settleRuntime(player.page);
}
async function next(text) { await player.page.locator(".dialog-box").click(); await at(text); }
async function back(theme, text) {
  const p = player.page;
  if (theme === "renpy") await p.getByTestId("renpy-quick-rollback").click();
  else {
    const toggle = p.getByTestId("quick-menu-toggle");
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await p.getByRole("button", { name: "回退", exact: true }).click();
    if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
  }
  await at(text);
}
(async () => {
  await step("actual-nsis-install-new-native-player", async () => {
    install("Snapshot"); installation = install("New"); report.installations++;
    assert.equal(installation.executable.version, "1.9.86");
    assert.equal(sha(installation.executable.path), read(candidate.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload").executable.sha256);
    assert.equal(sha(path.join(installation.installRoot, "agentvn-player.exe")), candidate.player.sha256);
    assert.notEqual(candidate.player.sha256, candidate.oldPlayer.sha256);
    return installation.executable;
  });
  await step("installed-confirmation-actions-unobscured-and-editor-normal-close", async () => {
    const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => {
      const p = s.address().port; s.close(() => resolve(p)); }); });
    editor = defaultEditorSession({ installation, out, report, save, label: "hide1986",
      expectedQaUser: owner.account.name, isolatedBackendPort: port });
    page = await editor.start();
    const imported = await fetch(`http://127.0.0.1:${port}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(imported.ok && (await imported.json()).ok);
    await page.reload(); await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: fixture.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.animation"]:visible').click(); await settleEditor(page);
    await dismissEnvironmentCompletion(page);
    await page.getByRole("button", { name: "保存全局入场", exact: true }).click();
    const dialog = page.getByTestId("sprite-animation-default-confirmation"); await dialog.waitFor();
    for (const action of await dialog.getByRole("button").all()) {
      await action.focus(); await action.hover(); await page.waitForTimeout(280);
      assert.equal(await page.locator(".hover-help-card").count(), 0);
      assert(await action.evaluate(e => { const r = e.getBoundingClientRect();
        return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }));
    }
    await editor.shot("installed-confirmation-clear");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    return editor.naturalClose();
  });
  for (const theme of ["agentvn", "renpy"]) for (const hideMode of ["sprite", "animation-all"])
  await step(theme + "-" + hideMode + "-native-hide-rollback-reentry", async () => {
    const cartridge = path.join(base, `${theme}-${hideMode}.vncart`);
    const expected = read(path.join(base, "cartridges.json")).find(c => c.theme === theme && c.hideMode === hideMode);
    assert.equal(sha(cartridge), expected.sha256);
    await player.start(path.join(installation.installRoot, "agentvn-player.exe"), ["--mode", "fixed", "--cartridge", cartridge]);
    await player.page.getByTestId("start-new-game").click({ timeout: 60000 }); await at("COUNT_1");
    const row = { theme, hideMode, status: "RUNNING", samples: [], rollback: [] }; report.cases.push(row); save();
    for (const [text, count] of [["COUNT_1", 1], ["COUNT_2", 2], ["COUNT_5", 5], ["BEFORE", 1]]) {
      if (text !== "COUNT_1") await next(text);
      await player.page.waitForFunction(n => document.querySelectorAll(".sprite-slot").length === n, count);
      await player.page.waitForFunction(() => [...document.querySelectorAll(".sprite-slot img")].every(i => i.complete && i.naturalWidth));
      row.samples.push({ count, rect: await player.page.locator('[data-character-id="alice"] img').evaluate(i => i.getBoundingClientRect().toJSON()) });
    }
    assert(row.samples.every(s => Math.abs(s.rect.width - row.samples[0].rect.width) < .5));
    await next("HIDDEN_1"); await next("HIDDEN_2"); await next("HIDDEN_3");
    await player.page.waitForFunction(() => !document.querySelector(".sprite-slot"));
    for (const text of ["HIDDEN_2", "HIDDEN_1"]) {
      await back(theme, text); assert.equal(await player.page.locator(".sprite-slot").count(), 0); row.rollback.push(text);
    }
    await player.shot(theme + "-" + hideMode + "-hidden-after-rollback");
    await back(theme, "BEFORE"); await player.page.locator('[data-character-id="alice"] img').waitFor();
    await player.shot(theme + "-" + hideMode + "-restored-before-hide");
    for (const text of ["HIDDEN_1", "HIDDEN_2", "HIDDEN_3"]) {
      await player.page.keyboard.press("PageDown"); await at(text);
      const transient = await player.page.locator(".sprite-slot").evaluateAll(slots => slots.map(slot => ({
        phase: slot.dataset.spritePhase, className: slot.className, opacity: getComputedStyle(slot).opacity,
      })));
      row.forwardPresentations ??= []; row.forwardPresentations.push({ text, transient }); save();
      assert.equal(await player.page.locator(".sprite-slot:not(.is-exiting)").count(), 0);
      await player.page.waitForFunction(() => !document.querySelector(".sprite-slot"), null, { timeout: 1800 });
    }
    for (const text of ["HIDDEN_2", "HIDDEN_1", "BEFORE"]) await back(theme, text);
    await next("HIDDEN_1"); await next("HIDDEN_2"); await next("HIDDEN_3"); await next("RETURNED");
    await player.page.waitForTimeout(1100);
    assert.equal(await player.page.locator('.sprite-slot[data-character-id="alice"]').count(), 1); await at("RETURNED");
    await player.shot(theme + "-" + hideMode + "-reentry-preserved"); await player.stop();
    row.status = "PASS"; return row;
  });
  await step("restore-QA-install-registration", async () => { install("Restore"); return read(path.join(base, "metadata-restoration.json")); });
  assert.equal(report.cases.length, 4); assert(report.stages.every(s => s.status === "PASS"));
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = e.stack; process.exitCode = 1; })
.finally(async () => {
  try {
    if (page && !page.isClosed() && report.status !== "PASS") await editor.shot("failure-terminal").catch(() => {});
    await player.stop(); await editor?.stop();
    if (fs.existsSync(path.join(base, "metadata-before.json")) && !fs.existsSync(path.join(base, "metadata-restoration.json"))) install("Restore");
    report.cleanupStatus = "PASS";
  } catch (e) { report.cleanupStatus = "FAILED"; report.cleanupError = e.stack; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, error: report.error, out }));
});
