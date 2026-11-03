"use strict";
// G12 Editor ONLY. No Runtime transition verdict, model requests, product
// modifications, mocked stores or production animation changes.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { settleEditor, sha256 } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { beginEditorMotion, finishEditorMotion } = require("./lib/installed-editor-motion-sampler.cjs");
const { assertHomeContainerCurve } = require("./lib/native-editor-container-curve.cjs");
const { workspaceSequenceFailures, policy: currentWorkspacePolicy } = require("./lib/installed-editor-motion-workspace-policy.cjs");
const { waitForSurfaceTransitionSettled, inspectPersistentWorkspace } = require("./editor-workspace-surface-transition-playwright.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const prepFile = process.argv[2], prep = read(prepFile), fixture = prep.fixture, launch = prep.launch;
const run = prep.run;
if (prep.workspacePolicy !== undefined) assert.equal(prep.workspacePolicy, currentWorkspacePolicy);
const installed = prep.scope === "CURRENT_INSTALLED_RELEASE_EDITOR_MOTION_NOT_RUNTIME_OR_PHYSICAL";
assert(installed || prep.scope === "CURRENT_NATIVE_DEV_ISOLATED_MOTION_NOT_RELEASE_OR_PHYSICAL");
const repairInstall = installed && path.resolve(prep.installationFile) ===
  path.resolve("F:/AgentVN/QA/Editor-Repair-Release-20261024-01/installation.json");
const currentCandidate = installed && prep.candidateVersion !== undefined;
if (currentCandidate) require("./lib/installed-editor-motion-binding.cjs").validateMotionPreparation(prep);
if (repairInstall) assert.match(path.basename(run), /^editor-motion-\d{2}$/);
// The exact candidate root was already checked above. Its receipt may live
// in a preparation subdirectory rather than next to the output sessions.
assert(currentCandidate || path.resolve(run).startsWith(path.resolve(repairInstall
  ? "F:/AgentVN/QA/Editor-Repair-Release-20261024-01" : installed
  ? "F:/AgentVN/QA/Installed-Editor-Motion-20261021-01"
  : "F:/AgentVN/QA/Native-Editor-Motion-20261020-01") + path.sep));
if (repairInstall) assert.equal(path.dirname(path.resolve(run)),
  path.resolve("F:/AgentVN/QA/Editor-Repair-Release-20261024-01"));
if (installed) {
  const receipt = read(prep.installationFile);
  assert.equal(receipt.status, "PASS"); assert.equal(receipt.metadataRestoration, "PASS");
  assert.equal(path.resolve(receipt.executable.path), path.resolve(launch.executable));
  assert.equal(receipt.executable.sha256, launch.executableSha256);
  for (const resource of receipt.resources)
    assert.equal(sha256(fs.readFileSync(resource.path)), resource.sha256);
}
const destination = path.join(run, "motion"); assert(!fs.existsSync(destination)); fs.mkdirSync(destination);
const traceRoot = path.join(destination, "traces"); fs.mkdirSync(traceRoot);
const report = { status: "RUNNING", scope: prep.scope,
  workspacePolicy: prep.workspacePolicy || "LEGACY_NO_INSPECTOR_OVERLAP",
  at: new Date().toISOString(), matrix: [], screenshots: [], errors: [], modelSubmissions: [], realModelRequests: 0, productChanges: 0,
  environment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: process.env.AGENTVN_WORKSPACE_OUTPUT },
  sampling: "Read-only rendered RAF observer; may perturb frame cost; no performance gate or physical4K claim",
  error: null };
