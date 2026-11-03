"use strict";
// Actual frozen installation. UI inputs only; preview_gamecli is explicitly
// one preview identity, never evidence of independent library/game identities.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { InstalledPreview1922Session } = require("./lib/installed-runtime-preview-1922-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { measureSettingsIconProportions, assertSettingsIconProportions } = require("./lib/runtime-settings-proportions.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const playerSha = "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59";
const groups = [
  { id: "display", label: "显示", controls: [
    ["fontScale", "Font scale", 1, 1.35], ["lineSpacing", "Line spacing", 1, 1.25],
    ["highContrastText", "High contrast text", false, true],
  ] },
  { id: "text", label: "文字", controls: [
    ["textSpeedCps", "Text speed", 36, 74], ["autoForwardTime", "Auto forward time", 6, 11.5],
    ["autoForwardAfterClick", "Auto forward after click", false, true],
  ] },
  { id: "audio", label: "音频", controls: [
    ["volumeMaster", "Master volume", 1, .55], ["volumeBgm", "Background music volume", .8, .25],
    ["muteBgm", "Mute background music", false, true],
    ["volumeSfx", "Sound effects volume", .9, .45], ["muteSfx", "Mute sound effects", false, true],
    ["volumeVoice", "Voice volume", .9, .65], ["muteVoice", "Mute voice", false, true],
    ["muteAll", "Mute all", false, true],
  ] },
  { id: "skip", label: "跳过", controls: [
    ["skipUnread", "Skip unread text", false, true], ["skipAfterChoices", "Skip after choices", false, true],
  ] },
  { id: "system", label: "系统", controls: [["autoSaveEnabled", "自动存档", true, false]] },
];
const controls = groups.flatMap(g => g.controls);
const values = index => Object.fromEntries(controls.map(c => [c[0], c[index]]));
function equal(actual, expected, label) {
  if (typeof expected === "number") assert(Math.abs(Number(actual) - expected) < .00001, `${label}: ${actual} != ${expected}`);
  else assert.equal(actual, expected, label);
}
function validatePrefs(prefs, expected) {
  assert.equal(prefs?.schemaVersion, 8); assert.equal(prefs.language, "zh-CN");
  assert.equal(prefs.transitions, "all"); equal(prefs.textSpeed, expected.textSpeedCps, "legacy alias");
  for (const c of controls) equal(prefs[c[0]], expected[c[0]], c[0]);
  for (const k of ["rollbackSideDesktop", "rollbackSideMobile", "titleBackgroundDimmingOverride", "settingsPanelBackgroundDimmingOverride"])
    assert(!Object.hasOwn(prefs, k), `Retired setting reappeared: ${k}`);
}
function validateGeometry(m, viewport, group) {
  assert.equal(m.current, group.id); assert(m.overflow <= 1 && m.categoryScroll <= 1);
  const bounded = r => r.x >= -1 && r.y >= -1 && r.right <= viewport.width + 1 && r.bottom <= viewport.height + 1;
  assert(bounded(m.panel) && m.panel.width < viewport.width * .95, "Settings must stay bounded");
  assert.equal(m.controls.length, 8 + group.controls.length);
  for (const c of m.controls) assert(c.hit && !c.inert && !c.disabled && !c.clipped &&
    c.rect.width > 0 && c.rect.height > 0 && bounded(c.rect), `Unavailable: ${c.label}`);
  for (let i = 0; i < m.controls.length; i++) for (let j = i + 1; j < m.controls.length; j++) {
    const a = m.controls[i].rect, b = m.controls[j].rect;
    assert(!(Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1), "Controls overlap");
  }
}
const expectedChecks = [
  "agentvn-default-values", "agentvn-change-complete-reopen", "renpy-shared-preview-identity-after-native-restart",
  "renpy-all-controls-and-display-matrix", "agentvn-all-controls-and-display-matrix",
  "agentvn-reset-defaults", "renpy-reset-persists-after-native-restart",
];
function validateBusiness(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError);
  assert.equal(r.scope, "ACTUAL_1922_SHIPPED_PREVIEW_ALL17_SETTINGS_SHARED_PREVIEW_IDENTITY");
  assert.equal(r.executable.sha256, playerSha);
  assert.equal(r.identity, "preview_gamecli");
  assert.equal(r.normalCloseClaimed, false);
  for (const key of ["productChanges", "builds", "modelRequests"]) assert.equal(r[key], 0);
  assert.deepEqual(r.checks.map(c => c.name), expectedChecks);
  assert(r.checks.every(c => c.status === "PASS" && c.finishedAt));
  assert.deepEqual(r.pageErrors, []);
  assert.equal(r.launches.length, 5);
  assert.equal(new Set(r.launches.map(l => `${l.identity.ProcessId}:${l.identity.Created}`)).size, 5);
  for (const l of r.launches) {
    assert.equal(l.executableSha256, playerSha); assert(l.knownProcesses.length >= 2);
    assert.equal(l.provenance, "ACTUAL_1922_NSIS_SHIPPED_PLAYER_PREVIEW_NOT_STANDALONE");
    assert.equal(l.cleanup?.status, "PASS");
    assert.equal(l.cleanup.method, "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE");
    assert.equal(path.resolve(l.webview), path.join(path.resolve(r.out), "webview-settings-main"));
  }
  const expected = ["renpy", "agentvn"].flatMap(layout => [1920, 2560, 3840].flatMap(width =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ layout, width, height: width * 9 / 16, dpr, reduced })))));
  assert.deepEqual(r.matrix.map(({ layout, width, height, dpr, reduced }) => ({ layout, width, height, dpr, reduced })), expected);
  for (const m of r.matrix) {
    assert.equal(m.status, "PASS"); assert.equal(m.categories.length, 5);
    assert.deepEqual(m.categories.map(g => g.id), groups.map(g => g.id));
    for (const [i, g] of m.categories.entries()) {
      validateGeometry(g.geometry, m, groups[i]); assertSettingsIconProportions(g.icons);
      assert.equal(g.focused, true);
    }
    validatePrefs(m.prefs, values(3));
    assert.deepEqual(m.screenshot.before, m.screenshot.after);
    validateNativeViewport(m.screenshot.before, m);
  }
  assert.equal(r.screenshots.length, 24);
  const changed = r.checks.find(c => c.name === "agentvn-change-complete-reopen").detail;
  assert.equal(changed.changed.length, 17); validatePrefs(changed.reopened, values(3));
  const loaded = r.checks.find(c => c.name === "renpy-shared-preview-identity-after-native-restart").detail;
  assert.deepEqual(loaded.prefs, changed.reopened);
  validatePrefs(r.checks.find(c => c.name === "renpy-reset-persists-after-native-restart").detail.prefs, values(2));
  assert(r.inputs.length > 100 && r.inputs.every(e => e.trusted === true));
}
async function main() {
  const attempt = process.argv[2]; assert.match(attempt, /^\d{2}$/);
  const out = path.join(base, `installed-settings-1922-${attempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), out,
    scope: "ACTUAL_1922_SHIPPED_PREVIEW_ALL17_SETTINGS_SHARED_PREVIEW_IDENTITY",
    identity: "preview_gamecli", productChanges: 0, builds: 0, modelRequests: 0, normalCloseClaimed: false,
    commands: [], checks: [], launches: [], matrix: [], screenshots: [], pageErrors: [], inputs: [],
    notClaimed: ["different game identity isolation", "default library storage", "normal native close",
      "standalone/setup", "Android", "physical 4K", "new audio listening", "full product acceptance"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  let prepared = false, s, prep;
  async function command(exe, args, label) {
    const c = { label, command: [exe, ...args], startedAt: new Date().toISOString(),
      status: "RUNNING", log: path.join(out, `${label}.log`) };
    report.commands.push(c); save();
    const fd = fs.openSync(c.log, "wx");
    try {
      const child = spawn(exe, args, { cwd: path.resolve(__dirname, ".."), env: process.env,
        windowsHide: true, stdio: ["ignore", fd, fd] });
      c.pid = child.pid; save();
      c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      c.status = c.exitCode === 0 ? "PASS" : "FAILED"; assert.equal(c.exitCode, 0, label);
    } finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
  }
  const profile = action => command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "scripts/native-dev-preview-profile.ps1", "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  `profile-${action.toLowerCase()}`);
  async function check(name, fn) {
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() };
    report.checks.push(c); save(); console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e);
      if (s?.page) {
        c.body = (await s.page.locator("body").innerText().catch(() => "")).slice(-6000);
        await s.shot(`failed-${report.checks.length}`).catch(() => {});
      }
      throw e;
    } finally { c.finishedAt = new Date().toISOString(); save(); }
  }
  async function stop() {
    if (!s) return;
    try {
      if (s.page && !s.page.isClosed()) {
        const events = await s.page.evaluate(() => window.__qaSettingsInputs);
        report.inputs.push(...events.map(e => ({ ...e, pid: s.child.pid, layout: s.layout }))); save();
      }
    } finally { await s.stop(); s = undefined; }
  }
  async function start(layout) {
    await stop();
    s = new InstalledPreview1922Session({ prep, fixture: prep.fixture, cartridges: prep.cartridges, out,
      report, save, installId: report.identity, currentNative: true });
    await s.start(layout);
    await s.page.evaluate(() => {
      window.__qaSettingsInputs = [];
      for (const type of ["click", "keydown"]) document.addEventListener(type, e => {
        const n = e.target?.closest("button,input");
        if (n) window.__qaSettingsInputs.push({ type, trusted: e.isTrusted, key: e.key,
          label: n.getAttribute("aria-label") || n.getAttribute("data-testid") || n.textContent.trim() });
      }, true);
    });
    await s.openSettings();
  }
  async function tab(group) {
    await s.page.locator(".settings-tabs").getByRole("button", { name: group.label, exact: true }).click();
    await s.page.waitForFunction(id => {
      const node = document.querySelector(`[data-settings-tab-current="${id}"]`);
      return node && !node.closest("[inert]") &&
        (document.querySelector("[data-settings-transition]")?.getAttribute("data-settings-transition") ?? "idle") === "idle";
    }, group.id);
  }
  const node = c => s.page.getByRole(typeof c[2] === "boolean" ? "checkbox" : "slider", { name: c[1], exact: true });
  async function readAll(expected) {
    for (const g of groups) {
      await tab(g);
      assert.equal(await s.page.locator(".settings-category-content input").count(), g.controls.length);
      for (const c of g.controls) equal(typeof c[2] === "boolean" ? await node(c).isChecked()
        : Number(await node(c).inputValue()), expected[c[0]], c[0]);
    }
    const prefs = await s.prefs(); validatePrefs(prefs, expected); return prefs;
  }
  async function changeAll(expected) {
    const changed = [];
    for (const g of groups) {
      await tab(g);
      for (const c of g.controls) {
        const n = node(c);
        if (typeof c[2] === "boolean") {
          if (await n.isChecked() !== expected[c[0]]) await n.click();
        } else {
          const { min, step } = await n.evaluate(e => ({ min: Number(e.min), step: Number(e.step) }));
          const steps = Math.round((expected[c[0]] - min) / step);
          assert(steps >= 0 && steps <= 100);
          await n.focus(); await n.press("Home");
          for (let i = 0; i < steps; i++) await n.press("ArrowRight");
        }
        const actual = typeof c[2] === "boolean" ? await n.isChecked() : Number(await n.inputValue());
        equal(actual, expected[c[0]], c[0]);
        assert(await n.evaluate(e => document.activeElement === e && !e.closest("[inert]")));
        changed.push({ key: c[0], value: actual });
      }
    }
    validatePrefs(await s.prefs(), expected); return changed;
  }
  async function geometry() {
    return s.page.locator(".settings-renpy").evaluate(panel => {
      const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y,
        right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      return { panel: rect(panel), overflow: document.documentElement.scrollWidth - innerWidth,
        categoryScroll: panel.querySelector(".settings-tabs").scrollHeight - panel.querySelector(".settings-tabs").clientHeight,
        current: panel.querySelector("[data-settings-tab-current]").dataset.settingsTabCurrent,
        controls: [...panel.querySelectorAll("button,input")].map(e => {
          const r = rect(e); let clipped = false;
          for (let p = e.parentElement; p && p !== panel.parentElement; p = p.parentElement) {
            const css = getComputedStyle(p), pr = rect(p);
            if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX) && (r.x < pr.x - 1 || r.right > pr.right + 1)) clipped = true;
            if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY) && (r.y < pr.y - 1 || r.bottom > pr.bottom + 1)) clipped = true;
          }
          return { label: e.getAttribute("aria-label") || e.textContent.trim(), rect: r, clipped,
            disabled: e.disabled, inert: Boolean(e.closest("[inert]")),
            hit: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
        }) };
    });
  }
  async function matrix(layout) {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const m = { layout, width, height, dpr, reduced, status: "RUNNING", categories: [] };
        report.matrix.push(m); save();
        try {
          await s.viewport({ width, height, dpr, reduced });
          for (const g of groups) {
            await tab(g); await node(g.controls[0]).focus();
            const sample = { id: g.id, geometry: await geometry(),
              focused: await node(g.controls[0]).evaluate(e => document.activeElement === e && !e.closest("[inert]")),
              icons: await s.page.evaluate(measureSettingsIconProportions) };
            m.categories.push(sample); save();
            validateGeometry(sample.geometry, m, g); assertSettingsIconProportions(sample.icons); assert(sample.focused);
            for (const c of g.controls) equal(typeof c[2] === "boolean" ? await node(c).isChecked()
              : Number(await node(c).inputValue()), c[3], c[0]);
          }
          m.prefs = await s.prefs(); validatePrefs(m.prefs, values(3));
          await s.shot(`settings-${width}-${dpr}-${reduced}`); m.screenshot = report.screenshots.at(-1);
          m.status = "PASS"; console.log(`PASS matrix ${layout} ${width} DPR${dpr} reduced=${reduced}`);
        } catch (e) { m.status = "FAILED"; m.error = String(e.stack || e); throw e; }
        finally { save(); }
      }
    return { combinations: 12, categoryClicks: 60 };
  }
  try {
    save();
    report.checkpoint = desc("F:/AgentVN/Checkpoints/Installed-Runtime-Settings-1922-20261023-01/report.json");
    report.protectedProducts = read(report.checkpoint.path).products;
    for (const f of report.protectedProducts) assert.equal(sha(f.path), f.sha256);
    report.installation = desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json");
    const installed = read(report.installation.path);
    assert.equal(installed.status, "PASS"); assert.equal(installed.version, "1.9.22");
    for (const f of [installed.executable, ...installed.resources, installed.originalAudit, installed.originalInstallation])
      assert.equal(sha(f.path), f.sha256);
    report.executable = desc(path.join(installed.installRoot, "agentvn-player.exe"));
    assert.equal(report.executable.sha256, playerSha);
    report.sources = [
      desc("F:/AgentVN/QA/Windows-Package-20261021-01/editor-04/report.json"),
      desc("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-44/report.json"),
    ];
    const [win, renpy] = report.sources.map(f => read(f.path));
    assert.equal(win.status, "PASS"); assert.equal(renpy.status, "PASS");
    report.cartridges = [{ ...win.observedFiles.find(f => f.path.endsWith(".vncart")), layout: "agentvn" },
      { ...renpy.cartridge, layout: "renpy" }];
    for (const f of report.cartridges) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(win.input.path), win.input.sha256);
    report.environment = { AGENTVN_TEST_PROJECT: win.input.path, AGENTVN_WORKSPACE_OUTPUT: out };
    Object.assign(process.env, report.environment);
    const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
    assert(!rows().some(p => /^(agentvn-player|agentvn-editor|AgentVN Dev)\.exe$/i.test(p.Name)));
    for (const test of ["installed-runtime-settings-1922-profile-test.cjs", "native-runtime-state-viewport-test.cjs"])
      await command(process.execPath, [`scripts/${test}`], `guard-${test}`);
    report.tools = [__filename, "scripts/lib/installed-runtime-preview-1922-session.cjs",
      "scripts/lib/installed-runtime-session.cjs", "scripts/lib/runtime-settings-proportions.cjs",
      "scripts/lib/current-native-capture.cjs", "scripts/native-dev-preview-profile.ps1"].map(f => {
      const source = desc(f), copy = path.join(out, "tools", path.basename(f));
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source.path, copy, fs.constants.COPYFILE_EXCL);
      return { ...source, copy };
    });
    prepared = true; await profile("Prepare");
    const journal = read(path.join(out, "profile-protection.json"));
    prep = { status: "PASS", sessionRoot: out, executable: report.executable,
      defaultStorage: "CODEX_EXPLICIT_PROFILE_JUNCTION_PREVIEW", current1922Preview: true,
      previewWebviewProfile: "settings-main", profiles: journal.records.filter(r => r.existed),
      fixture: { input: win.input.path, inputSha256: win.input.sha256 }, cartridges: report.cartridges, temporary };
    fs.writeFileSync(path.join(out, "preparation.json"), JSON.stringify(prep, null, 2), { flag: "wx" });
    await start("agentvn");
    await check(expectedChecks[0], async () => ({ prefs: await readAll(values(2)) }));
    await check(expectedChecks[1], async () => {
      const changed = await changeAll(values(3)); await s.finishSettings();
      assert.equal(await s.screen(), "title_menu"); await s.openSettings();
      return { changed, reopened: await readAll(values(3)) };
    });
    await start("renpy");
    await check(expectedChecks[2], async () => ({ prefs: await readAll(values(3)), nativeRestart: true }));
    await check(expectedChecks[3], () => matrix("renpy"));
    await start("agentvn");
    await check(expectedChecks[4], () => matrix("agentvn"));
    await check(expectedChecks[5], async () => {
      await s.page.getByTestId("settings-reset-default").click();
      return { prefs: await readAll(values(2)) };
    });
    await start("renpy");
    await check(expectedChecks[6], async () => ({ prefs: await readAll(values(2)), nativeRestart: true }));
    // Final launch reads the original layout after reset without adding an
    // untracked side flow to the asserted seven business requirements.
    await start("agentvn"); report.finalOriginalLayoutDefaults = await readAll(values(2));
    await stop();
    report.status = "PASS"; report.finishedAt = new Date().toISOString(); validateBusiness(report);
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try {
      await stop();
      assert(!rows().some(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(out)));
      if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
        await profile("Restore"); report.restoration = desc(path.join(out, "profile-restoration.json"));
        assert.equal(read(report.restoration.path).status, "PASS");
      }
      for (const f of [...report.protectedProducts || [], ...report.tools || [], ...report.cartridges || []])
        assert.equal(sha(f.path), f.sha256);
      assert.deepEqual(listeners(report.launches.map(l => l.port)), []);
      if (report.status === "PASS") validateBusiness(report);
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, matrix: report.matrix.length,
      checks: report.checks.length, error: report.error, cleanupError: report.cleanupError }));
  }
}
module.exports = { validateBusiness, validateGeometry, validatePrefs, groups };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
