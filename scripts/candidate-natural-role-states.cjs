"use strict";
// Real native library actions, with read-only RAF/mutation observation. No
// delayed IO, forced control state, store writes, or replacement cartridges.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), { gzipSync, gunzipSync } = require("node:zlib");
const JSZip = require("../editor/node_modules/jszip");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { waitNativeRuntimePage } = require("./lib/wait-native-runtime-page.cjs");
const [mode, attempt, configArg, authorArg, playerArg] = process.argv.slice(2);
assert(process.argv.slice(2).length <= 5);
assert(["self-test", "run", "audit"].includes(mode)); assert.match(attempt || "", /^\d{2}$/);
assert(configArg?.startsWith("--candidate-config="));
const installed = Boolean(authorArg || playerArg);
if (installed) assert(authorArg?.startsWith("--author-report=") && playerArg?.startsWith("--installed-player-report="),
  "Current installed transient checks require both current author and current Player evidence");
const root = path.resolve(__dirname, "..");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const configFile = configArg.slice(19), config = validateCandidateConfig(read(configFile));
const actual = deriveActual(config.actual, config.version);
const authorFile = installed ? authorArg.slice("--author-report=".length)
  : "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-28/report.json", author = read(authorFile);
assert.equal(author.status, "PASS"); assert.equal(author.version, config.version);
assert(author.cases.length === 4 && author.cases.every(c => c.status === "PASS"));
assert.deepEqual(read(author.installation.path).executable, actual.executable);
for (const f of [author.fixture, author.cartridge, author.installation, ...actual.resources]) assert.equal(sha(f.path), f.sha256);
const nativeFile = installed ? path.join(actual.installRoot, "agentvn-player.exe")
  : path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe");
const executable = desc(nativeFile);
// Default: the independently reviewed new native. Explicit installed inputs:
// the current NSIS Player and its current author/player receipts.
const priorNativeFile = installed ? playerArg.slice("--installed-player-report=".length)
  : `F:/AgentVN/QA/Native-Runtime-State-20261020-01/roles-native-${config.version.replaceAll(".", "")}-03/report.json`;