let browser, page, cdp, current, serial = 0, expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const save = () => fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const identity = t => ["none", "matrix(1, 0, 0, 1, 0, 0)", "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)"].includes(t);
const delta = (a, b) => a && b ? Math.max(...["left", "top", "width", "height"].map(k => Math.abs(a[k] - b[k]))) : Infinity;
const intersects = (a, b) => a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, `${name}.png`), expected)); save(); }
function check(row, name, ok, detail) {
  row.checks.push({ name, status: ok ? "PASS" : "FAILED", ...(ok ? {} : { detail }) });
}
function traceChecks(row, trace) {
  const f = trace.frames;
  check(row, "Nonempty actual visible native frame sequence covers trusted user input", f.length >= 3 && trace.inputs.some(i => i.trusted)
    && !trace.limitReached && f.every(v => !v.pageHidden && v.visibilityState === "visible"), { frames: f.length, inputs: trace.inputs, limit: trace.limitReached });
  check(row, "Every sampled viewport/DPR/media equals this combination", f.every(v => v.width === expected.width && v.height === expected.height && Math.abs(v.dpr - expected.dpr) <= 1e-6 && v.reduced === expected.reduced));
  check(row, "No document horizontal overflow", f.every(v => v.overflow <= 1), f.filter(v => v.overflow > 1).slice(0, 3));
}
function workspaceChecks(row, trace, baseline) {
  const frames = trace.frames.filter(f => f.palette && f.flow && f.inspector);
  const currentPolicyFailures = prep.workspacePolicy
    ? workspaceSequenceFailures(frames, baseline, expected, prep.workspacePolicy) : [];
  const failures = frames.filter(f => {
    if (prep.workspacePolicy) return currentPolicyFailures.some(item => item.at === f.at);
    const p = f.palette, i = f.inspector;
    return p.display === "none" || p.visibility === "hidden" || p.opacity <= .01 || f.paletteFilteredAncestors.length > 0
      || p.rect.left < -1 || p.rect.top < -1 || p.rect.right > expected.width + 1 || p.rect.bottom > expected.height + 1
      || i.display === "none" || i.visibility === "hidden" || i.opacity <= .01
      || intersects(f.panel?.rect, p.rect) || intersects(f.panel?.rect, i.rect)
      || delta(p.rect, baseline.paletteRect) > 1.5 || delta(f.flow.rect, baseline.flowRect) > 1.5 || delta(i.rect, baseline.inspectorRect) > 1.5;
  });
  check(row, prep.workspacePolicy
    ? "Node rail stays clear, tracks stay fixed; Inspector overlap only for approved complex workbench or observed shrink"
    : "Node controls remain clear/visible, all three tracks remain fixed and panel covers neither rail nor Inspector",
    frames.length >= 3 && failures.length === 0, prep.workspacePolicy
      ? currentPolicyFailures.slice(0, 3) : failures.slice(0, 3));
  const focusFailures = frames.filter(f => f.focus.inUnavailable || f.focus.inClosingPanel);
  check(row, "Focus never remains in inert/hidden/leaving content", focusFailures.length === 0, focusFailures.slice(0, 3));
  check(row, "Presentation ghosts never own input", frames.every(f => f.ghosts.every(g => g.inert && g.pointerEvents === "none")), frames.filter(f => f.ghosts.some(g => !g.inert || g.pointerEvents !== "none")).slice(0, 2));
}
function intermediate(row, trace, selector, label) {
  const values = trace.frames.map(f => f[selector]).filter(Boolean);
  const visible = values.filter(v => v.opacity > .001 && v.opacity < .999 || !identity(v.transform));
  check(row, `${label} retains rendered intermediate presentation`, visible.length >= 2, { visible: visible.length, values: values.slice(0, 3) });
}
async function episode(name, action, verify) {
  const row = { name, status: "RUNNING", checks: [] }; current.episodes.push(row); save(); console.log(`START ${current.key} ${name}`);
  await beginEditorMotion(page, name); let trace;
  try { row.actionResult = await action(); }
  catch (e) { row.actionError = String(e.stack || e); }
  finally {
    trace = await finishEditorMotion(page).catch(e => ({ name, frames: [], inputs: [], events: [], error: String(e) }));
    const file = path.join(traceRoot, `${String(++serial).padStart(3, "0")}-${current.key}-${name}.json.gz`);
    const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(trace))); fs.writeFileSync(file, bytes, { flag: "wx" });
    row.trace = { path: file, sha256: sha256(bytes), frames: trace.frames.length, events: trace.events?.length || 0, inputs: trace.inputs.length };
  }
  traceChecks(row, trace);
  if (row.actionError) check(row, "Actual UI action reaches expected state", false, row.actionError);
  try { if (verify) await verify(row, trace); } catch (e) { check(row, "Verification executed without missing evidence", false, String(e.stack || e)); }
  row.status = row.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (row.status === "FAILED") await shot(`${current.key}-${name}-failed`).catch(() => {});
  save(); console.log(`${row.status} ${current.key} ${name}`); return row;
}
async function homeReady() {
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixture.title }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching, .project-entry-loading-overlay"));
}
async function toolsIdle(tab) {
  await page.waitForFunction(tab => {
    const p = document.querySelector(".workspace-task-panel.is-open:not(.toolbar-popover-morph-ghost)");
    const a = p?.querySelector(".advanced-tab-content.is-active");
    return p?.getAttribute("data-workspace-task") === "options"
      && p.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
      && a?.getAttribute("data-tab") === tab && !a.inert
      && !p.classList.contains("is-morphing") && !p.getAnimations().some(a => a.playState === "running")
      && !document.querySelector(".toolbar-popover-morph-ghost");
  }, tab, { timeout: 30000 });
}
async function closePanel(keyboard = false) {
  const b = page.locator('[data-workspace-surface="edit"]:visible');
  if (keyboard) { await b.focus(); await page.keyboard.press("Enter"); } else await b.click();
  await page.waitForFunction(() => !document.querySelector(".workspace-task-panel:not(.toolbar-popover-morph-ghost)")
    && !document.querySelector(".toolbar-popover-morph-ghost")
    && getComputedStyle(document.querySelector(".flow-surface")).filter === "none", undefined, { timeout: 20000 });
}
const selectors = { settings: ".project-settings-panel", layout: ".runtime-layout-designer", theme: ".runtime-theme-designer",
  assets: ".asset-generation-panel", library: ".asset-library-panel", animation: ".animation-editor-shell", providers: ".provider-settings-panel", history: ".generation-history-panel" };
