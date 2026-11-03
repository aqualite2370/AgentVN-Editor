"use strict";
// Evidence audit only. This never starts an app, rewrites a failed run or
// treats successful evidence collection as a successful product acceptance.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-runtime-motion-20261018-01", out = process.argv[2];
assert(out && !fs.existsSync(out), "New evidence path required");
const sha = file => sha256(fs.readFileSync(file));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", g13Status: "NOT_RUN",
  at: new Date().toISOString(), checks: [], inputs: [], commands: [], traces: 0, frames: 0,
  screenshots: 0, productFailures: [], productChanges: 0, realModelRequests: 0, error: null };
const traceData = new Map();
function load(name) {
  const file = path.join(run, name);
  report.inputs.push({ path: file, sha256: sha(file) });
  return read(file);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
function trace(row, m) {
  assert.equal(sha(row.trace.path), row.trace.sha256);
  const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(row.trace.path)).toString("utf8"));
  assert.equal(t.name, row.name); assert.equal(t.frames.length, row.trace.frames);
  assert(t.frames.length >= 3 && !t.limitReached && !row.actionError);
  assert(t.inputs.some(i => i.trusted), "Actual trusted input is required");
  assert(t.frames.every(f => !f.hidden && f.width === m.width && f.height === m.height
    && f.dpr === m.dpr && f.reduced === m.reduced), "Actual parameter drift or hidden samples");
  report.traces++; report.frames += t.frames.length;
  // Keep only references, not hundreds of decompressed native frame sequences.
  // Each sequence is re-read for the independent checks below.
  traceData.set(`${m.key}/${row.name}`, row.trace.path); return t;
}
const readTrace = file => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
const get = (m, name) => readTrace(traceData.get(`${m.key}/${name}`));
const close = (a, b) => Math.abs(a - b) <= 1;
(async () => {
  const prep = load("preparation.json"), main = load("matrix-01/report.json"), probe = load("probe-01/report.json");
  await check("Frozen installed Player and real Editor UI-exported unmodified cartridges are independently identified", async () => {
    assert.equal(prep.status, "PASS"); assert.equal(prep.verifiedOriginalFiles, 55);
    assert.equal(main.exe.sha256, "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(sha(main.exe.path), main.exe.sha256);
    assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")),
      "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(main.sourceReports.length, 2);
    for (const s of main.sourceReports) {
      assert.equal(sha(s.path), s.sha256);
      const source = read(s.path); assert.equal(source.status, "PASS");
      assert.equal(source.cartridge.path, s.cartridge.path);
      assert.equal(sha(s.cartridge.path), s.cartridge.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(s.cartridge.path));
      const bytes = await zip.file("ui/layout.json").async("nodebuffer");
      assert.equal(sha256(bytes), s.layoutSha256);
      assert.equal(JSON.parse(bytes).layout_type || "agentvn", s.layout);
    }
    assert.equal(main.realModelRequests, 0); assert.equal(main.productChanges, 0);
    const frozenFile = "D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json";
    const frozen = read(frozenFile);
    report.inputs.push({ path: frozenFile, sha256: sha(frozenFile) });
    assert.equal(frozen.status, "PASS"); assert.equal(frozen.source.length, 560);
    for (const s of frozen.source) assert.equal(sha(s.path), s.sha256, `Frozen product source changed: ${s.path}`);
    assert.equal(path.resolve(main.environment.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
    assert.equal(path.resolve(main.environment.AGENTVN_TEST_PROJECT),
      path.resolve(main.environment.sourceProjects.agentvn));
    assert(main.launches.every(l => l.defaultIsolatedProfile && !l.backendStarted));
    return { actualInstalledPlayer: true, unchangedCartridges: 2, frozenProductSourcesMatched: 560, actualWindowsSetup: false,
      Android: false, finalUserProjectUsed: false, newDevBuild: false, physical4KDisplayClaim: false };
  });
  await check("Both layouts have the complete24 native parameter combinations and432 actual nonempty episodes", () => {
    assert.equal(main.probeOnly, false); assert(main.finishedAt); assert.equal(main.error, null);
    assert.equal(main.matrix.length, 24); assert.equal(main.pageErrors.length, 0);
    const keys = new Set(main.matrix.map(m => `${m.layout}/${m.width}/${m.height}/${m.dpr}/${m.reduced}`));
    assert.equal(keys.size, 24);
    for (const l of ["agentvn", "renpy"]) for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const d of [1, 2]) for (const r of [false, true]) assert(keys.has(`${l}/${w}/${h}/${d}/${r}`));
    let assertions = 0, failedAssertions = 0;
    for (const m of main.matrix) {
      assert(!m.error); assert.equal(m.episodes.length, 18);
      assert.equal(new Set(m.episodes.map(e => e.name)).size, 18);
      for (const e of m.episodes) {
        trace(e, m); assert(e.checks.length >= 5);
        assertions += e.checks.length;
        for (const c of e.checks.filter(c => c.status === "FAILED")) {
          failedAssertions++;
          report.productFailures.push({ combination: m.key, episode: e.name, check: c.name });
        }
      }
    }
    assert.equal(report.traces, 432);
    report.mainAssertions = assertions; report.failedAssertions = failedAssertions;
    return { combinations: 24, episodes: report.traces, assertions, failedAssertions, frames: report.frames };
  });
  await check("Retained presentation is inert and no second functional player, horizontal overflow or unavailable focus is hidden by aggregation", () => {
    for (const file of traceData.values()) for (const f of readTrace(file).frames) {
      assert(f.horizontalOverflow <= 1 && f.functionalLayerCount === 1 && f.playerCount <= 1);
      assert(!f.snapshotFocus);
      for (const s of f.snapshots) assert(s.inert && s.ariaHidden === "true" && s.pointerEvents === "none");
    }
    // Modal focus is audited separately; this does not claim that all possible
    // Runtime input/ownership branches were exercised.
    return { rawFramesChecked: report.frames, secondEngineOrAudioInitializationClaim: false };
  });
  await check("Independent raw-frame checks preserve per-layout page seams, equal token durations and shared-menu navigation continuity", () => {
    let screenTransitions = 0, categories = 0, gameplayLaunches = 0, redirects = 0;
    for (const m of main.matrix) {
      const total = m.reduced ? 816 : 1632;
      for (const e of m.episodes.filter(e => e.timings)) {
        const t = get(m, e.name), frames = t.frames;
        const changing = frames.filter(f => f.phase !== "idle" && f.phase !== "loading");
        assert(changing.length >= 3 && frames.at(-1).phase === "idle");
        assert.equal(frames.at(-1).screen, e.timings.to);
        assert(changing.every(f => f.duration === total && f.coverMs + f.revealMs === total));
        const from = e.timings.from, to = e.timings.to;
        if (m.layout === "renpy" && from !== "playing" && to !== "playing") {
          assert(changing.every(f => f.style === "crossfade" && f.black < .01));
          assert(changing.some(f => f.surface?.animations.some(a => a.name === "WAAPI" && a.duration === total)),
            "Inspect actual animation timing, not only diagnostic duration attributes");
          assert(changing.filter(f => f.surface?.opacity > .01 && f.surface.opacity < .99).length >= 2);
          for (const f of changing.filter(f => f.phase === "crossfading"))
            assert(f.snapshots.some(s => !s.category && Math.abs(s.opacity + f.surface.opacity - 1) <= .1));
          if (e.checks.some(c => c.name === "Shared navigation stays mounted and geometrically fixed")) {
            const first = frames.find(f => f.nav).nav.rect;
            assert(frames.every(f => f.sameNavigation && f.nav
              && ["x", "y", "width", "height"].every(k => close(f.nav.rect[k], first[k]))));
          }
        } else {
          assert(["covering", "swap", "revealing"].every(p => changing.some(f => f.phase === p)));
          assert(changing.some(f => f.phase === "covering" && f.black > .01 && f.black < .99));
          assert(changing.some(f => f.phase === "revealing" && f.black > .01 && f.black < .99));
          assert(frames.find(f => f.screen === to && f.committed === to).black >= .99);
          for (const [phase, ms] of [["covering", m.reduced ? 408 : 748], ["revealing", m.reduced ? 408 : 884]])
            assert(t.events.some(e => e.type === "transitionend" && e.name === "opacity"
              && typeof e.target === "string" && e.target.startsWith("runtime-screen-transition")
              && e.target.includes(`is-${phase}`) && Math.abs(e.elapsed * 1000 - ms) < .1),
            "Actual CSS completion timing must match the corresponding token");
        }
        screenTransitions++;
      }
      for (const id of ["text", "audio", "skip", "system"]) {
        const t = get(m, `settings-category-${id}`), fading = t.frames.filter(f => f.categoryPhase === "crossfading");
        assert(fading.length >= 3 && fading.every(f => f.black < .01 && f.categoryDuration === total));
        assert(fading.some(f => f.category.opacity > .01 && f.category.opacity < .99));
        assert(fading.some(f => f.category.animations.some(a => a.name === "WAAPI" && a.duration === total)));
        assert.equal(t.frames.at(-1).categoryId, id); categories++;
      }
      for (const name of ["title-to-playing", "main-menu-continue-playing"]) {
        const t = get(m, name);
        for (const cls of ["is-covering", "is-revealing"])
          assert(t.frames.some(f => f.launchClass?.includes(cls) && f.launch.opacity > .01 && f.launch.opacity < .99));
        for (const [phase, ms] of [["covering", m.reduced ? 408 : 748], ["revealing", m.reduced ? 408 : 884]])
          assert(t.events.some(e => e.type === "transitionend" && e.name === "opacity"
            && typeof e.target === "string" && e.target.startsWith("game-launch-blackout")
            && e.target.includes(`is-${phase}`) && Math.abs(e.elapsed * 1000 - ms) < .1));
        assert(t.frames.filter(f => f.launch).every(f => f.black < .01));
        assert.equal(t.frames.at(-1).screen, "playing"); gameplayLaunches++;
      }
      if (m.layout === "renpy") {
        const t = get(m, "rapid-menu-redirect");
        assert.equal(t.frames.at(-1).screen, "about");
        assert(t.frames.every(f => f.black < .01 && f.sameNavigation));
        assert(t.inputs.filter(i => i.trusted && i.type === "click").length >= 4);
        assert.equal(m.quickGeometry.status, "PASS"); assert.equal(m.quickGeometry.buttons.length, 8);
        assert(m.quickGeometry.buttons.every(b => b.hit && close(b.rect.top, m.quickGeometry.buttons[0].rect.top)
          && b.rect.left >= 0 && b.rect.right <= m.width));
        redirects++;
      }
    }
    return { screenTransitions, settingsCategories: categories, dedicatedGameplayLaunches: gameplayLaunches,
      rapidSharedMenuRedirects: redirects, renpyEightItemGeometry: 12, quickActionsFunctionalityClaim: false };
  });
  await check("Product failures are backed by raw frames and trusted input rather than screenshot names or static source hypotheses", () => {
    const modals = [], escapes = [], quick = [];
    for (const m of main.matrix) {
      const mt = get(m, "exit-modal-open-cancel"), visible = mt.frames.filter(f => f.modal);
      assert(visible.length >= 2 && visible.every(f => f.modalFocus));
      assert(visible.every(f => f.modal.opacity === 1 && f.modal.transform === "none"
        && f.backdrop.opacity === 1 && f.backdrop.transform === "none"
        && f.modal.animations.length === 0 && f.backdrop.animations.length === 0));
      assert.equal(mt.frames.at(-1).modalCount, 0); assert.equal(mt.frames.at(-1).screen, "settings");
      modals.push({ combination: m.key, sampledVisibleFrames: visible.length });
      const et = get(m, "Escape-during-menu-cover"), keys = et.inputs.filter(i => i.key === "Escape" && i.trusted);
      assert.equal(keys.length, 2);
      assert(et.frames.some(f => f.at >= keys[0].at && f.at <= keys[1].at && f.phase === "covering"));
      assert.equal(et.frames.at(-1).phase, "idle"); assert.equal(et.frames.at(-1).screen, "main_menu");
      assert.equal(et.frames.at(-1).committed, "main_menu");
      escapes.push({ combination: m.key, inputs: keys, finalScreen: et.frames.at(-1).screen });
      if (m.layout === "agentvn") {
        const qt = get(m, "quick-menu-expand-collapse");
        assert(qt.frames.some(f => f.quickClass?.includes("is-expanded")));
        assert(qt.frames.at(-1).quickClass.includes("is-collapsed"));
        if (m.reduced) {
          const intermediate = qt.frames.filter(f => f.quickButtons.some(b => b.opacity > .01 && b.opacity < .99));
          assert.equal(intermediate.length, 0);
          assert(qt.frames.some(f => f.quickButtons.some(b => b.opacity === 1)));
          quick.push({ combination: m.key, intermediateButtonFrames: 0 });
        } else {
          const clips = qt.frames.filter(f => f.quickSurface?.animations.some(a => a.name === "clip-path" && a.state === "running"));
          assert(clips.length >= 2 && new Set(clips.map(f => f.quickSurface.clipPath)).size >= 3);
        }
      }
    }
    assert.equal(modals.length, 24); assert.equal(escapes.length, 24); assert.equal(quick.length, 6);
    const known = new Set(["Modal opening retains actual intermediate opacity or transform",
      "Escape during curtain is not swallowed and returns to gameplay",
      "AgentVN quick menu has real intermediate presentation"]);
    assert(report.productFailures.every(f => known.has(f.check)), "Additional failures need classification, not silent suppression");
    assert.equal(report.productFailures.length, 54); assert.equal(main.status, "FAILED");
    report.g13Status = "FAILED";
    return { defects: [
      { id: "G13-01", scope: "Both layouts exit-confirm opening/closing", combinations: modals },
      { id: "G13-02", scope: "Both layouts second Escape during cover", combinations: escapes },
      { id: "G13-03", scope: "AgentVN reduced-motion quick menu", combinations: quick }
    ], finalScreenshotActualPage: "main_menu; legacy filename-playing-final is not evidence of gameplay",
    closingQuickItemFadeSeparatelyVerified: false, productFixApplied: false };
  });
  await check("Original failed probe remains failed and tool-oracle corrections do not rewrite product history", () => {
    assert.equal(probe.status, "FAILED"); assert.equal(probe.probeOnly, true);
    assert.equal(probe.matrix.length, 2); assert(probe.finishedAt);
    assert(probe.matrix.every(m => m.episodes.length === 18));
    assert(probe.matrix.some(m => m.episodes.some(e => e.actionError)));
    assert(probe.launches.every(l => l.cleanup.status === "PASS"));
    return { originalProbe: "FAILED", sampledProbeEpisodes: 36, probeCountedInMainMatrix: false,
      correctedOracles: ["clip-path observation for normal AgentVN quick menu",
        "full-page versus shared-content animation owner for Renpy",
        "settle actual Escape result before asserting expected result, avoiding30s repeated wrong-target wait"],
      retainedActualProductFailures: ["modal", "Escape"], originalFilesOverwritten: false };
  });
  await check("All24 raw native screenshots preserve actual viewport/DPR/media before and after capture", () => {
    assert.equal(main.screenshots.length, 24);
    for (let i = 0; i < main.screenshots.length; i++) {
      const s = main.screenshots[i], m = main.matrix[i], bytes = fs.readFileSync(s.path);
      assert.equal(sha256(bytes), s.sha256); assert.deepEqual(s.before, s.after);
      assert.deepEqual(s.before, { width: m.width, height: m.height, dpr: m.dpr, reduced: m.reduced });
      assert.equal(bytes.readUInt32BE(16), m.width * m.dpr);
      assert.equal(bytes.readUInt32BE(20), m.height * m.dpr); report.screenshots++;
    }
    return { nativePNGs: report.screenshots, screenshotOnlyPassClaim: false, screenshotFinalPage: "main_menu" };
  });
  await check("Attributed players stopped;55 independent original hashes restored; DB, Dev and pending MSI unchanged; no owned ports/processes", () => {
    assert(!main.cleanupError); assert.equal(main.launches.length, 2);
    assert(main.launches.every(l => l.cleanup.status === "PASS"));
    const restored = load("profile-restoration.json"); assert.equal(restored.status, "PASS");
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) {
        assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
        assert.equal(sha(f.backup), f.sha256); count++;
      }
    }
    assert.equal(count, 55); assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const old = read("D:/AgentVN/output/host-msi-session-20261018-01/incident-audit-01.json");
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), old.userPersistence.databaseSha256);
    assert.equal(sha(path.join(old.actualInstallation.path, "agentvn-editor.exe")), old.actualInstallation.executableSha256);
    const ports = [...new Set([8278, ...main.launches.map(l => l.cdpPort), ...probe.launches.map(l => l.cdpPort)])];
    const q = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)|AgentVN-QA-InstalledRuntimeMotion')}|Select-Object Name,ProcessId)
      $s=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$p;ports=$s}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 15000 });
    assert.equal(q.status, 0, q.stderr); const state = JSON.parse(q.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { originalFileHashes: count, wholeProfiles: 4, portsChecked: ports, ...state,
      stopMethod: "Attributed termination; not normal physical close acceptance" };
  });
  await check("Evidence validator self-tests and changed Runtime test tools are actually parsed", () => {
    const commands = [
      ["scripts/full-regression-evidence-test.cjs"],
      ["--check", "scripts/installed-runtime-motion-playwright.cjs"],
      ["--check", "scripts/lib/installed-runtime-motion-sampler.cjs"],
      ["--check", "scripts/installed-runtime-motion-terminal-audit.cjs"]
    ];
    for (const args of commands) {
      const p = spawnSync(process.execPath, args, { cwd: "D:/AgentVN", encoding: "utf8", windowsHide: true, timeout: 60000 });
      report.commands.push({ command: `node ${args.join(" ")}`, exitCode: p.status, stdout: p.stdout, stderr: p.stderr });
      assert.equal(p.status, 0, p.stderr);
    }
    const parserCommand = "$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('D:\\AgentVN\\scripts\\installed-preview-session.ps1',[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|Format-List;exit 1};'PASS: installed-preview-session.ps1 parser'";
    const parsed = spawnSync("powershell.exe", ["-NoProfile", "-Command", parserCommand],
      { cwd: "D:/AgentVN", encoding: "utf8", windowsHide: true, timeout: 15000 });
    report.commands.push({ command: `powershell.exe -NoProfile -Command ${parserCommand}`,
      exitCode: parsed.status, stdout: parsed.stdout, stderr: parsed.stderr });
    assert.equal(parsed.status, 0, parsed.stderr);
    return { commands: commands.length + 1, behavioralPassClaimFromSyntax: false };
  });
  report.status = "PASS"; report.evidenceStatus = "PASS";
})().catch(e => {
  report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus, g13Status: report.g13Status,
    checks: report.checks.length, traces: report.traces, frames: report.frames, screenshots: report.screenshots,
    failures: report.productFailures.length, error: report.error, out }, null, 2));
});
