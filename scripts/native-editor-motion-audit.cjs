"use strict";
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { assertHomeContainerCurve } = require("./lib/native-editor-container-curve.cjs");
const { workspaceSequenceFailures } = require("./lib/installed-editor-motion-workspace-policy.cjs");
const base = "F:/AgentVN/QA/Native-Editor-Motion-20261020-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const identityTransform = t => ["none", "matrix(1, 0, 0, 1, 0, 0)",
  "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)"].includes(t);
const delta = (a, b) => Math.max(...["left", "top", "width", "height"].map(k => Math.abs(a[k] - b[k])));
const intersects = (a, b) => a && b && a.left < b.right - 1 && a.right > b.left + 1
  && a.top < b.bottom - 1 && a.bottom > b.top + 1;
const episodes = ["home-to-editor", "edit-to-options", "options-to-ai", "ai-to-options-keyboard",
  ...["settings-layout", "layout-theme", "theme-assets", "assets-library", "library-animation",
    "animation-providers", "providers-history", "history-settings"].map(pair => `tab-${pair.replace("-", "-to-")}`),
  "same-tab-repeat-and-rapid-final-wins", "options-close-to-editor-keyboard", "open-reverse-and-close-reopen", "editor-to-home"];
function validateMatrix(raw, smoke, historicalPredicate = false,
  expectedScope = "CURRENT_NATIVE_DEV_ISOLATED_MOTION_NOT_RELEASE_OR_PHYSICAL") {
  assert(["CURRENT_NATIVE_DEV_ISOLATED_MOTION_NOT_RELEASE_OR_PHYSICAL",
    "CURRENT_INSTALLED_RELEASE_EDITOR_MOTION_NOT_RUNTIME_OR_PHYSICAL"].includes(expectedScope));
  assert.equal(raw.scope, expectedScope);
  assert.equal(raw.status, historicalPredicate ? "FAILED" : "PASS");
  assert.equal(raw.error, null); assert.equal(raw.productChanges, 0); assert.equal(raw.realModelRequests, 0);
  assert.deepEqual(raw.errors, []); assert.deepEqual(raw.modelSubmissions, []);
  const expected = (smoke ? [1920] : [1920, 2560, 3840]).flatMap(width =>
    (smoke ? [1] : [1, 2]).flatMap(dpr => [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
  assert.deepEqual(raw.matrix.map(({ width, height, dpr, reduced }) => ({ width, height, dpr, reduced })), expected);
  for (const m of raw.matrix) {
    assert.equal(m.status, historicalPredicate ? "FAILED" : "PASS");
    assert.deepEqual(m.episodes.map(e => e.name), episodes);
    assert.equal(m.nodeWidthCheck.status, "PASS");
    assert(Math.abs(m.nodeWidthCheck.actual - Math.max(196, Math.min(252, m.width * .105))) <= 2);
    for (const e of m.episodes) {
      assert(!e.actionError); assert(e.checks.length >= 5 && e.trace.frames >= 3);
      if (historicalPredicate && e.name === "home-to-editor") {
        assert.equal(e.status, "FAILED");
        assert.deepEqual(e.checks.filter(c => c.status !== "PASS").map(c => c.name),
          ["Existing container curve/duration are present in actual rendered animation"]);
      } else { assert.equal(e.status, "PASS"); assert(e.checks.every(c => c.status === "PASS")); }
    }
  }
}
function verifyTrace(m, e, t, workspacePolicy) {
  assert.equal(t.name, e.name); assert(t.frames.length >= 3 && !t.limitReached);
  assert(t.inputs.some(i => i.trusted));
  for (const f of t.frames) {
    assert(!f.pageHidden && f.visibilityState === "visible");
    assert.equal(f.width, m.width); assert.equal(f.height, m.height);
    assert(Math.abs(f.dpr - m.dpr) <= 1e-6); assert.equal(f.reduced, m.reduced);
    assert(f.overflow <= 1);
    assert(f.ghosts.every(g => g.inert && g.pointerEvents === "none"));
  }
  const last = t.frames.at(-1);
  if (e.name === "home-to-editor") {
    assertHomeContainerCurve(t, m.reduced);
    assert(t.frames.filter(f => f.editor?.animations.some(a => a.name === "container-boot"))
      .every(f => f.iframeCount === 0));
    assert(t.frames.every(f => [f.home, f.editor, f.overlay].some(v =>
      v && v.display !== "none" && v.visibility !== "hidden" && v.opacity > .01)));
    return;
  }
  if (e.name === "editor-to-home") {
    for (const key of ["editor", "home"]) assert(t.frames.filter(f => f[key]
      && (f[key].opacity > .001 && f[key].opacity < .999 || !identityTransform(f[key].transform))).length >= 2);
    assert(last.home?.opacity >= .99 && (!last.editor || last.editor.inert || last.editor.ariaHidden === "true"));
    return;
  }
  const workspace = t.frames.filter(f => f.palette && f.flow && f.inspector); assert(workspace.length >= 3);
  if (workspacePolicy) assert.deepEqual(workspaceSequenceFailures(workspace, m.baseline, m, workspacePolicy), [], "Workspace trace");
  for (const f of workspace) {
    if (workspacePolicy) {
      assert(!f.focus.inUnavailable && !f.focus.inClosingPanel);
      continue;
    }
    for (const [key, baseline] of [["palette", "paletteRect"], ["flow", "flowRect"], ["inspector", "inspectorRect"]])
      assert(delta(f[key].rect, m.baseline[baseline]) <= 1.5);
    for (const key of ["palette", "inspector"]) {
      const v = f[key]; assert(v.display !== "none" && v.visibility !== "hidden" && v.opacity > .01);
      assert(!intersects(f.panel?.rect, v.rect));
    }
    assert(f.palette.rect.left >= -1 && f.palette.rect.top >= -1
      && f.palette.rect.right <= m.width + 1 && f.palette.rect.bottom <= m.height + 1);
    assert.equal(f.paletteFilteredAncestors.length, 0); assert(!f.focus.inUnavailable && !f.focus.inClosingPanel);
  }
  if (e.name.startsWith("tab-")) {
    const [, from, to] = /^tab-(.+)-to-(.+)$/.exec(e.name);
    const cross = t.frames.filter(f => f.activeTab === to && f.leavingTab === from && f.phase?.includes("crossfading"));
    assert(cross.length >= 2);
    assert(cross.filter(f => f.layers.some(l => l.tab === to && l.opacity > .01 && l.opacity < .99)).length >= 2);
    for (const f of cross) {
      const a = f.layers.find(l => l.tab === to), b = f.layers.find(l => l.tab === from);
      assert(a && b && !a.inert && a.pointerEvents !== "none" && b.inert && b.pointerEvents === "none");
      assert(a.opacity + b.opacity >= .9 && a.opacity + b.opacity <= 1.1);
    }
    const nav = t.frames.find(f => f.buttons.length === 8)?.buttons; assert(nav);
    assert(t.frames.filter(f => f.buttons.length).every(f => f.buttons.length === 8 &&
      f.buttons.every((b, i) => Math.abs(b.width - nav[i].width) <= 1 && Math.abs(b.height - nav[i].height) <= 1)));
    assert.equal(last.activeTab, to); assert(identityTransform(last.panel.transform));
    assert.equal(last.layers.filter(l => !l.inert && l.interactive === "true").length, 1);
    assert.equal(last.ghosts.length, 0); return;
  }
  if (["edit-to-options", "options-to-ai", "ai-to-options-keyboard"].includes(e.name)) {
    const key = e.name === "edit-to-options" ? "panel" : "content";
    assert(t.frames.filter(f => f[key] && (f[key].opacity > .001 && f[key].opacity < .999
      || !identityTransform(f[key].transform))).length >= 2);
    if (e.name === "edit-to-options") assert(last.flow.filter.includes("blur(2.5px)"));
    if (e.name === "options-to-ai") assert(last.task === "assistant" && !last.panel.inert && !last.ghosts.length);
    if (e.name === "ai-to-options-keyboard") assert(t.inputs.some(i => i.trusted && i.key === "Enter")
      && last.focus.tag !== "BODY" && !last.focus.inUnavailable);
  }
  if (e.name === "same-tab-repeat-and-rapid-final-wins") {
    assert.equal(last.activeTab, "settings"); assert(!last.ghosts.length);
    assert.equal(last.layers.filter(l => !l.inert && l.interactive === "true").length, 1);
  }
  if (e.name === "options-close-to-editor-keyboard") {
    const closing = t.frames.filter(f => f.panel?.className.includes("is-closing"));
    assert(closing.length >= 2 && closing.every(f => f.panel.inert && !f.bodyInert && !f.focus.inClosingPanel));
    const blur = t.frames.map(f => Number(/blur\(([\d.]+)px\)/.exec(f.flow?.filter)?.[1] || 0));
    assert(blur.every((v, i) => !i || v <= blur[i - 1] + .025));
    assert(last.selected === "edit" && !last.panel && !last.ghosts.length
      && last.flow.filter === "none" && last.focus.surface === "edit");
  }
  if (e.name === "open-reverse-and-close-reopen") {
    assert(last.task === "options" && !last.panel.inert && !last.ghosts.length);
    const reversals = t.frames.slice(1).filter((f, i) => t.frames[i].panel && f.panel &&
      t.frames[i].panel.className.includes("is-closing") !== f.panel.className.includes("is-closing"));
    assert(reversals.length >= 2);
    for (let i = 1; i < t.frames.length; i++) {
      const a = t.frames[i - 1], b = t.frames[i];
      if (a.panel && b.panel && a.panel.className.includes("is-closing") !== b.panel.className.includes("is-closing"))
        assert(Math.abs(a.panel.opacity - b.panel.opacity) <= .18);
    }
  }
}
function validateFailedShutdown(s) {
  assert.equal(s.status, "FAILED"); assert.equal(s.error, undefined);
  assert.equal(s.commands.length, 1); assert.equal(s.commands[0].status, "PASS");
  assert.equal(s.commands[0].exitCode, 0);
  assert.equal(s.closeMethod, "Process.CloseMainWindow WM_CLOSE_NOT_PHYSICAL");
  assert(s.closeError.startsWith("Error: Deadline normal Editor shutdown: condition false"));
  assert(!s.cleanupError); assert.equal(s.productChanges, 0); assert.equal(s.modelRequests, 0);
  assert(s.cleanup.killed.length > 0);
  for (const id of s.cleanup.killed) assert(s.known.some(p => `${p.ProcessId}:${p.Created}` === id));
  assert.deepEqual(s.cleanup.survivors, []); assert.deepEqual(s.cleanup.listeners, []);
  assert(s.known.some(p => p.ProcessId === s.host.pid && p.Created === s.host.created));
  return { functionalResult: "PASS", originalSession: "FAILED",
    normalShutdown: "FAILED_ROOT_CAUSE_NOT_DETERMINED", cleanup: "OWNED_FORCE_TERMINATION_NO_RESIDUALS",
    forceTerminated: s.cleanup.killed.length };
}
async function main() {
  const name = process.argv[2]; assert(/^audit-(?:smoke-)?\d{2}$/.test(name || ""));
  const smokeOnly = process.argv.includes("--smoke-only"), out = path.join(base, name);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", at: new Date().toISOString(), checks: [],
    scope: "CURRENT_NATIVE_DEV_EDITOR_MOTION_NOT_RELEASE_OR_RUNTIME", productChanges: 0, devBuilds: 0, modelRequests: 0 };
  const check = (name, fn) => {
    const c = { name, status: "RUNNING" }; report.checks.push(c);
    try { c.detail = fn(); c.status = "PASS"; } catch (e) { c.status = "FAILED"; throw e; }
  };
  try {
    const dirs = ["session-02", ...smokeOnly ? [] : ["session-03"]];
    const runs = dirs.map(dir => ({ dir: path.join(base, dir),
      session: read(path.join(base, dir, "session.json")), raw: read(path.join(base, dir, "motion/report.json")) }));
    check("Nonempty complete matrix and exact episodes; old QA failure explicitly preserved", () => {
      for (const [i, r] of runs.entries()) {
        validateMatrix(r.raw, i === 0, i === 0);
        assert.equal(r.session.status, "FAILED");
        assert.equal(r.session.commands.length, 1);
        assert.equal(r.session.commands[0].exitCode, i === 0 ? 1 : 0);
        if (i === 0) {
          assert.equal(r.session.normalExitCode, 0); assert(!r.session.closeError && !r.session.cleanupError);
          assert.deepEqual(r.session.cleanup.killed, []); assert.deepEqual(r.session.cleanup.survivors, []);
          assert.deepEqual(r.session.cleanup.listeners, []);
        } else report.outcomes = validateFailedShutdown(r.session);
      }
      return { originalSmokeSession: "FAILED_PRESERVED_CSS_SEGMENT_PREDICATE",
        reevaluatedSmokeEpisodes: 32, mainEpisodes: smokeOnly ? 0 : 192 };
    });
    check("Every original trace re-evaluated for visibility, geometry, motion, input and final ownership", () => {
      let traces = 0, frames = 0;
      for (const r of runs) for (const m of r.raw.matrix) for (const e of m.episodes) {
        assert.equal(sha(e.trace.path), e.trace.sha256);
        const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path)));
        assert.equal(t.frames.length, e.trace.frames); verifyTrace(m, e, t); traces++; frames += t.frames.length;
      }
      return { traces, frames, sourceOrStyleOrTimeOverrides: false };
    });
    check("Actual captured PNG dimensions/DPR/media, frozen tools and exact current products", () => {
      let pngs = 0;
      for (const r of runs) {
        for (const f of [...r.session.products, ...r.session.sources, ...r.session.tools]) assert.equal(sha(f.path), f.sha256);
        for (const s of r.raw.screenshots) {
          assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
          const m = r.raw.matrix.find(m => path.basename(s.path).startsWith(m.key)); assert(m);
          assert.equal(s.before.width, m.width); assert.equal(s.before.height, m.height);
          assert(Math.abs(s.before.dpr - m.dpr) <= 1e-6); assert.equal(s.before.reduced, m.reduced);
          const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), m.width * m.dpr);
          assert.equal(b.readUInt32BE(20), m.height * m.dpr); pngs++;
        }
      }
      return { pngs, dprNotRounded: true };
    });
    check("Owned process identities and ports are absent; no physical close/installation claim", () => {
      const known = runs.flatMap(r => r.session.known), ports = runs.flatMap(r => r.session.cleanup.ports);
      const result = spawnSync("powershell.exe", ["-NoProfile", "-Command",
        "$p=@(Get-CimInstance Win32_Process|Select-Object ProcessId,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}});" +
        `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);` +
        "@{processes=$p;listeners=$l}|ConvertTo-Json -Depth 4 -Compress"],
      { encoding: "utf8", windowsHide: true, timeout: 20000 });
      assert.equal(result.status, 0); const current = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
      assert(!known.some(p => current.processes.some(a => a.ProcessId === p.ProcessId && a.Created === p.Created)));
      assert.deepEqual(current.listeners, []);
      return { recordedIdentities: known.length, ports: [...new Set(ports)],
        forceKills: runs.reduce((n, r) => n + r.session.cleanup.killed.length, 0),
        closeMethod: "WM_CLOSE_NOT_PHYSICAL" };
    });
    const result = spawnSync(process.execPath, ["scripts/native-editor-container-curve-test.cjs"],
      { encoding: "utf8", windowsHide: true, timeout: 30000 });
    fs.writeFileSync(path.join(out, "curve-validator.log"), result.stdout + result.stderr, { flag: "wx" });
    assert.equal(result.status, 0);
    check("Evidence validator rejects incomplete matrix, hidden controls, false motion and focus ownership", () => {
      const file = path.resolve("scripts/native-editor-motion-audit-test.cjs");
      const result = spawnSync(process.execPath, [file], { encoding: "utf8", windowsHide: true, timeout: 30000 });
      fs.writeFileSync(path.join(out, "evidence-validator.log"), result.stdout + result.stderr, { flag: "wx" });
      assert.equal(result.status, 0); assert(result.stdout.includes("rejected 27"));
      return { source: desc(file), exitCode: result.status, log: desc(path.join(out, "evidence-validator.log")) };
    });
    report.status = smokeOnly ? "RAW_SMOKE_REEVALUATED_PASS_ORIGINAL_QA_FAILURE_PRESERVED"
      : "EVIDENCE_VERIFIED_EDITOR_MOTION_PASS_NATIVE_SHUTDOWN_FAILED";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.source = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error, out }, null, 2));
  }
}
module.exports = { validateMatrix, verifyTrace, validateFailedShutdown };
if (require.main === module) main();