async function tabEpisode(to, from, baseline) {
  return episode(`tab-${from}-to-${to}`, async () => {
    const b = page.locator(`[data-help-key="advanced.tab.${to}"]:visible`); await b.scrollIntoViewIfNeeded(); await b.click();
    await toolsIdle(to); await page.locator(`.advanced-tab-content.is-active[data-tab="${to}"] ${selectors[to]}`).waitFor();
  }, async (row, trace) => {
    workspaceChecks(row, trace, baseline);
    const cross = trace.frames.filter(f => f.activeTab === to && f.leavingTab === from && f.phase?.includes("crossfading"));
    check(row, "Tab crossfade has real intermediate rendered frames", cross.filter(f => f.layers.some(l => l.tab === to && l.opacity > .01 && l.opacity < .99)).length >= 2,
      { crossFrames: cross.length, first: cross[0] });
    check(row, "Leaving tab cannot receive pointer/focus and ready incoming tab owns input", cross.every(f => {
      const a = f.layers.find(l => l.tab === to), b = f.layers.find(l => l.tab === from);
      return a && b && !a.inert && a.pointerEvents !== "none" && b.inert && b.pointerEvents === "none";
    }) && cross.length >= 2, cross.slice(0, 2));
    check(row, "No tab blank or double-opacity flash during actual handoff", cross.length >= 2 && cross.every(f => {
      const a = f.layers.find(l => l.tab === to), b = f.layers.find(l => l.tab === from); return a && b && a.opacity + b.opacity >= .9 && a.opacity + b.opacity <= 1.1;
    }), cross.filter(f => {
      const a = f.layers.find(l => l.tab === to), b = f.layers.find(l => l.tab === from); return !a || !b || a.opacity + b.opacity < .9 || a.opacity + b.opacity > 1.1;
    }).slice(0, 2));
    const navBaseline = trace.frames.find(f => f.buttons.length === 8)?.buttons;
    check(row, "All eight navigation button layout sizes remain stable through container morph", Boolean(navBaseline) && trace.frames.filter(f => f.buttons.length).every(f =>
      f.buttons.length === 8 && f.buttons.every((b, i) => Math.abs(b.width - navBaseline[i].width) <= 1 && Math.abs(b.height - navBaseline[i].height) <= 1)));
    const final = trace.frames.at(-1);
    check(row, "Only target tab remains interactive, final transform identity and no stale ghosts", final.activeTab === to
      && final.layers.filter(l => !l.inert && l.interactive === "true").length === 1
      && final.ghosts.length === 0 && identity(final.panel?.transform), final);
    row.timings = { actualCrossfadeSpanMs: cross.length ? cross.at(-1).at - cross[0].at : null,
      animationDurations: [...new Set(cross.flatMap(f => f.layers.flatMap(l => l.animations.map(a => a.duration))))] };
  });
}
(async () => {
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
  assert.equal(sha256(fs.readFileSync(launch.executable)), launch.executableSha256);
  for (const p of fixture.projects) {
    const r = await fetch(`${launch.backendUrl}/api/project/projects/import`, { method: "POST", headers: {
      "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(p.input)) },
      body: fs.readFileSync(p.input), signal: AbortSignal.timeout(30000) }); const v = await r.json(); assert(r.ok && v.ok);
  }
  report.fixtureSeed = installed ? "PUBLIC_INSTALLED_PACKAGED_BACKEND_IMPORT_NOT_NATIVE_PICKER"
    : "PUBLIC_CURRENT_NATIVE_BACKEND_IMPORT_NOT_NATIVE_PICKER";
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts().flatMap(c => c.pages()).find(p => installed
    ? /^(https?:\/\/tauri\.localhost|tauri:)/.test(p.url())
    : p.url().startsWith("http://127.0.0.1:6767")); assert(page); page.setDefaultTimeout(25000);
  page.on("pageerror", e => report.errors.push(String(e)));
  page.on("request", r => { if (r.method() === "POST" && /\/api\/(assistant\/creation\/processes|assistant\/chat|novel.*\/start)$/.test(new URL(r.url()).pathname))
    report.modelSubmissions.push({ url: r.url(), at: new Date().toISOString() }); });
  cdp = await page.context().newCDPSession(page);
  for (const [width, height] of prep.smoke ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of prep.smoke ? [1] : [1, 2]) for (const reduced of [false, true]) {
    expected = { width, height, dpr, reduced }; current = { ...expected, key: `${width}-${dpr}-${reduced}`, status: "RUNNING", episodes: [] }; report.matrix.push(current); save();
    try {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      assert.equal(actual.width, width); assert.equal(actual.height, height);
      assert(Math.abs(actual.dpr - dpr) <= 1e-6); assert.equal(actual.reduced, reduced);
      await page.reload({ waitUntil: "domcontentloaded" }); await homeReady();
      await episode("home-to-editor", async () => {
        await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixture.title }).click();
        await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
        await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay, .app-view-editor.is-entering"));
      }, (row, trace) => {
        intermediate(row, trace, "editor", "Home→Editor container");
        const animated = trace.frames.filter(f => f.editor?.animations.some(a => a.name === "container-boot" && a.state === "running"));
        let curveResult;
        try { curveResult = assertHomeContainerCurve(trace, reduced); }
        catch (e) { curveResult = { error: String(e) }; }
        check(row, "Existing container curve/duration are present in actual rendered animation", !curveResult.error, curveResult);
        check(row, "No embedded Runtime iframe mounted during container animation", animated.length >= 2 && animated.every(f => f.iframeCount === 0), animated.filter(f => f.iframeCount > 0).slice(0, 2));
        check(row, "Entry never exposes an empty page between Home/overlay/Editor", trace.frames.every(f => [f.home, f.editor, f.overlay].some(v =>
          v && v.display !== "none" && v.visibility !== "hidden" && v.opacity > .01)));
      });
      const baseline = await inspectPersistentWorkspace(page); current.baseline = baseline;
      const sidebarExpected = Math.max(196, Math.min(252, width * .105));
      current.nodeWidthCheck = { expected: sidebarExpected, actual: baseline.paletteRect?.width,
        status: Math.abs(baseline.paletteRect?.width - sidebarExpected) <= 2 ? "PASS" : "FAILED" };
      await episode("edit-to-options", async () => {
        await page.locator('[data-workspace-surface="options"]:visible').click(); await waitForSurfaceTransitionSettled(page, "options"); await toolsIdle("settings");
      }, (row, trace) => {
        workspaceChecks(row, trace, baseline); intermediate(row, trace, "panel", "Options workbench entry");
        check(row, "Canvas weakens but palette stays clear", trace.frames.at(-1).flow.filter.includes("blur(2.5px)") && trace.frames.at(-1).paletteFilteredAncestors.length === 0);
      });
      await episode("options-to-ai", async () => {
        await page.locator('[data-workspace-surface="assistant"]:visible').click(); await waitForSurfaceTransitionSettled(page, "assistant");
        await page.locator(".workspace-task-panel.is-open .assistant-chat-panel").waitFor();
      }, (row, trace) => {
        workspaceChecks(row, trace, baseline); intermediate(row, trace, "content", "Options→AI content");
        check(row, "Final sole input owner is AI, no ghost remains", trace.frames.at(-1).task === "assistant" && !trace.frames.at(-1).panel.inert && trace.frames.at(-1).ghosts.length === 0);
      });
      await episode("ai-to-options-keyboard", async () => {
        await page.locator('[data-workspace-surface="options"]:visible').focus(); await page.keyboard.press("Enter");
        await waitForSurfaceTransitionSettled(page, "options"); await toolsIdle("settings");
      }, (row, trace) => {
        workspaceChecks(row, trace, baseline); intermediate(row, trace, "content", "Keyboard AI→Options");
        check(row, "Keyboard trigger retained actual continuous handoff and meaningful focus", trace.inputs.some(i => i.type === "keydown" && i.key === "Enter" && i.trusted)
          && trace.frames.at(-1).focus.tag !== "BODY" && !trace.frames.at(-1).focus.inUnavailable);
      });
      let from = "settings";
      for (const to of ["layout", "theme", "assets", "library", "animation", "providers", "history", "settings"]) { await tabEpisode(to, from, baseline); from = to; }
      await episode("same-tab-repeat-and-rapid-final-wins", async () => {
        await page.locator('[data-help-key="advanced.tab.settings"]:visible').dblclick();
        for (const tab of ["providers", "library", "settings"]) await page.locator(`[data-help-key="advanced.tab.${tab}"]:visible`).click();
        await toolsIdle("settings");
      }, (row, trace) => {
        workspaceChecks(row, trace, baseline);
        const f = trace.frames.at(-1);
        check(row, "Final rapid target wins and no old callback leaves a second input owner", f.activeTab === "settings" && f.ghosts.length === 0
          && f.layers.filter(l => !l.inert && l.interactive === "true").length === 1, f);
      });
      await episode("options-close-to-editor-keyboard", async () => closePanel(true), (row, trace) => {
        workspaceChecks(row, trace, baseline); intermediate(row, trace, "panel", "Options workbench exit");
        const closing = trace.frames.filter(f => f.panel?.className.includes("is-closing"));
        check(row, "Leaving workbench immediately inert with background input ownership", closing.length >= 2 && closing.every(f => f.panel.inert && !f.bodyInert && !f.focus.inClosingPanel), closing.slice(0, 2));
        const blur = trace.frames.map(f => Number(/blur\(([\d.]+)px\)/.exec(f.flow?.filter)?.[1] || 0));
        check(row, "Closing blur clears monotonically, no ghost-owned reblur", blur.every((v, i) => !i || v <= blur[i - 1] + .025), blur);
        const f = trace.frames.at(-1);
        check(row, "Final edit surface owns focus and no stale layer remains", f.selected === "edit" && !f.panel && f.ghosts.length === 0
          && f.flow.filter === "none" && f.focus.surface === "edit", f);
      });
      await episode("open-reverse-and-close-reopen", async () => {
        const options = page.locator('[data-workspace-surface="options"]:visible'), edit = page.locator('[data-workspace-surface="edit"]:visible');
        await options.click();
        await page.waitForFunction(() => {
          const p = document.querySelector(".workspace-task-panel.is-open"), a = p?.getAnimations().find(a => a.animationName === "workspace-task-enter");
          return a?.playState === "running" && a.effect.getComputedTiming().progress > .15 && a.effect.getComputedTiming().progress < .9;
        });
        await edit.click(); await page.waitForFunction(() => !document.querySelector(".workspace-task-panel"));
        await options.click(); await waitForSurfaceTransitionSettled(page, "options");
        await edit.click();
        await page.waitForFunction(() => {
          const p = document.querySelector(".workspace-task-panel.is-closing"), a = p?.getAnimations().find(a => a.animationName === "workspace-task-exit");
          return a?.playState === "running" && a.effect.getComputedTiming().progress > .15 && a.effect.getComputedTiming().progress < .9;
        });
        await options.click(); await waitForSurfaceTransitionSettled(page, "options");
      }, (row, trace) => {
        workspaceChecks(row, trace, baseline);
        const f = trace.frames.at(-1); check(row, "Reversal final target has unique input ownership", f.task === "options" && !f.panel.inert && f.ghosts.length === 0, f);
        const transitions = trace.frames.slice(1).flatMap((f, i) => {
          const prev = trace.frames[i], reversing = prev.panel && f.panel &&
            prev.panel.className.includes("is-closing") !== f.panel.className.includes("is-closing");
          return reversing ? [{ before: prev.panel.opacity, after: f.panel.opacity, elapsed: f.at - prev.at,
            classBefore: prev.panel.className, classAfter: f.panel.className }] : [];
        });
        check(row, "Interrupted transitions continue from current presentation rather than restarting opacity", transitions.length >= 2
          && transitions.every(t => Math.abs(t.before - t.after) <= .18), transitions); row.reversals = transitions;
      });
      await closePanel();
      await episode("editor-to-home", async () => {
        await page.getByRole("button", { name: "返回首页", exact: true }).click(); await homeReady();
      }, (row, trace) => {
        intermediate(row, trace, "home", "Editor→Home library container"); intermediate(row, trace, "editor", "Editor unloading container");
        const final = trace.frames.at(-1);
        check(row, "Return leaves one visible Home surface without stale Editor input", Boolean(final.home) && final.home.opacity >= .99
          && (!final.editor || final.editor.inert || final.editor.ariaHidden === "true"), final);
      });
      await shot(`${current.key}-home-final`);
      current.status = current.episodes.length === 16 && current.episodes.every(e => e.status === "PASS") && current.nodeWidthCheck.status === "PASS" ? "PASS" : "FAILED";
    } catch (e) {
      current.status = "FAILED"; current.error = String(e.stack || e); await shot(`${current.key}-action-abort`).catch(() => {});
      await page.evaluate(() => window.__qaInstalledEditorMotion?.stop?.()).catch(() => {});
    }
    save(); console.log(`COMBINATION ${current.key}: ${current.status}`);
  }
  assert.equal(report.matrix.length, prep.smoke ? 2 : 12); assert.equal(report.modelSubmissions.length, 0);
  report.status = report.matrix.every(m => m.status === "PASS") && report.errors.length === 0 ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await page?.evaluate(() => window.__qaInstalledEditorMotion?.stop?.()).catch(() => {});
  await browser?.close().catch(() => {}); report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, matrix: report.matrix.length,
    failedEpisodes: report.matrix.flatMap(m => m.episodes.filter(e => e.status === "FAILED").map(e => `${m.key}/${e.name}`)),
    error: report.error, destination }, null, 2));
});