const priorNative = read(priorNativeFile);
assert.equal(priorNative.status, "PASS");
assert.equal((installed ? priorNative.qaBinding.installedPlayer : priorNative.qaBinding.nativePlayer).sha256, executable.sha256);
if (installed) {
  assert.equal(priorNative.version, config.version);
  assert.equal(path.resolve(priorNative.author.path), path.resolve(authorFile));
  assert.equal(priorNative.author.sha256, sha(authorFile));
  assert.equal(priorNative.source.sha256, author.cartridge.sha256);
  assert.equal(priorNative.profileRestoration.status, "PASS");
  assert.equal(priorNative.checks.length, 3); assert(priorNative.checks.every(c => c.status === "PASS"));
  assert.equal(priorNative.matrix.length, 12); assert.equal(priorNative.storyMatrix.length, 12);
  assert(priorNative.matrix.every(c => c.status === "PASS") && priorNative.storyMatrix.every(c => c.status === "PASS"));
  assert.equal(priorNative.launches.length, 1);
  assert(priorNative.launches.every(l => l.executableSha256 === executable.sha256 && l.cleanup.status === "PASS"));
}
const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/natural-roles-${installed ? "installed" : "native"}-${config.version.replaceAll(".", "")}-${attempt}`;
const auditFile = path.join(config.qa, `natural-roles-audit-${attempt}.json`);
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const rgb = c => `rgb(${[1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)).join(", ")})`;
const roles = author.authored.settings.runtimeUILayoutProfiles.profiles.renpy.renpy.shared.buttonRoles;
const bindings = [configFile, config.actual.path, authorFile, author.fixture.path, author.cartridge.path,
  author.installation.path, priorNativeFile, nativeFile, "AGENTS.md", "plans/ACTIVE_TASKS.md",
  __filename, "scripts/lib/installed-runtime-session.cjs", "scripts/lib/current-native-capture.cjs",
  "scripts/lib/current-native-editor-session.cjs", "scripts/lib/owned-process-tree.cjs",
  "scripts/lib/owned-process-stop.cjs", "scripts/native-dev-preview-profile.ps1"].map(desc);
if (installed) bindings.push(desc("scripts/lib/wait-native-runtime-page.cjs"));
function validateCell(c) {
  assert.equal(c.status, "PASS"); assert(c.finishedAt);
  assert.deepEqual(c.viewport, matrix.find(v => JSON.stringify(v) === JSON.stringify(c.viewport)));
  for (const kind of ["title", "navigation", "choice-entry", "choice-exit", "modal"]) {
    const o = c.observations.find(o => o.kind === kind);
    assert(o && o.frames > 0 && o.renderedSamples > 0 && o.exactColor > 0, `${kind}: missing rendered authored state`);
    if (kind === "choice-entry" && c.viewport.reduced) {
      assert.equal(o.expectedState, "normal"); assert.equal(o.disabledRendered, 0);
      assert(o.intermediateFrames > 0); assert.equal(o.spatialFrames, 0);
    } else {
      assert.equal(o.expectedState, "disabled"); assert(o.disabledRendered > 0);
    }
    assert.equal(o.overflow, 0); assert.equal(o.geometryViolations, 0);
    assert(o.trustedClicks > 0, `${kind}: missing actual user input`);
  }
  assert.equal(c.quickDisabled.state, "disabled"); assert.equal(c.quickDisabled.color, rgb(roles.quick_bar.states.disabled.textColor));
  assert.equal(c.newSaves.length, 1); assert.equal(c.newSaves[0].data.save_kind, "auto");
  const saved = c.newSaves[0].data;
  assert.equal(saved.scene_id, "ui_acceptance"); assert.equal(saved.command_index, 0);
  assert.equal(saved.dialog.text, "安装版六类按钮实际消费。");
  assert.equal(saved.history.length, 2);
  assert(saved.history.every(h => h.scene_id === saved.scene_id && h.text === saved.dialog.text));
  assert.equal(saved.install_id, c.installId); assert.equal(saved.game_id, c.installId);
  assert.equal(saved.dialog_page_index, 0); assert.equal(saved.dialog_page_count, 1);
  assert(c.normalExitObserved, "Force termination cannot prove confirmed exit");
}
function validateSummary(r) {
  assert.equal(r.status, "PASS"); assert.equal(r.cells.length, 12); assert.equal(r.launches.length, 12);
  assert.equal(r.screenshots.length, 12); assert.deepEqual(r.pageErrors, []);
  assert.equal(r.cells.filter(c => c.status === "PASS").length, 12);
  for (const v of matrix) {
    const cells = r.cells.filter(c => JSON.stringify(c.viewport) === JSON.stringify(v)); assert.equal(cells.length, 1);
    validateCell(cells[0]);
  }
  assert.equal(r.profileRestoration?.status, "PASS");
  if (installed) for (const launch of r.launches) {
    assert.equal(launch.executableSha256, executable.sha256);
    assert.equal(launch.scope, "ACTUAL_CURRENT_NSIS_SHIPPED_LIBRARY_NOT_STANDALONE_ANDROID");
    assert(launch.targetReadiness?.readyAt && launch.targetReadiness.events.at(-1)?.candidates === 1);
  }
}
function analyze(data, kind, expected, viewport) {
  const frames = data.filter(f => f.kind === kind && f.source === "raf");
  const expectedState = kind === "choice-entry" && viewport.reduced ? "normal" : "disabled";
  const rendered = frames.flatMap(f => f.controls.filter(n => n.disabled === (expectedState === "disabled") && n.visible && n.opacity > 0
    && f.blackoutOpacity < .95).map(n => ({ ...n, frame: f })));
  const violations = rendered.filter(n => {
    const r = n.rect;
    return r.left < -1 || r.top < -1 || r.right > viewport.width + 1 || r.bottom > viewport.height + 1
      || n.clipped || n.textRects.some(t => t.left < r.left - 1 || t.right > r.right + 1
        || t.top < r.top - 1 || t.bottom > r.bottom + 1);
  });
  return { kind, expectedState, frames: frames.length, renderedSamples: rendered.length,
    disabledRendered: frames.flatMap(f => f.controls.filter(n => n.disabled && n.visible && n.opacity > 0)).length,
    exactColor: rendered.filter(n => n.color === expected).length,
    intermediateFrames: rendered.filter(n => n.opacity > .01 && n.opacity < .99).length,
    spatialFrames: rendered.filter(n => n.transform !== "none").length,
    geometryViolations: violations.length, violations,
    overflow: frames.filter(f => f.overflow > 1).length,
    trustedClicks: data.filter(f => f.kind === kind && f.source === "click" && f.trusted).length };
}
if (mode === "self-test") {
  assert(!fs.existsSync(out)); assert(!fs.existsSync(auditFile));
  assert.equal(matrix.length, 12); assert.equal(Object.keys(roles).length, 6);
  assert.throws(() => validateSummary({ status: "PASS", cells: [], launches: [], screenshots: [], pageErrors: [] }));
  const missing = { source: "raf", kind: "modal", controls: [], blackoutOpacity: 0, overflow: 0 };
  assert.equal(analyze([missing], "modal", "#fff", matrix[0]).disabledRendered, 0);
  console.log(JSON.stringify({ status: "PASS", displays: 12, roles: 6, realTransientPaths: 5,
    previewRejectedAsSaveEvidence: true, productStarts: 0, executable, author: desc(authorFile) }));
  return;
}
if (mode === "audit") {
  assert(!fs.existsSync(auditFile));
  const reportFile = path.join(out, "report.json"), r = read(reportFile);
  const audit = { status: "RUNNING", startedAt: new Date().toISOString(), input: desc(reportFile), checks: [] };
  try {
    validateSummary(r); audit.checks.push("Exact twelve-display matrix and five natural transient paths");
    for (const f of r.bindings) assert.equal(sha(f.path), f.sha256, f.path);
    assert.deepEqual(r.executable, executable);
    assert.deepEqual(r.author, desc(authorFile));
    audit.checks.push(installed ? "Current installed author and real NSIS shipped Player provenance"
      : "Installed author and explicitly separate new-native provenance");
    for (const c of r.cells) {
      assert.equal(sha(c.trace.path), c.trace.sha256);
      const data = JSON.parse(gunzipSync(fs.readFileSync(c.trace.path)));
      for (const o of c.observations) {
        const role = ({ title: "title_action", navigation: "page_navigation", "choice-entry": "story_choice",
          "choice-exit": "story_choice", modal: "modal_action" })[o.kind];
        const state = o.kind === "choice-entry" && c.viewport.reduced ? "normal" : "disabled";
        assert.deepEqual(analyze(data, o.kind, rgb(roles[role].states[state].textColor), c.viewport), o);
      }
      for (const f of c.newSaves) { assert.equal(sha(f.path), f.sha256); assert.deepEqual(read(f.path), f.data); }
    }
    audit.checks.push("Raw rendered frames, real clicks, bounds, authored colors and actual auto-save bytes");
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const b = fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16), Math.round(s.before.width * s.before.dpr));
      assert.equal(b.readUInt32BE(20), Math.round(s.before.height * s.before.dpr));
    }
    const now = rows();
    for (const l of r.launches) {
      assert.equal(l.cleanup.status, "PASS"); assert(l.cleanup.normalExitObserved);
      assert(!now.some(p => l.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
    }
    assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
    for (const p of r.profileRestoration.restored) for (const f of p.files)
      assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
    assert.equal(r.profileRestoration.deletedUserFiles, 0);
    for (const bad of [{ ...r, cells: [] }, { ...r, screenshots: [] },
      { ...r, cells: r.cells.map((c, i) => i ? c : { ...c, observations: c.observations.slice(1) }) }])
      assert.throws(() => validateSummary(bad));
    audit.checks.push("Strict PNG/DPR, native exit, exact process/port and original-profile restoration; bad receipts rejected");
    audit.status = "PASS";
  } catch (e) { audit.status = "FAILED"; audit.error = String(e.stack || e); process.exitCode = 1; }
  audit.finishedAt = new Date().toISOString();
  fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2), { flag: "wx" }); console.log(JSON.stringify(audit));
  return;
}
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: installed
    ? "CURRENT_NSIS_EDITOR_AUTHOR_AND_SHIPPED_PLAYER_LIBRARY_NATURAL_TRANSIENTS_NOT_SETUP_UPGRADE_OR_ANDROID"
    : "INSTALLED_SIX_ROLE_AUTHOR_NEW_NATIVE_LIBRARY_NATURAL_TRANSIENTS_NOT_FROZEN_PLAYER_SETUP_UPGRADE_OR_ANDROID",
  executable, author: desc(authorFile), bindings, cells: [], launches: [], screenshots: [], pageErrors: [],
  modelRequests: 0, productChanges: 0, builds: 0,
  unavailableStates: { title_action: { selected: "No persistent selected title action" },
    modal_action: { selected: "Actions do not expose a persistent selected state" } } };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let session, prepared = false;
const prep = { status: "PASS", profiles: [], sessionRoot: out, executable,
  defaultStorage: "PHYSICAL_DEFAULT_PATH", temporary: path.join(out, "temporary"), webview: path.join(out, "webview") };
function profile(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out,
    "-CodexCacheView", "-Storage", "NativeRoaming"], { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), result.stdout + result.stderr, { flag: "wx" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
class NaturalSession extends InstalledRuntimeSession {
  constructor(options) {
    super({ ...options, currentNative: true }); this.known = new Map();
    if (installed) this.resolveRuntimePage = async () => {
      const ready = this.launch.targetReadiness = { events: [] }; this.save();
      const page = await waitNativeRuntimePage(this.browser, {
        observe: event => { ready.events.push({ ...event, at: new Date().toISOString() }); this.save(); },
      });
      ready.readyURL = page.url(); ready.readyAt = new Date().toISOString(); this.save(); return page;
    };
  }
  remember() {
    if (!this.child) return;
    const all = rows(), p = all.find(p => p.ProcessId === this.child.pid);
    if (p) {
      assert.equal(path.resolve(p.ExecutablePath), path.resolve(this.exe));
      this.rootIdentity ??= p; assert.equal(p.Created, this.rootIdentity.Created);
      for (const n of ownedProcessTree(all, p.ProcessId, p.Created)) this.known.set(`${n.ProcessId}:${n.Created}`, n);
    }
    if (this.launch) { this.launch.knownProcesses = [...this.known.values()]; this.save(); }
  }
  async start(...args) {
    await super.start(...args); this.remember();
    if (installed) { this.launch.scope = "ACTUAL_CURRENT_NSIS_SHIPPED_LIBRARY_NOT_STANDALONE_ANDROID"; this.save(); }
    assert(listeners([this.launch.port]).every(l => [...this.known.values()].some(p => p.ProcessId === l.OwningProcess)));
  }
  async stop(normal = false) {
    if (!this.child) return;
    this.remember();
    if (normal) await until(() => this.child.exitCode !== null, "actual confirmed native window exit", 20000);
    await this.browser?.close().catch(() => {});
    // Recheck all remembered children using one process snapshot. Never poll
    // CIM once per historical identity or kill another session's reused PID.
    const live = new Set(rows().map(p => `${p.ProcessId}:${p.Created}`));
    for (const p of [...this.known.values()].reverse())
      if (live.has(`${p.ProcessId}:${p.Created}`)) stopOwnedProcess(p, ps);
    await until(() => !rows().some(p => this.known.has(`${p.ProcessId}:${p.Created}`))
      && !listeners([this.launch.port]).length, "owned native descendants/port cleanup", 15000);
    this.launch.cleanup = { status: "PASS", normalExitObserved: normal,
      method: normal ? "REAL_UI_SAVE_AND_NATIVE_DESTROY" : "ATTRIBUTED_TERMINATION_NOT_NORMAL_EXIT" };
    this.child = null; this.save();
  }
}
async function observe(kind, receive) {
  await session.page.evaluate(({ kind }) => {
    window.__qaNaturalRoleProbe?.stop();
    const probe = { active: true, raf: 0, scheduled: false };
    function sample(source, event) {
      if (!probe.active) return;
      const selector = kind === "title" ? ".renpy-title-action" : kind === "navigation"
        ? '[data-testid="renpy-menu-return"]' : kind.startsWith("choice") ? ".choice-option" : ".modal-panel button";
      const controls = [...document.querySelectorAll(selector)].map(n => {
        const c = getComputedStyle(n), rect = n.getBoundingClientRect().toJSON(), textRects = [];
        const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) if (walker.currentNode.textContent.trim()) {
          const range = document.createRange(); range.selectNodeContents(walker.currentNode);
          textRects.push(...[...range.getClientRects()].map(r => r.toJSON()));
        }
        let opacity = 1, visible = true;
        for (let p = n; p instanceof Element; p = p.parentElement) {
          const s = getComputedStyle(p); opacity *= Number(s.opacity);
          if (s.display === "none" || s.visibility !== "visible") visible = false;
        }
        return { id: n.dataset.testid, label: n.textContent.trim(), disabled: n.disabled, busy: n.getAttribute("aria-busy"),
          roleState: n.dataset.renpyRoleState, color: c.color, opacity, transform: c.transform,
          visible: visible && n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          clipped: n.scrollWidth > n.clientWidth + 1, rect, textRects };
      });
      const blackout = document.querySelector('[data-testid="game-launch-blackout"]');
      const record = { kind, source, at: performance.now(), controls,
        blackoutOpacity: blackout ? Number(getComputedStyle(blackout).opacity) : 0,
        overflow: document.documentElement.scrollWidth - innerWidth, trusted: event?.isTrusted ?? false };
      window.__qaNaturalRoleFrame(record).catch(() => {}); // Read-only evidence leaves before genuine native close.
    }
    const click = e => sample("click", e);
    const tick = () => { if (!probe.active) return; sample("raf"); probe.raf = requestAnimationFrame(tick); };
    const observer = new MutationObserver(() => {
      if (probe.scheduled) return;
      probe.scheduled = true; queueMicrotask(() => { probe.scheduled = false; sample("mutation"); });
    });
    observer.observe(document.body, { subtree: true, attributes: true, childList: true });
    document.addEventListener("click", click, true);
    probe.stop = () => { probe.active = false; cancelAnimationFrame(probe.raf); observer.disconnect();
      document.removeEventListener("click", click, true); };
    window.__qaNaturalRoleProbe = probe; sample("initial"); probe.raf = requestAnimationFrame(tick);
  }, { kind });
}
(async () => {
  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const zip = await JSZip.loadAsync(fs.readFileSync(author.cartridge.path), { checkCRC32: true });
  assert.deepEqual(JSON.parse(await zip.file("ui/layout.json").async("string")).renpy.shared.buttonRoles, roles);
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  fs.mkdirSync(prep.temporary); prepared = true; profile("Prepare");
  prep.profiles = read(path.join(out, "profile-protection.json")).records;
  for (const viewport of matrix) {
    const label = `${viewport.width}-${viewport.dpr}-${viewport.reduced ? "reduced" : "normal"}`;
    const c = { viewport, status: "RUNNING", observations: [], startedAt: new Date().toISOString(),
      installId: `qa-natural-${attempt}-${label}` };
    report.cells.push(c); save();
    const frames = [];
    session = new NaturalSession({ prep, fixture: { input: author.fixture.path, inputSha256: author.fixture.sha256 },
      cartridges: [{ ...author.cartridge, layout: "renpy" }], out, report, save, installId: c.installId });
    await session.start("renpy", false); await session.viewport(viewport); await session.setAuto(true, true);
    const p = session.page;
    await p.exposeBinding("__qaNaturalRoleFrame", (_, record) => { frames.push(record); });
    await p.mouse.move(0, 0); await observe("title");
    await p.getByTestId("start-new-game").click(); await session.ready("playing"); await session.command("ui_acceptance", 0);
    c.quickDisabled = await p.getByTestId("renpy-quick-rollback").evaluate(n =>
      ({ state: n.dataset.renpyRoleState, color: getComputedStyle(n).color, disabled: n.disabled }));
    assert(c.quickDisabled.disabled);
    await session.openSettings(); await p.mouse.move(0, 0); await observe("navigation");
    await p.getByTestId("renpy-menu-return").click(); await session.ready("playing"); await session.command("ui_acceptance", 0);
    await observe("choice-entry"); await p.locator(".dialog-box").click();
    const choice = p.getByRole("button", { name: "选择：继续", exact: true });
    await choice.waitFor(); await p.waitForFunction(() => [...document.querySelectorAll(".choice-option")].every(n => !n.disabled));
    await observe("choice-exit"); await choice.click(); await session.command("ui_acceptance", 0);
    await p.keyboard.press("Escape"); await session.ready("main_menu");
    await p.getByTestId("open-exit-confirmation").click();
    await p.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
    await p.mouse.move(0, 0); await session.shot(`${label}-exit`);
    await observe("modal"); session.remember();
    const before = session.files();
    await p.getByTestId("confirm-exit-game").click().catch(error => { if (!p.isClosed()) throw error; });
    await session.stop(true); c.normalExitObserved = true;
    c.newSaves = session.files().filter(f => !before.some(b => b.name === f.name && b.sha256 === f.sha256))
      .map(f => {
        const retained = path.join(out, `${label}-${f.name}`);
        fs.copyFileSync(f.path, retained, fs.constants.COPYFILE_EXCL); assert.equal(sha(retained), f.sha256);
        return { ...desc(retained), sourcePath: f.path, data: read(retained) };
      });
    const trace = path.join(out, `${label}.json.gz`);
    fs.writeFileSync(trace, gzipSync(JSON.stringify(frames)), { flag: "wx" }); c.trace = desc(trace);
    for (const [kind, role] of [["title", "title_action"], ["navigation", "page_navigation"],
      ["choice-entry", "story_choice"], ["choice-exit", "story_choice"], ["modal", "modal_action"]])
      c.observations.push(analyze(frames, kind, rgb(roles[role].states[
        kind === "choice-entry" && viewport.reduced ? "normal" : "disabled"].textColor), viewport));
    c.status = "PASS"; c.finishedAt = new Date().toISOString();
    try { validateCell(c); } catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    session = null; save(); console.log(`PASS natural native states ${label}`);
  }
  for (const f of bindings) assert.equal(sha(f.path), f.sha256, f.path);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    await session?.stop();
    if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore"); report.profileRestoration = read(path.join(out, "profile-restoration.json"));
    }
    if (report.status === "PASS") validateSummary(report);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cells: report.cells.length, error: report.error,
    cleanupError: report.cleanupError }));
});
