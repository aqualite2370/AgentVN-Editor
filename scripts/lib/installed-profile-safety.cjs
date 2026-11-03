"use strict";
// Installed Release controls only. No frontend store/modules, source Vite or
// successful persistence mocks. The one HTTP500 is recorded as fault injection.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("../../editor/node_modules/jszip");
const A = require("./installed-acceptance.cjs");
const { desktopViewports } = require("./current-acceptance-viewports.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./installed-webview-capture.cjs");

const profileSet = value => value.settings.runtimeUILayoutProfiles;
const speakerX = profile => profile.screens.find(s => s.screen_id === "player")
  .components.find(c => c.component_id === "speaker_label").rect.x;

async function runProfileSafety(C) {
  const { out, report, stage, snapshot, layout, options, saveLayout, native } = C;
  const page = () => C.context().page;
  const confirmation = () => page().getByRole("dialog", { name: "切换布局类型？", exact: true });
  const typeButton = type => layout().locator(`[data-layout-type-option="${type}"]`);
  const waitType = async type => {
    await page().waitForFunction(type => {
      const node = document.querySelector(".advanced-tab-content.is-active .runtime-layout-designer");
      return node?.dataset.layoutType === type && node.getAttribute("aria-busy") === "false"
        && !node.inert && node.querySelector('[data-layout-type-option="' + type + '"]')
          ?.getAttribute("aria-pressed") === "true";
    }, type);
    await A.settleEditor(page());
  };
  const xInput = () => layout().locator(".runtime-layout-inspector details")
    .filter({ has: page().locator("summary", { hasText: /^位置与尺寸$/ }) })
    .locator("label").filter({ hasText: /^x/ }).locator('input[type="number"]');
  const speaker = async () => {
    await layout().locator('.runtime-layout-component-list button[data-component-id="speaker_label"]').click();
  };
  const sidebar = () => layout().locator(".renpy-title-editor .runtime-layout-sidebar");
  async function navigationFont() {
    const fields = sidebar().locator("details")
      .filter({ has: page().locator("summary", { hasText: /^共享导航排列$/ }) });
    if (!await fields.evaluate(node => node.open)) await fields.locator("summary").click();
    return fields.getByRole("spinbutton", { name: "共享导航字号", exact: true });
  }
  let original, savedAgent, savedRenpy, portableProfiles;

  // Start before the real click, and retain actual geometry on every frame.
  async function switchAndTrace(type, keyboard = false) {
    await page().evaluate(type => {
      const started = performance.now();
      window.__installedProfileTrace = { type, frames: [], done: false };
      let stable = 0, last;
      function sample() {
        const trace = window.__installedProfileTrace;
        const root = document.querySelector(".advanced-tab-content.is-active .runtime-layout-designer");
        const selectors = [".runtime-layout-header", ".runtime-layout-type-switch", '[data-help-key="layout.save"]'];
        const headers = Object.fromEntries(selectors.map(selector => {
          const node = root?.querySelector(selector);
          return [selector, node?.getBoundingClientRect().toJSON() ?? null];
        }));
        const group = root?.querySelector(".runtime-layout-type-switch");
        const buttons = [...group?.querySelectorAll("button") ?? []].map(button => ({
          label: button.textContent.trim(), pressed: button.getAttribute("aria-pressed"),
          rect: button.getBoundingClientRect().toJSON(),
          color: getComputedStyle(button).color,
        }));
        const animations = document.getAnimations().filter(a => {
          const node = a.effect?.target;
          return node instanceof Element && root?.contains(node)
            && a.effect.getComputedTiming().iterations !== Infinity
            && ["running", "pending"].includes(a.playState);
        }).length;
        const frame = { elapsedMs: performance.now() - started, type: root?.dataset.layoutType,
          screen: root?.dataset.activeScreen, busy: root?.getAttribute("aria-busy"),
          root: root?.getBoundingClientRect().toJSON(), headers, buttons, animations,
          overflow: document.documentElement.scrollWidth - innerWidth };
        trace.frames.push(frame);
        const current = JSON.stringify({ headers, buttons, type: frame.type, screen: frame.screen });
        stable = frame.type === type && frame.busy === "false" && !animations && current === last ? stable + 1 : 0;
        last = current;
        if (stable >= 3) trace.done = true;
        else if (performance.now() - started > 15000) {
          trace.error = "Actual installed profile switch did not settle"; trace.done = true;
        } else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }, type);
    if (keyboard) {
      await typeButton(type).focus();
      await typeButton(type).press("Enter");
    } else await typeButton(type).click();
    await page().waitForFunction(() => window.__installedProfileTrace?.done);
    const trace = await page().evaluate(() => window.__installedProfileTrace);
    assert(!trace.error, trace.error);
    assert(trace.frames.length >= 3, "No empty/zero-frame PASS");
    const first = trace.frames[0], last = trace.frames.at(-1);
    for (const frame of trace.frames) {
      assert(frame.root?.width > 0 && frame.overflow <= 1, `Blank/overflow frame: ${JSON.stringify(frame)}`);
      for (const key of Object.keys(first.headers)) for (const axis of ["x", "y", "width", "height"])
        assert(Math.abs(frame.headers[key][axis] - first.headers[key][axis]) <= 1,
          `Header moved during type switch ${key}/${axis}: ${JSON.stringify(frame)}`);
      assert.equal(frame.buttons.length, 2);
      for (let i = 0; i < 2; i++) for (const axis of ["x", "y", "width", "height"])
        assert(Math.abs(frame.buttons[i].rect[axis] - first.buttons[i].rect[axis]) <= 1,
          "Active style changed type-button geometry");
    }
    assert.notEqual(last.buttons[0].color, last.buttons[1].color, "Active/inactive text contrast missing");
    await waitType(type);
    return trace;
  }

  async function geometry() {
    const result = await page().evaluate(() => {
      const root = document.querySelector(".advanced-tab-content.is-active .runtime-layout-designer");
      const nodes = [".runtime-layout-sidebar", ".runtime-layout-center", ".runtime-layout-inspector"]
        .map(selector => {
          const node = root.querySelector(selector), rect = node.getBoundingClientRect();
          return { selector, rect: rect.toJSON(), overflow: node.scrollWidth - node.clientWidth };
        });
      const controls = [...root.querySelectorAll(".runtime-layout-type-switch button,[data-help-key='layout.save']")]
        .map(node => { const r = node.getBoundingClientRect(); return {
          label: node.textContent.trim(), rect: r.toJSON(), clipped: node.scrollWidth > node.clientWidth + 1,
          hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        }; });
      return { nodes, controls, width: innerWidth, height: innerHeight,
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(result.overflow <= 1);
    for (const value of result.nodes) {
      const r = value.rect;
      assert(r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1
        && r.right <= result.width + 1 && r.bottom <= result.height + 1 && value.overflow <= 2,
      `Installed workbench bounds: ${JSON.stringify(result)}`);
    }
    for (let i = 0; i < result.nodes.length; i++) for (let j = i + 1; j < result.nodes.length; j++) {
      const a = result.nodes[i].rect, b = result.nodes[j].rect;
      assert(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1
        || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1, "Workbench panes overlap");
    }
    assert(result.controls.every(c => c.hit && !c.clipped), `Control clipped/covered: ${JSON.stringify(result.controls)}`);
    return result;
  }

  await stage("installed-profile-draft-retention-and-cancel", async () => {
    await options();
    await saveLayout();
    original = structuredClone(profileSet(await snapshot()));
    assert.equal(original.activeType, "agentvn");
    await speaker();
    await xInput().fill("13");
    await page().locator('[data-help-key="advanced.tab.theme"]:visible').click();
    await A.settleEditor(page());
    const inactive = await page().evaluate(() => {
      const node = document.querySelector(".advanced-tab-content[data-tab='layout']");
      return { retained: Boolean(node), inert: node?.inert ?? true,
        focusInside: Boolean(node?.contains(document.activeElement)) };
    });
    assert(inactive.inert && !inactive.focusInside);
    await page().locator('[data-help-key="advanced.tab.layout"]:visible').click();
    await A.settleEditor(page()); await speaker();
    assert.equal(await xInput().inputValue(), "13", "Tool navigation lost dirty draft");
    await typeButton("renpy").click(); await confirmation().waitFor();
    assert.equal(await typeButton("agentvn").getAttribute("aria-pressed"), "true");
    assert.equal(await typeButton("renpy").getAttribute("aria-pressed"), "false");
    await confirmation().getByRole("button", { name: "取消", exact: true }).click();
    await confirmation().waitFor({ state: "hidden" });
    assert.equal(await xInput().inputValue(), "13");
    assert.deepEqual(profileSet(await snapshot()), original, "Cancel persisted a dirty draft");
    return { inactive, dirtyX: 13, backendUnchanged: true };
  });

  await stage("installed-profile-save-failure-blocks-switch-and-real-retry-persists", async () => {
    const failures = [];
    const routeFailure = async route => {
      const request = route.request();
      if (request.method() === "POST" &&
        request.postDataJSON()?.project_metadata?.settings?.runtimeUILayoutProfiles?.activeType === "renpy") {
        failures.push({ method: "POST", url: request.url(), status: 500, injected: true });
        await route.fulfill({ status: 500, contentType: "application/json",
          body: JSON.stringify({ detail: "验收受控布局保存失败；不模拟成功持久化" }) });
      } else await route.continue();
    };
    await page().route("**/api/project/state", routeFailure);
    try {
      await typeButton("renpy").click(); await confirmation().waitFor();
      await confirmation().getByRole("button", { name: "保存并切换", exact: true }).click();
      await page().locator(".operation-result-dialog.is-error").waitFor();
      assert.equal(failures.length, 1, "One explicit controlled save failure required");
      assert.equal(await layout().getAttribute("data-layout-type"), "agentvn");
      assert.equal(await xInput().inputValue(), "13");
      assert.deepEqual(profileSet(await snapshot()), original, "Failed save changed installed backend");
      report.saveFailureCapture = await captureInstalledWebview(page(), C.context().cdp,
        path.join(out, "save-failure-retained-draft.png"), { width: 1920, height: 1080, dpr: 1, reduced: false });
    } finally { await page().unroute("**/api/project/state", routeFailure); }
    await confirmation().getByRole("button", { name: "保存并切换", exact: true }).click();
    await waitType("renpy"); await confirmation().waitFor({ state: "hidden" });
    const current = profileSet(await snapshot());
    assert.equal(current.activeType, "renpy");
    assert.equal(speakerX(current.profiles.agentvn), 13);
    assert.deepEqual((await snapshot()).settings.runtimeUILayout, current.profiles.renpy);
    savedAgent = structuredClone(current.profiles.agentvn);
    savedRenpy = structuredClone(current.profiles.renpy);
    return { failures, actualRetry: "Real installed backend POST, no fulfilled success", persistedAgentX: 13 };
  });

  await stage("installed-profile-discard-does-not-overwrite-either-saved-layout", async () => {
    await (await navigationFont()).fill("29");
    await sidebar().getByRole("button", { name: "选项", exact: true }).click();
    await page().getByRole("button", { name: "移动预览", exact: true }).click();
    await saveLayout();
    savedRenpy = structuredClone(profileSet(await snapshot()).profiles.renpy);
    await typeButton("agentvn").click(); await waitType("agentvn");
    await layout().locator(".runtime-layout-zoom-switch").getByRole("button", { name: "75%", exact: true }).click();
    await speaker(); await xInput().fill("21");
    await typeButton("renpy").click(); await confirmation().waitFor();
    await confirmation().getByRole("button", { name: "放弃并切换", exact: true }).click();
    await waitType("renpy");
    const current = profileSet(await snapshot());
    assert.deepEqual(current.profiles.agentvn, savedAgent);
    assert.deepEqual(current.profiles.renpy, savedRenpy);
    assert.deepEqual((await snapshot()).settings.runtimeUILayout, savedRenpy);
    assert.equal(await layout().getAttribute("data-renpy-editor"), "preferences");
    assert.equal(await page().getByRole("button", { name: "移动预览", exact: true }).getAttribute("aria-pressed"), "true");
    await typeButton("agentvn").click(); await waitType("agentvn"); await speaker();
    assert.equal(await xInput().inputValue(), "13", "Discarded21 leaked back on return");
    return { discardedX: 21, retainedX: 13, otherProfileUnchanged: true };
  });

  await stage("installed-profile-independent-view-state-and-stable-switch-matrix", async () => {
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await C.metrics(page(), C.context().cdp, width, height, dpr, reduced);
      await A.settleEditor(page());
      const row = { width, height, dpr, reduced };
      row.viewportBefore = await readInstalledViewport(page(), row);
      report.currentMatrix = row;
      // Start and end each combination in AgentVN. The two saved view states
      // were established through real buttons in the previous complete flow.
      row.toRenpy = await switchAndTrace("renpy", reduced);
      assert.equal(await layout().getAttribute("data-renpy-editor"), "preferences");
      assert.equal(await page().getByRole("button", { name: "移动预览", exact: true }).getAttribute("aria-pressed"), "true");
      row.renpyGeometry = await geometry();
      await layout().locator('.renpy-editor-runtime-viewport[data-preview-page="preferences"][data-preview-phase="ready"]').waitFor();
      const frames = page().frames().filter(f => f.parentFrame() && f.url().includes("gamecli-preview"));
      assert.equal(frames.length, 1, "Exactly one actual layout Runtime preview");
      await frames[0].getByTestId("settings-screen").waitFor(); await A.settleRuntime(frames[0]);
      row.capture = await captureInstalledWebview(page(), C.context().cdp,
        path.join(out, `profiles-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`), row);
      row.toAgent = await switchAndTrace("agentvn", !reduced);
      assert.equal(await layout().getAttribute("data-active-screen"), "player");
      assert.equal((await layout().locator(".runtime-layout-zoom-switch [data-glass-selected='true']").innerText()).trim(), "75%");
      row.agentGeometry = await geometry();
      const final = profileSet(await snapshot());
      assert.equal(final.activeType, "agentvn");
      assert.deepEqual(final.profiles.agentvn, savedAgent);
      assert.deepEqual(final.profiles.renpy, savedRenpy);
      assert.deepEqual((await snapshot()).settings.runtimeUILayout, savedAgent);
      row.viewportAfter = await readInstalledViewport(page(), row);
      report.matrix.push(row); C.save();
      console.log(`PASS installed profile safety ${width} DPR${dpr} reduced=${reduced}`);
    }
    assert.equal(report.matrix.length, 12);
    return { combinations: 12, input: "Pointer and keyboard real type controls",
      viewState: "Per-type page/device/zoom restored within editing session, not a claim of restart view preferences" };
  });

  await stage("installed-profile-native-save-keeps-both-layouts-and-excludes-local-preferences", async () => {
    await C.metrics(page(), C.context().cdp, 1920, 1080, 1, false);
    await saveLayout();
    portableProfiles = structuredClone(profileSet(await snapshot()));
    await options("settings");
    const directory = path.join(out, "中文 双布局工程"); fs.mkdirSync(directory);
    await native(page().locator('[data-help-key="settings.projectExportDirectory.choose"]:visible'),
      "profile-save-directory", directory, false);
    await page().waitForFunction(directory =>
      document.querySelector('[data-help-key="settings.projectExportDirectory.current"]')?.textContent.trim() === directory, directory);
    await page().locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page());
    await page().getByRole("button", { name: "保存工程", exact: true }).click();
    const confirm = page().getByTestId("project-save-confirmation"); await confirm.waitFor();
    await confirm.getByRole("button", { name: "OK", exact: true }).click();
    const files = fs.readdirSync(directory).filter(f => f.endsWith(".vnproj")); assert.equal(files.length, 1);
    const file = path.join(directory, files[0]), bytes = fs.readFileSync(file);
    const archive = await JSZip.loadAsync(bytes), data = JSON.parse(await archive.file("project.json").async("string"));
    assert.deepEqual(data.editor_settings.runtimeUILayoutProfiles, portableProfiles);
    assert.deepEqual(data.editor_settings.runtimeUILayout, portableProfiles.profiles.agentvn);
    assert(!JSON.stringify(data).includes(directory), "Local saving directory entered portable project");
    report.projectArtifact = { path: file, sha256: A.sha256(bytes), generatedAt: fs.statSync(file).mtime.toISOString() };
    return { projectArtifact: report.projectArtifact, bothProfilesPreserved: true };
  });

  await stage("installed-profile-normal-native-restart-and-real-file-picker-roundtrip", async () => {
    await C.restart();
    await page().getByRole("button", { name: "导入项目", exact: true }).waitFor();
    await native(page().getByRole("button", { name: "导入项目", exact: true }),
      "profile-reopen", report.projectArtifact.path, true);
    await page().locator(".editor-toolbar").waitFor(); await A.settleEditor(page());
    assert.deepEqual(profileSet(await snapshot()), portableProfiles);
    await options();
    await waitType("agentvn"); await speaker(); assert.equal(await xInput().inputValue(), "13");
    await typeButton("renpy").click(); await waitType("renpy");
    assert.equal(await (await navigationFont()).inputValue(), "29");
    const current = profileSet(await snapshot());
    assert.deepEqual(current.profiles.agentvn, savedAgent);
    assert.deepEqual(current.profiles.renpy, savedRenpy);
    assert.equal(A.sha256(fs.readFileSync(report.projectArtifact.path)), report.projectArtifact.sha256);
    return { restart: "Normal native window close, new editor/backend processes, actual native file chooser",
      portableProfileByteIntegrity: true };
  });
}

module.exports = { runProfileSafety };
