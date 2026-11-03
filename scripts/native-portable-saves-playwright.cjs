"use strict";
const fs = require("node:fs"), path = require("node:path"), net = require("node:net"), assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { InstalledRuntimeSession, processIdentity, sha, pause } = require("./lib/installed-runtime-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const file = process.argv[process.argv.indexOf("--preparation") + 1]; assert(process.argv.includes("--preparation"));
const prep = read(file), out = prep.sessionRoot;
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(prep.fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(out));
const reportFile = path.join(out, "portable.json"); assert(!fs.existsSync(reportFile));
const report = { status: "RUNNING", at: new Date().toISOString(), scope: prep.scope, layout: prep.layout, smoke: prep.smoke,
  checks: [], matrix: [], launches: [], screenshots: [], pageErrors: [], acls: [], source: { path: file, sha256: sha(file) },
  productChanges: 0, builds: 0, modelRequests: 0, error: null, cleanupError: null,
  notRun: ["Editor export/UI output selector", "Setup installation or upgrade", "Old binary upgrade", "Android", "Physical Alt+F4"] };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
class FixedSession extends InstalledRuntimeSession {
  async start(layout) {
    assert(!this.child); this.layout = layout;
    const port = await new Promise(resolve => {
      const server = net.createServer(); server.listen(0, "127.0.0.1", () => {
        const p = server.address().port; server.close(() => resolve(p));
      });
    });
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(key)) delete env[key];
    Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: prep.webview, TEMP: prep.temporary, TMP: prep.temporary,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` });
    assert.equal(sha(this.exe), prep.sourceExecutable.sha256);
    const logPath = path.join(out, `player-${report.launches.length + 1}.log`), fd = fs.openSync(logPath, "wx");
    try { this.child = spawn(this.exe, ["--mode", "fixed"], {
      cwd: prep.unrelatedCwd, env, windowsHide: true, stdio: ["ignore", fd, fd] }); }
    finally { fs.closeSync(fd); }
    this.exited = new Promise(resolve => this.child.once("exit", resolve));
    this.launch = { pid: this.child.pid, port, identity: null, layout, log: logPath,
      exe: this.exe, executableSha256: sha(this.exe), cwd: prep.unrelatedCwd, mode: "fixed", webview: prep.webview,
      scope: prep.scope };
    report.launches.push(this.launch); save();
    this.identity = processIdentity(this.child.pid); this.launch.identity = this.identity; save();
    assert(this.identity && path.resolve(this.identity.ExecutablePath).toLowerCase() === path.resolve(this.exe).toLowerCase(),
      JSON.stringify({ identity: this.identity, exe: this.exe, exitCode: this.child.exitCode, signalCode: this.child.signalCode }));
    let online = false; const deadline = Date.now() + 45000;
    while (Date.now() < deadline && this.child.exitCode === null) {
      try { online = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
      if (online) break; await pause(100);
    }
    assert(online); this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    this.page = this.browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(this.page);
    this.page.setDefaultTimeout(20000); this.page.on("pageerror", e => report.pageErrors.push(String(e)));
    this.cdp = await this.page.context().newCDPSession(this.page);
    await this.viewport({ width: 1920, height: 1080, dpr: 1, reduced: false });
    await this.ready("title_menu");
    this.storage = await this.native("get_save_storage_info", { installId: this.installId });
    assert.equal(this.storage.portable, true);
    assert.equal(path.resolve(this.storage.targetDirectory), path.resolve(prep.expectedTarget));
    assert.equal(path.resolve(this.storage.sourceDirectory), path.resolve(prep.expectedLegacy));
    this.launch.storage = this.storage; this.launch.launchConfig = await this.native("get_launch_config");
    assert.equal(this.launch.launchConfig.mode, "fixed");
    const manifest = read(path.join(path.dirname(this.exe), "embedded-cartridge", "manifest.json"));
    await this.page.getByRole("heading", { name: manifest.title, exact: true }).waitFor();
    this.launch.fixtureTitle = manifest.title;
    // This Windows release does not expose stderr. Keep the empty log, rather
    // than treating a log message as a prerequisite or inventing source output.
    this.launch.stderrBytes = fs.statSync(logPath).size;
    save();
  }
}
const s = new FixedSession({ prep, fixture: prep.fixture, cartridges: prep.cartridges, out, report, save,
  installId: "preview_gamecli", currentNative: true });
let pendingACL = false, legacy;
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; return row.detail; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { save(); console.log(`${row.status}: ${name}`); }
}
function inventory(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith(".json")).sort()
    .map(name => ({ name, path: path.join(dir, name), sha256: sha(path.join(dir, name)), bytes: fs.statSync(path.join(dir, name)).size })) : [];
}
async function openSaves() {
  const screen = await s.screen();
  if (screen === "save_load") return;
  if (screen === "playing") {
    if (prep.layout === "renpy") await s.page.getByTestId("renpy-quick-save-load").click();
    else {
      await s.page.getByTestId("quick-menu-toggle").click();
      await s.page.getByRole("button", { name: "打开存档读档", exact: true }).click();
    }
  } else await s.page.getByTestId("open-save-load").click();
  await s.ready("save_load");
}
async function manual(slot) {
  await openSaves(); await s.page.getByRole("tab", { name: "手动", exact: true }).click();
  await s.page.getByRole("button", { name: "保存", exact: true }).click();
  await s.page.getByTestId(`save-slot-manual-${slot}`).locator(".save-card-main").click();
  await s.page.waitForFunction(() => document.querySelector(".save-operation-status")?.classList.contains("is-saved"));
  const result = read(path.join(prep.expectedTarget, `slot-${String(slot).padStart(2, "0")}.json`));
  assert.equal(result.install_id, "preview_gamecli"); assert.equal(result.game_id, prep.gameId);
  await s.page.keyboard.press("Escape"); await s.ready("playing"); return result;
}
const dialog = () => s.page.getByRole("dialog", { name: "复制旧存档到游戏目录？", exact: true });
async function migration() {
  await s.page.getByTestId("save-storage-open").click(); await dialog().waitFor();
  await dialog().getByRole("status").waitFor({ state: "detached" }); await settleRuntime(s.page);
}
function acl(action) {
  if (action === "Block") pendingACL = true;
  const stdout = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.resolve("scripts/native-portable-save-acl.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 20000 });
  const file = path.join(out, `portable-acl.json.${action === "Block" ? "block" : "restore"}.json`), data = read(file);
  assert.equal(data.status, action === "Block" ? "WRITE_DENIED" : "RESTORED");
  if (action === "Restore") { assert(data.comparison.permissionsMatch && data.probe.allowed); pendingACL = false; }
  else assert(data.isElevated === false && data.probe.accessDenied && data.probe.allowed === false);
  report.acls.push({ action, path: file, sha256: sha(file), data, stdout }); save(); return data;
}
async function geometry() {
  await settleRuntime(s.page);
  return dialog().evaluate(panel => {
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right,
      bottom: r.bottom, width: r.width, height: r.height }; };
    return { rect: rect(panel), focusInside: panel.contains(document.activeElement),
      overflow: document.documentElement.scrollWidth - innerWidth,
      clipped: panel.scrollWidth > panel.clientWidth + 1 || panel.scrollHeight > panel.clientHeight + 1,
      controls: [...panel.querySelectorAll("button")].map(b => {
        const r = rect(b); return { label: b.textContent.trim(), rect: r, disabled: b.disabled,
          hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      }) };
  });
}
function assertGeometry(g, v) {
  assert(g.focusInside && !g.clipped && g.overflow <= 1);
  assert(g.rect.x >= -1 && g.rect.y >= -1 && g.rect.right <= v.width + 1 && g.rect.bottom <= v.height + 1);
  assert(g.controls.length >= 3); assert(g.controls.every(c => c.hit && !c.disabled));
  for (const c of g.controls) assert(c.rect.x >= g.rect.x - 1 && c.rect.y >= g.rect.y - 1
    && c.rect.right <= g.rect.right + 1 && c.rect.bottom <= g.rect.bottom + 1);
  for (let a = 0; a < g.controls.length; a++) for (let b = a + 1; b < g.controls.length; b++) {
    const x = g.controls[a].rect, y = g.controls[b].rect;
    assert(!(Math.min(x.right, y.right) - Math.max(x.x, y.x) > 1
      && Math.min(x.bottom, y.bottom) - Math.max(x.y, y.y) > 1));
  }
}
(async () => {
  save();
  await check("Actual embedded bootstrap uses EXE-side game/legacy-identity path, not CWD or AppData", async () => {
    await s.start(prep.layout); assert.equal(fs.existsSync(prep.expectedTarget), false);
    assert.equal(fs.existsSync(prep.expectedLegacy), false);
    await s.page.getByTestId("start-new-game").click(); await s.ready("playing");
    await s.setAuto(false, true); await s.command("ordinary_nvl", 0);
    const first = await manual(1); assert.equal(first.command_index, 0);
    assert.equal(s.files().length, 1); assert.equal(fs.existsSync(prep.expectedLegacy), false);
    await s.shot("exe-side-manual-save");
    return { storage: s.storage, manual: first, files: s.files(), sourceCreated: false };
  });
  if (prep.smoke) { report.status = "PASS"; return; }
  await check("Prepare isolated real-save legacy variants; scan and cancel preserve every byte and conflict", async () => {
    await s.page.locator(".dialog-box").click(); await s.command("ordinary_nvl", 1);
    const current = await manual(5); assert.equal(current.command_index, 1);
    fs.mkdirSync(prep.expectedLegacy, { recursive: true });
    const variants = [
      ["slot-01.json", "manual", 1, prep.gameId], ["slot-02.json", "manual", 2, prep.gameId],
      ["auto-01.json", "auto", 1, prep.gameId], ["quick-06.json", "quick", 6, prep.gameId],
      ["slot-03.json", "manual", 3, "qa_unrelated_game"],
    ];
    for (const [name, kind, slot, game] of variants) fs.writeFileSync(path.join(prep.expectedLegacy, name),
      JSON.stringify({ ...current, save_id: `qa_migration_${prep.layout}_${kind}_${slot}`, game_id: game,
        save_kind: kind, slot }, null, 2), { flag: "wx" });
    fs.writeFileSync(path.join(prep.expectedLegacy, "slot-04.json"), "not a JSON save", { flag: "wx" });
    legacy = inventory(prep.expectedLegacy); report.legacySeed = legacy;
    const before = s.files(); await openSaves(); await migration();
    const text = await dialog().innerText();
    assert(text.includes("可复制 3 个") && text.includes("冲突未覆盖：slot-01.json"));
    assert(text.includes("slot-03.json") && text.includes("slot-04.json"));
    const info = await s.native("get_save_storage_info", { installId: s.installId });
    assert.deepEqual(info.availableFiles, ["auto-01.json", "quick-06.json", "slot-02.json"]);
    assert.deepEqual(info.conflictFiles, ["slot-01.json"]);
    assert.deepEqual(info.skippedFiles, ["slot-03.json", "slot-04.json"]);
    await dialog().getByRole("button", { name: "暂不迁移", exact: true }).click();
    assert.deepEqual(s.files(), before); assert.deepEqual(inventory(prep.expectedLegacy), legacy);
    report.targetBeforeMigration = before;
    return { before, after: s.files(), legacy, info, text };
  });
  await check("Migration confirmation geometry, hit targets, focus and cancel in all 12 display combinations", async () => {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const v = { width, height, dpr, reduced }, row = { ...v, status: "RUNNING" }; report.matrix.push(row); save();
        try {
          await s.viewport(v); await migration(); await s.page.keyboard.press("Tab");
          row.geometry = await geometry(); assertGeometry(row.geometry, v);
          await s.page.keyboard.press("Shift+Tab"); assert((await geometry()).focusInside);
          await s.shot(`migration-${width}-${dpr}-${reduced}`);
          await s.page.keyboard.press("Escape"); await dialog().waitFor({ state: "detached" });
          assert.deepEqual(s.files(), report.targetBeforeMigration);
          assert.deepEqual(inventory(prep.expectedLegacy), legacy); row.status = "PASS";
        } finally { save(); }
      }
    await s.viewport({ width: 1920, height: 1080, dpr: 1, reduced: false });
    return { combinations: report.matrix.length };
  });
  await check("Real non-admin EXE-side ACL denial blocks copying; exact restoration allows retry without fallback", async () => {
    const blocked = acl("Block");
    await s.page.getByRole("tab", { name: "手动", exact: true }).click();
    await s.page.getByRole("button", { name: "保存", exact: true }).click();
    await s.page.getByTestId("save-slot-manual-6").locator(".save-card-main").click();
    await s.page.locator(".save-operation-error").waitFor();
    const manualFailure = await s.page.locator(".save-operation-error").innerText();
    assert(manualFailure.includes("不会回退") && manualFailure.includes(prep.expectedTarget));
    assert.deepEqual(s.files(), report.targetBeforeMigration);
    assert.deepEqual(inventory(prep.expectedLegacy), legacy);
    assert(!fs.readdirSync(prep.expectedTarget).some(n => n.endsWith(".tmp")));
    await s.shot("manual-acl-denied");
    await migration(); await s.page.getByTestId("save-migration-confirm").click();
    await dialog().getByRole("alert").waitFor();
    const message = await dialog().getByRole("alert").innerText();
    assert(message.includes("不会回退") && message.includes(prep.expectedTarget));
    assert.equal(s.child.exitCode, null); assert.deepEqual(s.files(), report.targetBeforeMigration);
    assert.deepEqual(inventory(prep.expectedLegacy), legacy); await s.shot("migration-acl-denied");
    const restored = acl("Restore"); await s.page.getByTestId("save-migration-confirm").click();
    await dialog().waitFor({ state: "detached" });
    const notice = await s.page.locator(".save-operation-status").innerText();
    assert(notice.includes("已复制 3 个旧存档") && notice.includes("1 个冲突") && notice.includes("源存档保留"));
    const after = s.files(); assert.equal(after.length, 5);
    for (const old of report.targetBeforeMigration) assert(after.some(f => f.name === old.name && f.sha256 === old.sha256));
    for (const name of ["slot-02.json", "auto-01.json", "quick-06.json"])
      assert.equal(sha(path.join(prep.expectedTarget, name)), legacy.find(f => f.name === name).sha256);
    assert.deepEqual(inventory(prep.expectedLegacy), legacy);
    const info = await s.native("get_save_storage_info", { installId: s.installId });
    assert.deepEqual(info.availableFiles, []); assert.deepEqual(info.conflictFiles, ["slot-01.json"]);
    await s.shot("migration-retry");
    const manualRetry = await manual(6); assert.equal(manualRetry.command_index, 1);
    assert.equal(s.files().length, 6);
    for (const f of after) assert.equal(sha(f.path), f.sha256);
    assert.deepEqual(inventory(prep.expectedLegacy), legacy);
    return { blocked, manualFailure, message, restored, afterMigration: after,
      after: s.files(), manualRetry, info, notice };
  });
  await check("Actual new fixed Player process reads copied manual/auto/quick entries and restores migrated progress", async () => {
    const before = s.files(); await s.stop(); await s.start(prep.layout);
    assert.deepEqual(s.files(), before); assert.deepEqual(inventory(prep.expectedLegacy), legacy);
    assert.equal((await s.prefs()).autoSaveEnabled, false);
    await openSaves();
    for (const [label, kind, slot] of [["自动", "auto", 1], ["快存", "quick", 6], ["手动", "manual", 2]]) {
      await s.page.getByRole("tab", { name: label, exact: true }).click();
      assert(await s.page.getByTestId(`save-slot-${kind}-${slot}`).locator(".save-card-main").isEnabled());
    }
    await s.page.getByRole("button", { name: "读取", exact: true }).click();
    await s.page.getByTestId("save-slot-manual-2").locator(".save-card-main").click();
    await s.ready("playing"); await s.command("ordinary_nvl", 1);
    await s.shot("migration-restart-read");
    assert.deepEqual(inventory(prep.expectedLegacy), legacy);
    return { files: s.files(), restored: { scene: "ordinary_nvl", command: 1 }, actualNewProcess: true };
  });
  assert.equal(report.checks.length, 5); assert.equal(report.matrix.length, 12); report.status = "PASS";
})().catch(e => {
  report.status = "FAILED"; report.error = String(e.stack || e);
  if (s.page) report.failureCapture = s.shot("failure").catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  try {
    if (report.failureCapture) { await report.failureCapture; delete report.failureCapture; }
    if (pendingACL && fs.existsSync(path.join(out, "portable-acl.json"))) acl("Restore");
    report.finalTarget = s.storage ? s.files() : inventory(prep.expectedTarget);
    report.finalLegacy = inventory(prep.expectedLegacy);
    if (legacy) assert.deepEqual(report.finalLegacy, legacy);
    await s.stop();
    for (const f of prep.resources) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(prep.executable.path), prep.sourceExecutable.sha256);
    assert.deepEqual(report.pageErrors, []);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, layout: prep.layout, smoke: prep.smoke,
    checks: report.checks.length, matrix: report.matrix.length, error: report.error, cleanupError: report.cleanupError, out }));
});
