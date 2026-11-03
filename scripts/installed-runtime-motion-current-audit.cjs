"use strict";
// Evidence-only. Reevaluate compressed native frames, not just suite flags.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), zlib = require("node:zlib");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { validate } = require("./installed-runtime-motion-current.cjs");
const { validateCriticalTrace } = require("./native-runtime-motion-audit.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const attempt = process.argv[2] || "01", audit = process.argv[3] || "01";
assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
const source = path.join(base, `installed-motion-current-${attempt}`);
const out = path.join(base, `installed-motion-current-${attempt}-audit-${audit}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), groups: [],
  scope: "ACTUAL_NSIS_INSTALLED_PLAYER_CORE_MENU_MOTION_NOT_EDITOR_OR_COMPLETE_VISUAL",
  productChanges: 0, modelRequests: 0, newPlayerStarts: 0 };
function group(name, fn) {
  const g = { name, status: "RUNNING" }; report.groups.push(g);
  try { g.detail = fn(); g.status = "PASS"; }
  catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
}
function presentedTiming(m, e, t) {
  const expected = m.reduced ? 816 : 1632;
  const waapi = owner => {
    const animations = t.frames.flatMap(f => f[owner]?.animations || [])
      .filter(a => a.name === "WAAPI" && a.state === "running");
    assert(animations.length >= 3, `${e.name}: missing actual ${owner} animation clock`);
    assert(animations.every(a => a.duration === expected), `${e.name}: real animation duration differs from product token`);
    const times = animations.map(a => a.time).filter(Number.isFinite);
    assert(Math.min(...times) <= expected * .1 && Math.max(...times) >= expected * .9,
      `${e.name}: actual animation clock did not span start through final10%`);
    return { duration: expected, firstObservedTime: Math.min(...times), lastObservedTime: Math.max(...times) };
  };
  if (e.name.startsWith("settings-category-")) return { owner: "category", ...waapi("category") };
  if (!e.timings) return null;
  const { from, to } = e.timings;
  if (m.layout === "renpy" && from !== "playing" && to !== "playing")
    return { owner: "crossfade", ...waapi("surface") };
  const events = t.events.filter(e => e.name === "opacity"
    && typeof e.target === "string" && e.target.split(/\s+/)[0] === "runtime-screen-transition"
    && ["transitionrun", "transitionend", "transitioncancel"].includes(e.type));
  assert.deepEqual(events.map(e => e.type),
    ["transitionrun", "transitionend", "transitionrun", "transitionend"],
    `${e.name}: exactly two uncancelled owning CSS opacity transitions are required`);
  const [coverStart, cover, revealStart, reveal] = events;
  const has = (event, token) => event.target.split(/\s+/).includes(token);
  // React may commit swap before the capture listener sees transitionend.
  // The owning transitionrun, completed duration and sequence identify cover;
  // a mutable class name alone cannot identify its original transition.
  assert(has(coverStart, "is-covering") && (has(cover, "is-covering") || has(cover, "is-swap"))
    && has(revealStart, "is-revealing") && has(reveal, "is-revealing"),
    `${e.name}: both real CSS opacity completion events are required`);
  assert(coverStart.at <= cover.at && cover.at <= revealStart.at && revealStart.at < reveal.at);
  assert.equal(coverStart.elapsed, 0); assert.equal(revealStart.elapsed, 0);
  const frame = t.frames.find(f => f.phase === "covering"); assert(frame);
  assert(Math.abs(cover.elapsed * 1000 - frame.coverMs) < .001);
  assert(Math.abs(reveal.elapsed * 1000 - frame.revealMs) < .001);
  assert(Math.abs((cover.elapsed + reveal.elapsed) * 1000 - expected) < .001);
  assert(reveal.at > cover.at);
  return { owner: "blackout", cover: cover.elapsed * 1000, reveal: reveal.elapsed * 1000, duration: expected };
}
try {
  const sessionPath = path.join(source, "installed-session.json"), rawPath = path.join(source, "motion.json");
  const s = read(sessionPath), r = read(rawPath); validate(s, r);
  report.session = desc(sessionPath); report.raw = desc(rawPath);
  const journal = read(path.join(source, "profile-protection.json"));
  group("Current installed provenance and rejection of missing or overstated evidence", () => {
    assert.equal(s.snapshots.length, 12);
    assert.equal(new Set(s.protectedFiles.map(f => path.resolve(f.path))).size, 17);
    for (const f of [s.installation, s.executable, s.originalExport, s.originalFixture, s.restoration,
      ...s.protectedFiles, ...s.cartridges, ...r.sources]) assert.equal(sha(f.path), f.sha256, f.path);
    for (const f of s.snapshots) {
      assert.equal(sha(f.copy.path), f.copy.sha256); assert.equal(f.source.sha256, f.copy.sha256);
      if (/\.cjs$/.test(f.source.path) || /\.ps1$/.test(f.source.path)) assert.equal(sha(f.source.path), f.source.sha256);
    }
    const mutations = [
      a => { a[0].status = "RUNNING"; }, a => { a[0].version = "1.9.13"; },
      a => { a[0].executable.sha256 = "other"; }, a => { a[0].commands[3].status = "FAILED"; },
      a => { a[0].gitAfter.index = "modified"; }, a => { a[0].modelRequests = 1; },
      a => { a[1].matrix = []; }, a => { a[1].matrix[1] = a[1].matrix[0]; },
      a => { a[1].matrix[0].episodes = []; }, a => { a[1].matrix[0].episodes[0].trace.frames = 0; },
      a => { a[1].matrix[0].episodes[0].checks[0].status = "FAILED"; },
      a => { a[1].matrix[0].episodes[0].actionError = "never reached page"; },
      a => { a[1].screenshots.pop(); }, a => { a[1].launches[0].executableSha256 = "other"; },
      a => { a[1].launches[0].identity.ExecutablePath = "D:\\AgentVN\\agentvn-player.exe"; },
      a => { a[1].launches[0].cleanup.status = "RUNNING"; },
      a => { a[1].launches[0].cleanup.method = "REAL_UI_CONFIRMED_NATIVE_DESTROY"; },
      a => { a[1].pageErrors.push("unreported"); }, a => { a[1].cleanupError = "not restored"; },
      a => { a[1].notRun = a[1].notRun.filter(n => n !== "Editor transitions"); },
    ];
    for (const mutate of mutations) { const a = structuredClone([s, r]); mutate(a); assert.throws(() => validate(...a)); }
    return { version: s.version, executable: s.executable, invalidReportVariantsRejected: mutations.length,
      snapshots: s.snapshots.length, protectedDistinctPaths: 17 };
  });
  group("All24 actual display combinations and456 native frame traces reevaluated", () => {
    let frames = 0, traces = 0, assertions = 0;
    const names = new Map(), durations = { normal: [], reduced: [] }, actualTimings = [];
    for (const m of r.matrix) {
      for (const e of m.episodes) {
        assert.equal(sha(e.trace.path), e.trace.sha256);
        const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path)));
        assert.equal(t.name, e.name); assert.equal(t.frames.length, e.trace.frames);
        validateCriticalTrace(m, e, t); frames += t.frames.length; traces++; assertions += e.checks.length;
        const actual = presentedTiming(m, e, t);
        if (actual) actualTimings.push({ key: m.key, episode: e.name, ...actual });
        names.set(e.name, (names.get(e.name) || 0) + 1);
        if (e.timings) {
          assert.equal(e.timings.expectedMs, m.reduced ? 816 : 1632);
          const changing = t.frames.filter(f => !["idle", "loading"].includes(f.phase));
          assert.equal(e.timings.observedChangingSpanMs, changing.at(-1).at - changing[0].at);
          durations[m.reduced ? "reduced" : "normal"].push(e.timings.observedChangingSpanMs);
        }
        // No overlay or inaccessible old focus may remain at the final
        // playing seam. This supplements, not replaces, the original oracle.
        const last = t.frames.at(-1);
        if (last.screen === "playing") {
          assert.equal(last.black, 0); assert(!last.launch);
          assert.equal(last.snapshots.length, 0); assert.equal(last.modalExits.length, 0);
          assert(!last.unavailableFocus); assert.equal(last.playerCount, 1);
        }
      }
      if (m.layout === "renpy") {
        const buttons = m.quickGeometry.buttons; assert.equal(buttons.length, 8);
        for (const b of buttons) {
          assert(b.hit && Math.abs(b.rect.top - buttons[0].rect.top) <= 1);
          assert(b.rect.left >= -1 && b.rect.right <= m.width + 1);
        }
        for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++)
          assert(Math.min(buttons[i].rect.right, buttons[j].rect.right)
            - Math.max(buttons[i].rect.left, buttons[j].rect.left) <= 1);
      }
    }
    assert.equal(traces, 456); assert(frames > traces * 3);
    return { combinations: 24, episodes: traces, assertions, frames, names: Object.fromEntries(names),
      actualBrowserAnimationClocks: actualTimings,
      observedChangingSpanMs: Object.fromEntries(Object.entries(durations).map(([mode, values]) =>
        [mode, { min: Math.min(...values), max: Math.max(...values), samples: values.length }])),
      scope: "Original product tokens, no CSS/time/engine overrides; no quick-load/gallery/audio claim" };
  });
  group("Raw-frame guards reject black nonstory menus, missing fades and duplicate owners", () => {
    const m = r.matrix.find(m => m.layout === "renpy" && !m.reduced && m.dpr === 1 && m.width === 1920);
    const e = m.episodes.find(e => e.name === "settings-to-about");
    const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path)));
    const mutations = [
      t => { t.frames = []; }, t => { t.inputs.forEach(i => { i.trusted = false; }); },
      t => { t.frames[0].playerCount = 2; }, t => { t.frames[0].horizontalOverflow = 500; },
      t => { t.frames.forEach(f => { f.black = 1; }); },
      t => { t.frames.forEach(f => { f.sameNavigation = false; }); },
      t => { t.frames.forEach(f => { if (f.surface) f.surface.opacity = 1; }); },
      t => { t.frames.forEach(f => { if (f.phase === "crossfading") f.snapshots = []; }); },
      t => { t.frames.forEach(f => { f.duration = 0; }); },
      t => { t.frames.at(-1).screen = "help"; },
    ];
    for (const mutate of mutations) {
      const copy = structuredClone(t); mutate(copy);
      assert.throws(() => validateCriticalTrace(m, e, copy));
    }
    presentedTiming(m, e, t);
    const falseClock = structuredClone(t);
    for (const f of falseClock.frames) for (const a of f.surface?.animations || []) if (a.name === "WAAPI") a.time = 0;
    assert.throws(() => presentedTiming(m, e, falseClock));
    const falseDuration = structuredClone(t);
    for (const f of falseDuration.frames) for (const a of f.surface?.animations || []) if (a.name === "WAAPI") a.duration = 1;
    assert.throws(() => presentedTiming(m, e, falseDuration));
    const am = r.matrix.find(m => m.layout === "agentvn" && !m.reduced && m.dpr === 1 && m.width === 1920);
    const ae = am.episodes.find(e => e.name === "title-to-settings");
    const at = JSON.parse(zlib.gunzipSync(fs.readFileSync(ae.trace.path)));
    presentedTiming(am, ae, at);
    const missingEnd = structuredClone(at); missingEnd.events = [];
    assert.throws(() => presentedTiming(am, ae, missingEnd));
    const falseEnd = structuredClone(at);
    for (const event of falseEnd.events) if (event.type === "transitionend") event.elapsed = 0;
    assert.throws(() => presentedTiming(am, ae, falseEnd));
    return { currentNativeTrace: desc(e.trace.path), invalidTraceVariantsRejected: mutations.length + 4,
      declarationOnlyDurationCannotPass: true };
  });
  group("Every final PNG matches actual viewport/DPR/media and exact physical pixel size", () => {
    for (const m of r.matrix) {
      const shot = r.screenshots.find(s => path.basename(s.path) === `${m.layout}-${m.key}-final.png`); assert(shot);
      assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
      const v = shot.before, b = fs.readFileSync(shot.path);
      assert.equal(v.width, m.width); assert.equal(v.height, m.height);
      assert(Math.abs(v.dpr - m.dpr) <= 1e-6); assert.equal(v.reduced, m.reduced);
      assert.equal(b.readUInt32BE(16), m.width * m.dpr); assert.equal(b.readUInt32BE(20), m.height * m.dpr);
    }
    return { images: 24, physical4kDisplayClaimed: false, completeArtDirectionClaimed: false };
  });
  group("Original directory identities/bytes,17 protected paths and Git unchanged; owned roots/ports gone", () => {
    const restored = read(s.restoration.path); assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const old of journal.records) {
      const actual = restored.restored.find(j => j.original === old.original); assert(actual);
      assert.equal(actual.directoryId, old.directoryId); assert.deepEqual(actual.files, old.files);
      assert(!fs.existsSync(old.held)); if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
      for (const f of old.files) assert.equal(sha(path.join(old.original, f.relative)), f.sha256);
      if (old.existed) {
        const p = spawnSync("fsutil.exe", ["file", "queryfileid", old.original], { encoding: "utf8", windowsHide: true });
        assert.equal(p.status, 0); assert(p.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
      }
    }
    const active = rows(), ports = r.launches.map(l => l.port);
    for (const l of r.launches) {
      const created = Number(l.identity.CreationDate.match(/\d+/)[0]);
      assert(!active.some(p => p.ProcessId === l.identity.ProcessId && Date.parse(p.Created) === created));
    }
    assert(!active.some(p => p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
    assert.deepEqual(listeners(ports), []);
    assert.equal(sha(path.resolve(__dirname, "../.git/index")), s.gitBefore.index);
    const currentHead = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: path.resolve(__dirname, ".."), encoding: "utf8", windowsHide: true });
    assert.equal(currentHead.status, 0); assert.equal(currentHead.stdout.trim(), s.gitBefore.head);
    return { recordedRootsAbsent: r.launches.length, portsAbsent: new Set(ports).size,
      originalDirectoriesRestored: true, userFilesDeleted: 0, attributedTerminationNotNormalClose: true,
      descendantsNotIndividuallyRecorded: true };
  });
  report.remaining = ["Complete Editor motion", "All17 settings persistence", "Gallery/asset-specific/menu loader fault cases",
    "Quick-load original dark PNG cause", "Physical native close", "Windows standalone/setup/upgrade",
    "Android and final project", "Complete regression"];
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out,
    groups: report.groups.map(g => ({ name: g.name, status: g.status })), error: report.error }, null, 2));
}
