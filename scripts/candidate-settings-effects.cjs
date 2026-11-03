"use strict";
// QA only. All preference/engine writes go through actual controls. Synthetic
// story/audio fixtures are explicit; read-only observers forward original play.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { spawnSync } = require("node:child_process");
const { gzipSync, gunzipSync } = require("node:zlib");
const JSZip = require("../editor/node_modules/jszip");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { waitNativeRuntimePage } = require("./lib/wait-native-runtime-page.cjs");
const [mode, attempt, arg, nativeArg, installedArg] = process.argv.slice(2);
assert(process.argv.slice(2).length <= 5, "Unexpected QA arguments");
assert(["self-test", "diagnose", "audio-diagnose", "run", "audit", "paint", "paint-self-test"].includes(mode));
assert.match(attempt || "", /^\d{2}$/);
const paintOnly = mode === "paint" || mode === "paint-self-test";
assert(arg?.startsWith("--candidate-config="));
const root = path.resolve(__dirname, ".."), read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const hash = b => createHash("sha256").update(b).digest("hex");
const configFile = arg.slice(19), config = validateCandidateConfig(read(configFile));
const actual = deriveActual(config.actual, config.version);
const installedExecutable = actual.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
let executable = installedExecutable, nativeBuild, installedRuntime;
assert(executable); assert.equal(sha(executable.path), executable.sha256);
if (nativeArg) {
  assert(nativeArg.startsWith("--native-build-report="), "Explicit verified build receipt required for a non-installed native");
  const file = nativeArg.slice(22), build = read(file);
  assert.equal(build.status, "PASS");
  assert(build.commands.some(c => c.label === "full-dev" && c.status === "PASS" && c.exitCode === 0));
  assert(build.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  assert.equal(path.resolve(build.nativePlayer.path), path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe"));
  for (const s of build.sources) assert.equal(sha(s.path), s.sha256);
  assert.equal(sha(build.nativePlayer.path), build.nativePlayer.sha256);
  executable = build.nativePlayer;
  nativeBuild = { receipt: desc(file), version: read(path.join(root, "editor/package.json")).version };
}
if (installedArg) {
  assert(nativeBuild && installedArg.startsWith("--installed-receipt="),
    "An actual installed Player requires an explicit installation journal and tested build receipt");
  const file = installedArg.slice("--installed-receipt=".length), receipt = read(file);
  assert.equal(receipt.status, "PASS"); assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.metadataRestoration, "PASS");
  assert.equal(receipt.scope, "ACTUAL_NSIS_NEW_DIRECTORY_NOT_UPGRADE_OR_CLEAN_MACHINE");
  assert.equal(receipt.executable.version, nativeBuild.version);
  const qa = path.dirname(path.resolve(file));
  assert.equal(path.dirname(qa), path.resolve("F:/AgentVN/QA"));
  assert.match(path.basename(qa), new RegExp(`^Editor-${nativeBuild.version.replaceAll(".", "\\.")}-\\d{8}-01$`));
  assert.equal(path.resolve(receipt.installRoot), path.join(qa, "installed-editor"));
  assert.equal(path.resolve(receipt.executable.path), path.join(receipt.installRoot, "agentvn-editor.exe"));
  for (const f of [receipt.package, receipt.executable, ...receipt.resources, ...receipt.protectedFiles])
    assert.equal(sha(f.path), f.sha256);
  const player = receipt.resources.filter(f => path.resolve(f.path) === path.join(receipt.installRoot, "agentvn-player.exe"));
  assert.equal(player.length, 1);
  assert.equal(player[0].sha256, executable.sha256, "Installed Player differs from the fully tested native build");
  executable = desc(player[0].path);
  installedRuntime = { receipt: desc(file), version: receipt.executable.version,
    editor: receipt.executable, installer: receipt.package, installRoot: receipt.installRoot };
}
const sourceFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-13/report.json", source = read(sourceFile);
assert.equal(source.status, "PASS"); assert.equal(source.candidateVersion, config.version);
assert.equal(sha(source.installation.path), source.installation.sha256);
assert.deepEqual(read(source.installation.path).executable, actual.executable);
const runVersion = installedRuntime?.version ?? nativeBuild?.version ?? config.version;
const runLabel = `${installedRuntime ? "installed-" : nativeBuild ? "native-" : ""}${runVersion.replaceAll(".", "")}`;
const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/settings-${paintOnly ? "paint" : "effects"}-${runLabel}-${attempt}`;
const auditFile = nativeBuild
  ? path.join(path.dirname(nativeBuild.receipt.path), `settings-${paintOnly ? "paint" : "effects"}-audit-${runLabel}-${attempt}.json`)
  : path.join(config.qa, `settings-${paintOnly ? "paint" : "effects"}-audit-${attempt}.json`);
const matrix = ["agentvn", "renpy"].flatMap(layout => [1920, 2560, 3840].flatMap(width =>
  [1, 2].flatMap(dpr => [false, true].map(reduced => ({ layout, width, height: width * 9 / 16, dpr, reduced })))));
const specs = {
  fontScale: ["显示", "Font scale", .75, .05], lineSpacing: ["显示", "Line spacing", .8, .05],
  highContrastText: ["显示", "High contrast text"],
  textSpeedCps: ["文字", "Text speed", 0, 2], autoForwardTime: ["文字", "Auto forward time", 0, .5],
  autoForwardAfterClick: ["文字", "Auto forward after click"],
  volumeMaster: ["音频", "Master volume", 0, .05], volumeBgm: ["音频", "Background music volume", 0, .05],
  volumeSfx: ["音频", "Sound effects volume", 0, .05], volumeVoice: ["音频", "Voice volume", 0, .05],
  muteBgm: ["音频", "Mute background music"], muteSfx: ["音频", "Mute sound effects"],
  muteVoice: ["音频", "Mute voice"], muteAll: ["音频", "Mute all"],
  skipUnread: ["跳过", "Skip unread text"], skipAfterChoices: ["跳过", "Skip after choices"],
  autoSaveEnabled: ["系统", "自动存档"],
};
const near = (a, b, e = 1e-5) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
const bound = [configFile, config.actual.path, sourceFile, executable.path, __filename,
  "AGENTS.md", "plans/ACTIVE_TASKS.md", "scripts/lib/installed-runtime-session.cjs",
  "scripts/lib/current-native-capture.cjs", "scripts/lib/current-native-editor-session.cjs",
  "scripts/lib/owned-process-tree.cjs", "scripts/lib/owned-process-stop.cjs",
  "scripts/lib/wait-native-runtime-page.cjs",
  "scripts/native-dev-preview-profile.ps1"].map(desc);
if (nativeBuild) bound.push(nativeBuild.receipt);
if (installedRuntime) bound.push(installedRuntime.receipt);
if (paintOnly) bound.push(desc("scripts/runtime-settings-paint-audit.cjs"));
const expectedGroups = ["routine-save-off", "display", "typing", "auto-delay", "auto-click",
  "skip-unread", "skip-after-choice", "audio", "routine-save-on"];
const paintStages = ["before", "font", "line", "contrast", "restored"];
const paintSettings = ["autoSaveEnabled", "textSpeedCps", "fontScale", "lineSpacing", "highContrastText"];
function validate(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.error && !r.cleanupError);
  assert.equal(r.cells.length, 24); assert.equal(r.launches.length, 24);
  assert.equal(r.screenshots.length, paintOnly ? 120 : 24);
  assert.deepEqual(r.pageErrors, []); assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0);
  for (const v of matrix) {
    const cells = r.cells.filter(c => JSON.stringify(c.display) === JSON.stringify(v)); assert.equal(cells.length, 1);
    const c = cells[0]; assert.equal(c.status, "PASS"); assert(c.finishedAt);
    assert.deepEqual(c.checks.map(k => k.name), paintOnly ? ["display-paint"] : expectedGroups);
    assert(c.checks.every(k => k.status === "PASS"));
    assert.deepEqual([...c.covered].sort(), (paintOnly ? paintSettings : Object.keys(specs)).slice().sort());
    assert(c.trustedInputs > 0 && c.untrustedInputs === 0); assert(c.raw);
    if (paintOnly) {
      assert.equal(c.prefs.autoSaveEnabled, false); assert.equal(c.saved.length, 0);
      const samples = r.paintSamples.filter(sample => sample.label === c.label);
      assert.deepEqual(samples.map(sample => sample.stage), paintStages);
      for (const sample of samples) {
        assert.equal(sample.readiness.screen, "playing"); assert.equal(sample.readiness.phase, "idle");
        assert(!sample.readiness.blackout && !sample.readiness.boot && !sample.readiness.inert);
        assert(sample.pixels.visibleText);
      }
      const [before, font, line, contrast, restored] = samples.map(sample => sample.rendered);
      near(font.font / before.font, 1.35, .025); near(line.line / font.line, 1.25, .025);
      assert.equal(contrast.color, "rgb(255, 255, 255)");
      for (const key of ["font", "line", "color", "shadow", "text"]) assert.equal(restored[key], before[key]);
    } else {
      assert(c.prefs.autoSaveEnabled);
      assert(c.saved.length > 0 && c.saved.every(s => s.data.save_kind === "auto" && s.data.install_id === c.installId));
    }
  }
  if (paintOnly) assert.equal(r.paintSamples.length, 120);
  assert.equal(r.profileRestoration?.status, "PASS");
  assert(r.launches.every(l => l.cleanup?.status === "PASS"));
  for (const launch of r.launches) {
    const ready = launch.targetReadiness;
    assert(ready?.readyAt && ready.events.length > 0);
    assert.equal(new URL(ready.readyURL).hostname, "tauri.localhost");
    assert.equal(ready.events.at(-1).candidates, 1);
  }
}
if (mode === "self-test" || mode === "paint-self-test") {
  assert(!fs.existsSync(out) && !fs.existsSync(auditFile));
  assert.equal(matrix.length, 24); assert.equal(Object.keys(specs).length, 17);
  assert.throws(() => validate({ status: "PASS", finishedAt: "x", cells: [], pageErrors: [] }));
  console.log(JSON.stringify({ status: "PASS", productStarts: 0, matrix: 24,
    settings: paintOnly ? 3 : 17, ...(paintOnly ? { screenshotStages: paintStages, screenshots: 120 } : {}), executable }));
  return;
}
if (mode === "audit") {
  assert(!fs.existsSync(auditFile));
  const file = path.join(out, "report.json"), r = read(file);
  const a = { status: "RUNNING", startedAt: new Date().toISOString(), input: desc(file), checks: [] };
  try {
    validate(r); a.checks.push("Exact 24-display, 17-setting, nine actual-effect groups; no empty or partial PASS");
    for (const f of r.bindings)
      assert.equal(sha(path.resolve(f.path) === __filename ? path.join(out, "executed-test.cjs") : f.path), f.sha256, f.path);
    assert.deepEqual(r.executable, executable);
    for (const c of r.cells) {
      const detail = name => c.checks.find(k => k.name === name).detail;
      const display = detail("display");
      near(display.font.font / display.before.font, 1.35, .025);
      near(display.line.line / display.font.line, 1.25, .025);
      assert.equal(display.contrast.color, "rgb(255, 255, 255)");
      assert.notEqual(display.contrast.shadow, display.before.shadow);
      for (const value of [display.before, display.font, display.line, display.contrast]) {
        assert.equal(value.text, display.before.text); assert.equal(value.overflow, 0); assert(value.innerOverflow <= 1);
        assert(value.textRects.every(t => t.left >= value.rect.left - 1 && t.right <= value.rect.right + 1
          && t.top >= value.rect.top - 1 && t.bottom <= value.rect.bottom + 1));
      }
      const typing = detail("typing"), auto = detail("auto-delay"), skip = detail("skip-unread");
      assert(typing.slow.typing && typing.slow.chars > typing.t0.chars && typing.slow.chars < 30);
      assert(typing.fast.chars - typing.t1.chars > (typing.slow.chars - typing.t0.chars) * 2);
      assert.equal(typing.instant.chars, 100); assert(!typing.instant.typing);
      assert.equal(auto.zero.index, 0); assert.equal(auto.slow.index, 0); assert.equal(auto.fast.index, 1);
      assert(auto.fast.at - auto.start.at >= 250 && auto.fast.at - auto.start.at < 3000);
      for (const click of detail("auto-click")) {
        assert.equal(click.pressed, click.value); assert.equal(click.after.index, click.value ? 2 : 1);
      }
      assert.equal(skip.unread.index, 0); assert(skip.unread.typing && skip.unread.chars < 30);
      assert.equal(skip.read.index, 1); assert.equal(skip.allowed.index, 2);
      for (const choice of detail("skip-after-choice")) {
        assert.equal(choice.pressed, choice.value); assert.equal(choice.state.index, choice.value ? 2 : 0);
      }
      const audio = detail("audio");
      for (const [stage, expected] of [[audio.baseline, { bgm: .168, sfx: .144, voice: .3 }],
        [audio.bgmMuted, { bgm: 0, sfx: .144, voice: .3 }],
        [audio.channelsMuted, { bgm: .168, sfx: 0, voice: 0 }],
        [audio.masterMuted, { bgm: 0, sfx: 0, voice: 0 }]]) for (const kind of ["bgm", "sfx", "voice"]) {
        const sound = stage.sounds.filter(s => s.sha256 === r.fixtureAudio.find(f => f.kind === kind).sha256);
        assert.equal(sound.length, 1); near(sound[0].volume, expected[kind]);
        assert(sound[0].currentTime > 0 && !sound[0].error);
      }
      assert.equal(detail("routine-save-off").nativeAutoFiles, 0);
      assert.equal(detail("routine-save-on").nativeAutoFiles, c.saved.length);
      assert.equal(detail("routine-save-on").successToast, false);
      assert.equal(sha(c.raw.path), c.raw.sha256); const raw = JSON.parse(gunzipSync(fs.readFileSync(c.raw.path)));
      assert.equal(raw.inputs.filter(i => i.trusted).length, c.trustedInputs);
      assert.equal(raw.inputs.filter(i => !i.trusted).length, 0);
      assert(raw.frames.length > 0 && raw.media.calls.length >= 9 && raw.media.events.some(e => e.event === "timeupdate"));
      for (const f of c.saved) { assert.equal(sha(f.path), f.sha256); assert.deepEqual(read(f.path), f.data); }
    }
    a.checks.push("Recomputed display ratios, typing, auto/skip semantics, twelve audio channel samples, trusted input and actual auto-save bytes");
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    const now = rows();
    for (const l of r.launches) assert(!now.some(p => l.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
    assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
    for (const p of r.profileRestoration.restored) for (const f of p.files)
      assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
    assert.equal(r.profileRestoration.deletedUserFiles, 0);
    a.checks.push("Strict PNG/DPR, owned process/port absence and original-profile byte restoration");
    assert.throws(() => validate({ ...r, cells: [] }));
    assert.throws(() => validate({ ...r, cells: r.cells.map((c, i) => i ? c : { ...c, covered: [] }) }));
    a.status = "PASS";
  } catch (e) { a.status = "FAILED"; a.error = String(e.stack || e); process.exitCode = 1; }
  a.finishedAt = new Date().toISOString(); fs.writeFileSync(auditFile, JSON.stringify(a, null, 2), { flag: "wx" });
  console.log(JSON.stringify(a)); return;
}
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), executable, bindings: bound,
  scope: installedRuntime
    ? "ACTUAL_NEW_NSIS_INSTALLED_PLAYER_ALL17_EFFECTS_SYNTHETIC_FIXTURE_NOT_CURRENT_AUTHOR_SETUP_UPGRADE_ANDROID_OR_NEW_LISTENING"
    : nativeBuild
    ? "NEW_VERIFIED_NATIVE_ALL17_STORY_EFFECTS_SYNTHETIC_FIXTURE_NOT_INSTALLED_SETUP_UPGRADE_ANDROID_OR_NEW_LISTENING"
    : "ACTUAL_INSTALLED_PLAYER_ALL17_STORY_EFFECTS_SYNTHETIC_FIXTURE_NOT_AUTHOR_SETUP_UPGRADE_ANDROID_OR_NEW_LISTENING",
  ...(nativeBuild ? { nativeBuild, installedAuthorVersion: config.version, installedPlayerNotExecuted: installedExecutable } : {}),
  ...(installedRuntime ? { installedRuntime, fixtureAuthorScope: "FROZEN_PRIOR_AUTHOR_LAYOUT_PLUS_EXPLICIT_SYNTHETIC_STORY_NOT_CURRENT_EDITOR_AUTHOR_ACCEPTANCE" } : {}),
  diagnosticOnly: mode.includes("diagnose"),
  cells: [], launches: [], screenshots: [], pageErrors: [], modelRequests: 0, productChanges: 0, builds: 0,
  boundaries: ["Public native library fixture import; all preferences and story actions through real UI",
    "Read-only original-play forwarding audio observer; no forced timers/audio/engine/store state",
    "Actual WebView simulated 1080p/1440p/4K and DPR, not physical display acceptance",
    "Synthetic story and distinct low-amplitude WAVs, not manual authoring or new listening acceptance"] };
if (paintOnly) Object.assign(report, {
  scope: `${installedRuntime ? "ACTUAL_NSIS_INSTALLED" : nativeBuild ? "NEW_NATIVE" : "FROZEN_INSTALLED"}_PLAYER_THREE_DISPLAY_SETTINGS_VISIBLE_PIXELS_NOT_ALL17_AUTHOR_SETUP_UPGRADE_ANDROID`,
  paintSamples: [],
  supplementTo: desc(path.join(path.dirname(out), `settings-effects-${runLabel}-${attempt}/report.json`)),
});
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const prep = { status: "PASS", profiles: [], sessionRoot: out, executable,
  defaultStorage: "PHYSICAL_DEFAULT_PATH", temporary: path.join(out, "temporary"), webview: path.join(out, "webview") };
let session, prepared = false, cell;
function profile(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out,
    "-CodexCacheView", "-Storage", "NativeRoaming"], { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
class EffectsSession extends InstalledRuntimeSession {
  constructor(options) { super({ ...options, currentNative: true }); this.known = new Map(); }
  async resolveRuntimePage() {
    const ready = this.launch.targetReadiness = { events: [] }; this.save();
    const page = await waitNativeRuntimePage(this.browser, {
      observe: event => { ready.events.push({ ...event, at: new Date().toISOString() }); this.save(); },
    });
    ready.readyURL = page.url(); ready.readyAt = new Date().toISOString(); this.save();
    return page;
  }
  remember() {
    if (!this.child) return;
    const all = rows(), p = all.find(p => p.ProcessId === this.child.pid);
    if (p) {
      assert.equal(path.resolve(p.ExecutablePath), path.resolve(this.exe)); this.rootIdentity ??= p;
      assert.equal(p.Created, this.rootIdentity.Created);
      for (const n of ownedProcessTree(all, p.ProcessId, p.Created)) this.known.set(`${n.ProcessId}:${n.Created}`, n);
    }
    if (this.launch) { this.launch.knownProcesses = [...this.known.values()]; this.save(); }
  }
  async start(...args) {
    await super.start(...args); this.remember();
    assert(listeners([this.launch.port]).every(l => [...this.known.values()].some(p => p.ProcessId === l.OwningProcess)));
    this.launch.scope = report.scope;
  }
  async stop() {
    if (!this.child) return; this.remember(); await this.browser?.close().catch(() => {});
    const live = new Set(rows().map(p => `${p.ProcessId}:${p.Created}`));
    for (const p of [...this.known.values()].reverse()) if (live.has(`${p.ProcessId}:${p.Created}`)) stopOwnedProcess(p, ps);
    await until(() => !rows().some(p => this.known.has(`${p.ProcessId}:${p.Created}`))
      && !listeners([this.launch.port]).length, "owned descendants and CDP cleanup", 15000);
    this.launch.cleanup = { status: "PASS", method: "ATTRIBUTED_TERMINATION_NOT_NORMAL_EXIT" };
    this.child = null; this.save();
  }
}
function wav(seconds, hz) {
  const rate = 16000, count = seconds * rate, b = Buffer.alloc(44 + count * 2);
  b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) b.writeInt16LE(Math.round(300 * Math.sin(i * 2 * Math.PI * hz / rate)), 44 + i * 2);
  return b;
}
async function fixtures() {
  const branches = ["display", "slow", "fast", "instant", "auto", "click_off", "click_on",
    "unread", "unread_allowed", "choice_off", "choice_on", "audio_a", "audio_b", "audio_c", "audio_d"];
  const dialog = text => ({ type: "dialog", character_id: "hero", text, presentation_mode: "dialog" });
  const choice = (id, target) => ({ type: "choice", choices: [
    { choice_id: `go_${id}`, text: id, target_scene_id: target, conditions: [] }] });
  const many = "甲乙丙丁戊己庚辛壬癸".repeat(10);
  const scene = (id, commands) => ({ scene_id: id, title: id, summary: "", tags: [], commands });
  const menus = { text: ["slow", "fast", "instant"], auto: ["auto", "click_off", "click_on"],
    skip: ["unread", "unread_allowed", "choice_off", "choice_on"], audio: ["audio_a", "audio_b", "audio_c", "audio_d"] };
  const scenes = [scene("settings_hub", [dialog("请选择设置行为"), { type: "choice",
    choices: ["display", ...Object.keys(menus)].map(id => ({ choice_id: `to_${id}`, text: id,
      target_scene_id: id === "display" ? id : `menu_${id}`, conditions: [] })) }])];
  for (const [group, items] of Object.entries(menus)) scenes.push(scene(`menu_${group}`, [{ type: "choice",
    choices: items.map(id => ({ choice_id: `to_${id}`, text: id, target_scene_id: id, conditions: [] })) }]));
  for (const id of branches) {
    let commands;
    if (id === "display") commands = [dialog("字号行距应实际改变且全文保持完整可读"), choice("返回", "settings_hub")];
    else if (["choice_off", "choice_on"].includes(id))
      commands = [choice("继续快进验证", `${id}_after`)];
    else if (id.startsWith("audio_"))
      commands = [{ type: "bgm", action: "play", bgm_id: "qa_bgm", volume: .7, fade_ms: 0 },
        { type: "sfx", sfx_id: "qa_sfx", volume: .8 }, { ...dialog("音量管线验证"), voice: "qa_voice" },
        choice("返回", "settings_hub")];
    else commands = [dialog(many), dialog(`${id}下一句`), choice("返回", "settings_hub")];
    scenes.push(scene(id, commands));
  }
  for (const id of ["choice_off", "choice_on"])
    scenes.push(scene(`${id}_after`, [dialog(many), dialog(`${id}已继续`), choice("返回", "settings_hub")]));
  const assets = ["bgm", "sfx", "voice"].map((kind, i) => {
    const bytes = wav([30, 2, 20][i], [330, 550, 770][i]), asset = {
      asset_id: `qa_${kind}`, asset_type: kind, path: `assets/${kind}/settings-${kind}.wav`,
      mime_type: "audio/wav", size_bytes: bytes.length, duration_ms: [30000, 2000, 20000][i], preload: false };
    return { kind, bytes, asset, sha256: hash(bytes) };
  });
  const result = [];
  for (const layout of ["agentvn", "renpy"]) {
    const src = source.cartridges.find(c => c.layout === layout); assert.equal(sha(src.path), src.sha256);
    const old = await JSZip.loadAsync(fs.readFileSync(src.path), { checkCRC32: true });
    const manifest = JSON.parse(await old.file("manifest.json").async("string"));
    const script = JSON.parse(await old.file("script.json").async("string"));
    const zip = new JSZip(), now = new Date().toISOString();
    const gameId = `qa-settings-effects-${attempt}-${layout}`;
    Object.assign(manifest, { game_id: gameId, title: "设置实际效果隔离验收", entry_scene_id: "settings_hub",
      assets: assets.map(a => a.asset), created_at: now, updated_at: now });
    Object.assign(script, { game_id: gameId, title: manifest.title, entry_scene_id: "settings_hub", scenes });
    const files = [
      ["manifest.json", Buffer.from(JSON.stringify(manifest))], ["script.json", Buffer.from(JSON.stringify(script))],
      ["gallery.json", await old.file("gallery.json").async("nodebuffer")],
      ["ui/layout.json", await old.file("ui/layout.json").async("nodebuffer")],
      ...assets.map(a => [a.asset.path, a.bytes])];
    for (const [name, bytes] of files) zip.file(name, bytes);
    zip.file("checksum.json", JSON.stringify({ checksum_version: "1.0.0", algorithm: "sha256", generated_at: now,
      files: files.map(([name, b]) => ({ path: name, size_bytes: b.length, hash_sha256: hash(b) })) }));
    const file = path.join(out, `${layout}.vncart`);
    fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), { flag: "wx" });
    result.push({ layout, ...desc(file), source: desc(src.path) });
  }
  report.fixtureAudio = assets.map(({ kind, sha256, bytes }) => ({ kind, sha256, bytes: bytes.length, synthetic: true }));
  return result;
}
async function observer() {
  await session.page.evaluate(() => {
    const q = window.__qaSettings = { inputs: [], frames: [], media: { calls: [], events: [] }, audios: [], raf: 0, active: true };
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(...args) {
      let id = q.audios.indexOf(this);
      if (id < 0) {
        id = q.audios.push(this) - 1;
        for (const event of ["playing", "timeupdate", "ended", "volumechange", "pause", "error"])
          this.addEventListener(event, () => q.media.events.push({ id, event, at: performance.now(),
            time: this.currentTime, volume: this.volume, paused: this.paused, error: this.error?.code || 0 }));
      }
      q.media.calls.push({ id, at: performance.now(), src: this.currentSrc || this.src, volume: this.volume });
      return Reflect.apply(original, this, args);
    };
    const input = e => q.inputs.push({ type: e.type, trusted: e.isTrusted, key: e.key, at: performance.now(),
      label: e.target?.getAttribute?.("aria-label") || e.target?.textContent?.slice(0, 80) });
    document.addEventListener("pointerup", input, true); document.addEventListener("keydown", input, true);
    const tick = () => {
      if (!q.active) return;
      const p = document.querySelector('[data-testid="game-state-playing"]');
      if (p) q.frames.push({ at: performance.now(), scene: p.dataset.currentSceneId, index: Number(p.dataset.currentCommandIndex),
        typing: p.dataset.isTyping, chars: p.querySelector(".dialog-text")?.textContent.length || 0,
        choice: p.dataset.waitingChoice, screen: document.querySelector("[data-runtime-presented-screen]")?.dataset.runtimePresentedScreen });
      q.raf = requestAnimationFrame(tick);
    };
    q.stop = () => { q.active = false; cancelAnimationFrame(q.raf); HTMLMediaElement.prototype.play = original;
      document.removeEventListener("pointerup", input, true); document.removeEventListener("keydown", input, true); };
    tick();
  });
}
async function configure(values) {
  await session.openSettings();
  const p = session.page;
  let group;
  for (const [key, value] of Object.entries(values)) {
    const [tab, name, min, step] = specs[key];
    if (group !== tab) {
      await p.locator(".settings-tabs").getByRole("button", { name: tab, exact: true }).click();
      await p.locator(`[data-settings-tab-current="${({ 显示: "display", 文字: "text", 音频: "audio", 跳过: "skip", 系统: "system" })[tab]}"]`).waitFor();
      group = tab;
    }
    if (typeof value === "boolean") await p.getByRole("checkbox", { name, exact: true }).setChecked(value);
    else {
      const n = p.getByRole("slider", { name, exact: true });
      await n.focus(); await n.press("Home");
      for (let i = 0, steps = Math.round((value - min) / step); i < steps; i++) await n.press("ArrowRight");
      near(Number(await n.inputValue()), value);
    }
    if (!cell.covered.includes(key)) cell.covered.push(key);
  }
  await session.finishSettings();
  // Page idle can precede the independent global curtain completing. Resolve
  // the actual return destination: initial settings may return to the title.
  await session.ready(await session.screen());
}
async function state() {
  return session.page.locator('[data-testid="game-state-playing"]').evaluate(n => ({ scene: n.dataset.currentSceneId,
    index: Number(n.dataset.currentCommandIndex), typing: n.dataset.isTyping === "true", chars: n.querySelector(".dialog-text")?.textContent.length || 0,
    at: performance.now() }));
}
async function at(scene, index, done = false) { await session.command(scene, index, done); return state(); }
async function newGame() {
  const p = session.page;
  if (await session.screen() === "playing") { await p.keyboard.press("Escape"); await session.ready("main_menu"); }
  await p.getByTestId("start-new-game").click(); await session.ready("playing"); await at("settings_hub", 0);
  if ((await state()).typing) await p.locator(".dialog-box").click();
  await at("settings_hub", 0, true); await p.locator(".dialog-box").click(); await at("settings_hub", 1);
}
async function branch(name) {
  await newGame();
  const group = name === "display" ? null : ["slow", "fast", "instant"].includes(name) ? "text"
    : ["auto", "click_off", "click_on"].includes(name) ? "auto" : name.startsWith("audio_") ? "audio" : "skip";
  if (group) {
    await session.page.getByRole("button", { name: `选择：${group}`, exact: true }).click();
    await at(`menu_${group}`, 0);
  }
  await session.page.getByRole("button", { name: `选择：${name}`, exact: true }).click();
  await at(name, name.startsWith("audio_") ? 2 : 0);
}
async function waitMs(ms) {
  // Bounded negative/timing observation, never a fabricated module-ready delay.
  await session.page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; cell.checks.push(row); save();
  try { row.detail = await fn(row); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
  finally { row.finishedAt = new Date().toISOString(); save(); console.log(`${row.status} ${cell.label} ${name}`); }
}
async function quick(kind) {
  if (cell.display.layout === "renpy") return session.page.getByTestId(`renpy-quick-${kind}`);
  const toggle = session.page.getByTestId("quick-menu-toggle");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  return session.page.locator(`[data-ui-component-id="quick_${kind}_button"]`);
}
async function toggle(kind) { await (await quick(kind)).click(); }
async function active(kind) { return await (await quick(kind)).getAttribute("aria-pressed") === "true"; }
async function rendered() {
  return session.page.locator(".dialog-text").evaluate(n => {
    const s = getComputedStyle(n), r = n.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(n);
    return { font: parseFloat(s.fontSize), line: parseFloat(s.lineHeight), color: s.color, shadow: s.textShadow,
      inlineFont: n.style.fontSize, preferenceScale: s.getPropertyValue("--runtime-preference-font-scale"),
      layoutFont: s.getPropertyValue("--runtime-dialog-layout-font-size"),
      fontMode: n.closest(".dialog-box")?.getAttribute("data-dialog-font-mode"),
      text: n.textContent, rect: r.toJSON(), textRects: [...range.getClientRects()].map(r => r.toJSON()),
      overflow: document.documentElement.scrollWidth - innerWidth, innerOverflow: n.scrollHeight - n.clientHeight };
  });
}
async function paintSample(stage) {
  const p = session.page;
  const value = await rendered();
  assert.equal(value.overflow, 0); assert(value.innerOverflow <= 1);
  assert(value.textRects.every(rect => rect.left >= value.rect.left - 1 && rect.right <= value.rect.right + 1
    && rect.top >= value.rect.top - 1 && rect.bottom <= value.rect.bottom + 1));
  const readiness = await p.locator(".dialog-text").evaluate(node => {
    const screen = document.querySelector("[data-runtime-screen-transition]");
    return { screen: screen?.dataset.runtimePresentedScreen, phase: screen?.dataset.runtimeScreenTransition,
      blackout: Boolean(document.querySelector('[data-testid="game-launch-blackout"]')),
      boot: Boolean(document.querySelector(".boot-overlay")), inert: Boolean(node.closest("[inert]")) };
  });
  assert.equal(readiness.screen, "playing"); assert.equal(readiness.phase, "idle");
  assert(!readiness.blackout && !readiness.boot && !readiness.inert, "Text capture precedes actual presentation readiness");
  await session.shot(`${cell.label}-${stage}`);
  const screenshot = report.screenshots.at(-1);
  const pixels = await require("./runtime-settings-paint-audit.cjs").textPixels(screenshot, value, cell.display);
  const sample = { display: cell.display, label: cell.label, stage, rendered: value, readiness, screenshot, pixels };
  report.paintSamples.push(sample); save();
  assert(pixels.visibleText, "Actual glyph pixels do not match the observed light text color");
  assert.deepEqual(await rendered(), value, "Capturing changed the displayed text");
  return sample;
}
async function displayPaint() {
  await check("display-paint", async () => {
    await configure({ autoSaveEnabled: false, textSpeedCps: 0, fontScale: 1, lineSpacing: 1, highContrastText: false });
    await branch("display"); await at("display", 0, true); await session.ready("playing");
    const before = await paintSample("before");
    await configure({ fontScale: 1.35 }); const font = await paintSample("font");
    near(font.rendered.font / before.rendered.font, 1.35, .025);
    await configure({ lineSpacing: 1.25 }); const line = await paintSample("line");
    near(line.rendered.line / font.rendered.line, 1.25, .025);
    await configure({ highContrastText: true }); const contrast = await paintSample("contrast");
    assert.equal(contrast.rendered.color, "rgb(255, 255, 255)");
    await configure({ fontScale: 1, lineSpacing: 1, highContrastText: false });
    const restored = await paintSample("restored");
    for (const key of ["font", "line", "color", "shadow", "text"])
      assert.equal(restored.rendered[key], before.rendered[key]);
    assert.deepEqual(session.files(), []);
    return { stages: paintStages, actualPixelsVerified: true, fullCurtainCompletion: true,
      returnDestinationResolved: true, restoration: true, existingAll17EffectsNotRerun: true };
  });
}
async function audioSince(start) {
  await session.page.waitForFunction(start => {
    const q = window.__qaSettings, calls = q.media.calls.slice(start), ids = new Set(calls.map(c => c.id));
    // The real BGM controller legitimately keeps the same playing source
    // across new-game/menu entries. Require fresh SFX/voice, plus that actual
    // active looping media, rather than manufacturing a third play request.
    return ids.size >= 2 && q.audios.some(a => a.loop && !a.paused && a.currentTime > 0)
      && [...ids].every(id => q.media.events.some(e => e.id === id && e.event === "timeupdate" && e.time > 0));
  }, start);
  return session.page.evaluate(async start => {
    const q = window.__qaSettings, ids = [...new Set([...q.media.calls.slice(start).map(c => c.id),
      ...q.audios.flatMap((a, id) => a.loop && !a.paused ? [id] : [])])];
    return Promise.all(ids.map(async id => {
      const a = q.audios[id], bytes = await (await fetch(a.currentSrc || a.src)).arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
      return { id, source: a.currentSrc || a.src, sha256: digest, bytes: bytes.byteLength, volume: a.volume,
        currentTime: a.currentTime, paused: a.paused, error: a.error?.code || 0 };
    }));
  }, start);
}
async function audioCase(name, values, expected) {
  await configure(values); const count = await session.page.evaluate(() => window.__qaSettings.media.calls.length);
  await branch(name); const sounds = await audioSince(count);
  for (const kind of ["bgm", "sfx", "voice"]) {
    const a = sounds.filter(a => a.sha256 === report.fixtureAudio.find(a => a.kind === kind).sha256);
    assert.equal(a.length, 1, `${kind}: actual decoded media bytes`); near(a[0].volume, expected[kind]);
    assert(a[0].currentTime > 0 && !a[0].error);
  }
  return { name, settings: values, expected, sounds };
}
async function effects() {
  if (paintOnly) { await displayPaint(); return; }
  if (mode === "audio-diagnose") { await configure({ autoSaveEnabled: false }); await audioEffects(); return; }
  await check("routine-save-off", async () => {
    await configure({ autoSaveEnabled: false, textSpeedCps: 0 });
    await newGame(); await branch("display"); await at("display", 0, true);
    assert.deepEqual(session.files(), []); return { nativeAutoFiles: 0, visitedChoices: true };
  });
  await check("display", async row => {
    const before = await rendered();
    await configure({ fontScale: 1.35 }); const font = await rendered();
    row.detail = { before, font, prefs: await session.prefs() }; save();
    near(font.font / before.font, 1.35, .025);
    await configure({ lineSpacing: 1.25 }); const line = await rendered(); near(line.line / font.line, 1.25, .025);
    await configure({ highContrastText: true }); const contrast = await rendered();
    assert.equal(contrast.color, "rgb(255, 255, 255)"); assert.notEqual(contrast.shadow, before.shadow);
    for (const r of [before, font, line, contrast]) {
      assert.equal(r.overflow, 0); assert(r.innerOverflow <= 1);
      assert(r.rect.left >= -1 && r.rect.right <= cell.display.width + 1 && r.rect.bottom <= cell.display.height + 1);
      assert(r.textRects.every(t => t.left >= r.rect.left - 1 && t.right <= r.rect.right + 1 && t.bottom <= r.rect.bottom + 1));
    }
    await session.shot(`${cell.label}-display`);
    await configure({ fontScale: 1, lineSpacing: 1, highContrastText: false });
    return { before, font, line, contrast };
  });
  await configure({ fontScale: 1, lineSpacing: 1, highContrastText: false });
  await check("typing", async () => {
    await configure({ textSpeedCps: 10 }); await branch("slow");
    const t0 = await state(); await waitMs(650); const slow = await state();
    assert(slow.typing && slow.chars > t0.chars && slow.chars < 30 && slow.index === 0);
    await configure({ textSpeedCps: 80 }); await branch("fast");
    const t1 = await state(); await waitMs(650); const fast = await state();
    assert(fast.chars - t1.chars > (slow.chars - t0.chars) * 2);
    await configure({ textSpeedCps: 0 }); await branch("instant"); await at("instant", 0, true);
    const instant = await state(); assert.equal(instant.chars, 100); assert(!instant.typing);
    return { t0, slow, t1, fast, instant };
  });
  await check("auto-delay", async () => {
    await configure({ autoForwardTime: 0 }); await branch("auto"); await toggle("auto");
    await waitMs(900); const zero = await state(); assert.equal(zero.index, 0); assert(await active("auto"));
    await toggle("auto"); await configure({ autoForwardTime: 30 }); await branch("auto"); await toggle("auto");
    await waitMs(900); const slow = await state(); assert.equal(slow.index, 0);
    await toggle("auto"); await configure({ autoForwardTime: .5 }); await branch("auto");
    const start = await state(); await toggle("auto"); await at("auto", 1); const fast = await state();
    assert(fast.at - start.at >= 250 && fast.at - start.at < 3000);
    if (await active("auto")) await toggle("auto");
    return { zero, slow, start, fast };
  });
  await check("auto-click", async () => {
    const results = [];
    for (const [scene, value] of [["click_off", false], ["click_on", true]]) {
      await configure({ autoForwardTime: .5, autoForwardAfterClick: value }); await branch(scene);
      await toggle("auto"); await session.page.locator(".dialog-box").click(); await at(scene, 1);
      const pressed = await active("auto"); assert.equal(pressed, value);
      if (value) { await at(scene, 2); }
      else { await waitMs(650); assert.equal((await state()).index, 1); }
      results.push({ scene, value, pressed, after: await state() });
    }
    return results;
  });
  await check("skip-unread", async () => {
    await configure({ textSpeedCps: 10, skipUnread: false }); await branch("unread");
    await session.page.keyboard.down("Control"); await waitMs(400); const unread = await state();
    await session.page.keyboard.up("Control"); assert.equal(unread.index, 0); assert(unread.typing && unread.chars < 30);
    await session.page.locator(".dialog-box").click(); await at("unread", 0, true);
    await session.page.keyboard.down("Control"); await at("unread", 1); await session.page.keyboard.up("Control");
    const read = await state();
    await configure({ skipUnread: true }); await branch("unread_allowed");
    await session.page.keyboard.down("Control"); await at("unread_allowed", 2); await session.page.keyboard.up("Control");
    return { unread, read, allowed: await state() };
  });
  await check("skip-after-choice", async () => {
    const result = [];
    for (const [scene, value] of [["choice_off", false], ["choice_on", true]]) {
      await configure({ skipUnread: true, skipAfterChoices: value, textSpeedCps: 10 }); await branch(scene);
      await toggle("skip"); await session.page.getByRole("button", { name: "选择：继续快进验证", exact: true }).click();
      await at(`${scene}_after`, value ? 2 : 0);
      if (!value) { await waitMs(400); assert((await state()).typing); }
      const pressed = await active("skip"); assert.equal(pressed, value);
      result.push({ value, pressed, state: await state() });
      if (pressed) await toggle("skip");
    }
    return result;
  });
  await audioEffects();
  await check("routine-save-on", async () => {
    assert.deepEqual(session.files(), []);
    await configure({ autoSaveEnabled: true }); await newGame();
    await until(() => session.files().length > 0, "real routine auto save at choice", 15000);
    cell.saved = session.files().map(f => {
      const copy = path.join(out, `${cell.label}-${f.name}`); fs.copyFileSync(f.path, copy, fs.constants.COPYFILE_EXCL);
      return { ...desc(copy), sourcePath: f.path, data: read(copy) };
    });
    assert(cell.saved.every(f => f.data.scene_id === "settings_hub" && f.data.command_index === 1 && f.data.save_kind === "auto"));
    assert.equal(await session.page.locator(".save-status-toast").count(), 0);
    return { nativeAutoFiles: cell.saved.length, successToast: false };
  });
}
async function audioEffects() {
  await check("audio", async row => {
    row.detail = { stages: [], listeningAcceptance: false };
    const baseline = { volumeMaster: .6, volumeBgm: .4, volumeSfx: .3, volumeVoice: .5,
      muteBgm: false, muteSfx: false, muteVoice: false, muteAll: false, textSpeedCps: 0 };
    const a = await audioCase("audio_a", baseline, { bgm: .168, sfx: .144, voice: .3 });
    row.detail.stages.push(a); save();
    const b = await audioCase("audio_b", { muteBgm: true }, { bgm: 0, sfx: .144, voice: .3 });
    row.detail.stages.push(b); save();
    const c = await audioCase("audio_c", { muteBgm: false, muteSfx: true, muteVoice: true }, { bgm: .168, sfx: 0, voice: 0 });
    row.detail.stages.push(c); save();
    const d = await audioCase("audio_d", { muteSfx: false, muteVoice: false, muteAll: true }, { bgm: 0, sfx: 0, voice: 0 });
    row.detail.stages.push(d); save();
    return { baseline: a, bgmMuted: b, channelsMuted: c, masterMuted: d, listeningAcceptance: false };
  });
}
(async () => {
  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  report.cartridges = await fixtures();
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  fs.mkdirSync(prep.temporary); prepared = true; profile("Prepare");
  prep.profiles = read(path.join(out, "profile-protection.json")).records;
  for (const display of mode.includes("diagnose") ? matrix.filter(v => v.width === 1920 && v.dpr === 1 && !v.reduced) : matrix) {
    const { layout, ...viewport } = display, label = `${layout}-${viewport.width}-${viewport.dpr}-${viewport.reduced ? "reduce" : "normal"}`;
    cell = { display, label, status: "RUNNING", startedAt: new Date().toISOString(), checks: [], covered: [], saved: [],
      installId: `qa-settings-effects-${attempt}-${label}` }; report.cells.push(cell); save();
    const cart = report.cartridges.find(c => c.layout === layout);
    session = new EffectsSession({ prep, fixture: { input: cart.path, inputSha256: cart.sha256 },
      cartridges: report.cartridges, out, report, save, installId: cell.installId });
    try {
      await session.start(layout, false); await session.viewport(viewport); await observer();
      await effects();
      cell.prefs = await session.prefs();
      const raw = await session.page.evaluate(() => {
        const q = window.__qaSettings; q.stop(); return { inputs: q.inputs, frames: q.frames, media: q.media };
      });
      cell.trustedInputs = raw.inputs.filter(i => i.trusted).length; cell.untrustedInputs = raw.inputs.filter(i => !i.trusted).length;
      const f = path.join(out, `${label}.json.gz`); fs.writeFileSync(f, gzipSync(JSON.stringify(raw)), { flag: "wx" }); cell.raw = desc(f);
      cell.status = cell.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
    } catch (e) {
      cell.status = "FAILED"; cell.error = String(e.stack || e);
      if (session.page && !session.page.isClosed()) {
        const raw = await session.page.evaluate(() => {
          const q = window.__qaSettings; q?.stop(); return q && { inputs: q.inputs, frames: q.frames, media: q.media };
        }).catch(() => null);
        if (raw) { const f = path.join(out, `${label}-failed.json.gz`);
          fs.writeFileSync(f, gzipSync(JSON.stringify(raw)), { flag: "wx" }); cell.raw = desc(f); }
        cell.body = (await session.page.locator("body").innerText().catch(() => "")).slice(-4000);
      }
      throw e;
    } finally { cell.finishedAt = new Date().toISOString(); await session.stop(); session = null; save(); }
  }
  for (const f of bound) assert.equal(sha(f.path), f.sha256, f.path);
  report.status = report.cells.some(c => c.status === "FAILED") ? "FAILED" : mode.includes("diagnose") ? "DIAGNOSTIC_COMPLETE" : "PASS";
  if (report.status === "FAILED") process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try {
    await session?.stop();
    if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore"); report.profileRestoration = read(path.join(out, "profile-restoration.json"));
    }
    report.finishedAt = new Date().toISOString(); if (report.status === "PASS") validate(report);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cells: report.cells.length, error: report.error, cleanupError: report.cleanupError }));
});
