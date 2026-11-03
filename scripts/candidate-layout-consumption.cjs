"use strict";
// Bind the existing all-page author workflow to an actual installed candidate.
// Supplement diagrams with the ordinary node-preview UI, never injected state.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const base = "F:/AgentVN/QA/Editor-1.9.31-20261027-01";
const actual = base + "/install-01/actual-installation.json";
const receiptHash = "6542b8f8d1a212d880ed532bec96d6ca422c966f4ff29844c462d55e6a03a465";

function materialAssertion(probe, style, id) {
  assert(probe.present, "No actual Runtime renderer for authored " + id);
  assert.equal(probe.count, 1, "Expected one interactive renderer");
  const rgba = probe.background.match(/^rgba?\(([^)]+)\)$/);
  assert(rgba, probe.background);
  const channels = rgba[1].split(",").map(Number);
  if (channels.length === 3) channels.push(1);
  const expected = style.backgroundColor.slice(1).match(/../g).map(n => parseInt(n, 16));
  assert.deepEqual(channels.slice(0, 3), expected, id + " saved background is not consumed");
  const separated = id !== "player" && id !== "game_menu"
    && (style.backgroundOpacity !== undefined || style.contentOpacity !== undefined);
  const alpha = style.backgroundOpacity ?? style.opacity ?? .78;
  assert(Math.abs(channels[3] - (separated ? 1 : alpha)) <= .001,
    id + " background alpha mismatch");
  assert(Math.abs(Number(probe.opacity) - (separated ? alpha : style.opacity ?? 1)) <= .001,
    id + " material opacity mismatch");
  assert(probe.visible && probe.rect.width > 0 && probe.rect.height > 0);
  assert(probe.rect.left >= -1 && probe.rect.top >= -1
    && probe.rect.right <= probe.viewport.width + 1 && probe.rect.bottom <= probe.viewport.height + 1,
  id + " rendered control is clipped");
  assert(probe.overflow <= 1 && !probe.focusUnavailable);
}

async function consumptionProbe(frame, t, entry) {
  const selectors = {
    title: ".main-menu-title-hero-background",
    player: ".dialog-box",
    game_menu: ".renpy-menu-navigation",
    save_load: ".save-grid.ui-layouted",
    preferences: ".settings-renpy.ui-layouted",
    history: ".history-list.ui-layouted",
    gallery: ".gallery-grid.ui-layouted",
    about: ".about-card.ui-layouted",
    help: ".help-card.ui-layouted",
  };
  const probe = await frame.evaluate(({ selector }) => {
    // Decorative material layers are aria-hidden by design; only retired
    // presentation snapshots are excluded from the active renderer probe.
    const nodes = [...document.querySelectorAll(selector)].filter(n => !n.closest("[inert]"));
    const n = nodes[0], layer = n?.querySelector(':scope > [data-ui-opacity-layer="background"]') ?? n;
    const style = layer && getComputedStyle(layer), r = n?.getBoundingClientRect();
    return {
      present: Boolean(n), count: nodes.length, rect: r?.toJSON(),
      background: style?.backgroundColor, opacity: style?.opacity,
      visible: Boolean(style && style.display !== "none" && style.visibility !== "hidden"),
      layoutType: document.querySelector("[data-layout-type]")?.getAttribute("data-layout-type"),
      screen: document.querySelector("[data-runtime-screen-transition]")?.getAttribute("data-runtime-presented-screen"),
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      overflow: document.documentElement.scrollWidth - innerWidth,
      focusUnavailable: Boolean(document.activeElement?.closest("[inert],[aria-hidden=true]")),
      navigation: [...document.querySelectorAll("nav")].map(n => ({ className: n.className, text: n.textContent })),
    };
  }, { selector: selectors[entry[0]] });
  const row = report.pages.at(-1);
  row.consumptionProbe = probe; save();
  assert.equal(probe.layoutType, t, "Runtime must consume the active authored profile");
  materialAssertion(probe, row.author.persisted.style, entry[0]);
  return probe;
}

async function nodePreview(t, entry) {
  const screens = { title: "标题", player: "播放", game_menu: "设置", preferences: "设置",
    save_load: "存读档", history: "历史", gallery: "画廊", about: "关于" };
  const expectedScreens = { title: "title_menu", player: "playing", game_menu: "settings",
    preferences: "settings", save_load: "save_load", history: "history", gallery: "gallery", about: "about" };
  await click(page.locator('[data-workspace-surface="edit"]:visible'));
  await settleEditor(page);
  const opener = page.locator('[data-help-key="preview.openPanel"]:visible');
  if (await opener.count()) await click(opener);
  await page.locator(".embedded-runtime-preview-status.is-ready").waitFor({ timeout: 45000 });
  const button = page.locator('button[data-help-key="preview.screen"]:visible').getByText(screens[entry[0]], { exact: true });
  await click(button);
  await page.locator(".embedded-runtime-preview-status.is-ready").waitFor({ timeout: 45000 });
  const frame = await (await page.locator('iframe[title="GameCLI 内嵌预览"]').elementHandle()).contentFrame();
  assert(frame);
  await frame.waitForFunction(type =>
    document.querySelector("[data-layout-type]")?.getAttribute("data-layout-type") === type, t);
  await frame.waitForFunction(screen => document.querySelector("[data-runtime-screen-transition]")
    ?.getAttribute("data-runtime-presented-screen") === screen, expectedScreens[entry[0]]);
  await settleRuntime(frame);
  let probe;
  try { probe = await consumptionProbe(frame, t, entry); }
  catch (error) {
    await host.shot(`${t}-${entry[0]}-runtime-consumption-failed-${report.pages.length}`);
    throw error;
  } finally {
    await open(t); await go(t, entry);
  }
  return { kind: "ACTUAL_INSTALLED_NODE_RUNTIME_IFRAME", runtime: probe,
    geometry: await geometry(), savedStyleConsumed: true };
}

async function checkedPreview(t, entry) {
  try {
    if (isSpecial(entry)) return await previewSpecial(t, entry);
    if (t === "agentvn" && entry[0] !== "player" || entry[0] === "game_menu")
      return await nodePreview(t, entry);
    const result = await layoutPreview(t, entry);
    const viewport = page.locator('.advanced-tab-content.is-active .renpy-editor-runtime-viewport[data-preview-phase="ready"]');
    const frame = await (await viewport.locator("iframe").elementHandle()).contentFrame();
    result.runtime = await consumptionProbe(frame, t, entry);
    result.savedStyleConsumed = true; return result;
  } catch (error) {
    const row = report.pages.at(-1);
    row.consumptionFailure = String(error.stack || error); save();
    return { kind: "FAILED_RUNTIME_CONSUMPTION", error: row.consumptionFailure };
  }
}

async function navigationSource(page, editorPage) {
  // An open <details> can still have content-visibility:hidden in the first
  // presentation frame. Poll actual rendered content, not textContent alone,
  // and bind the observation to the current page rather than a stale element.
  const ready = await page.waitForFunction(expected => {
    const owner = document.querySelector('.advanced-tab-content.is-active '
      + `.renpy-title-editor[data-editor-page="${expected}"] .renpy-page-navigation-fields`);
    const output = owner?.querySelector('[data-testid="renpy-font-source"]');
    const content = owner && getComputedStyle(owner, "::details-content");
    const source = output?.innerText.trim(), rect = output?.getBoundingClientRect();
    if (!owner?.open || owner.closest("[inert]") || !["继承", "覆盖"].includes(source)
      || content.contentVisibility === "hidden" || Number(content.opacity) <= 0
      || !rect?.width || !rect.height) return false;
    return { source, open: true, contentVisibility: content.contentVisibility,
      contentOpacity: content.opacity, editorPage: expected };
  }, editorPage, { timeout: 10000, polling: "raf" });
  try { return await ready.jsonValue(); } finally { await ready.dispose(); }
}

async function probeDisclosure() {
  const display = { width: 3840, height: 2160, dpr: 1, reduced: false };
  await host.metrics(display); await open("renpy"); await go("renpy", menus[0]);
  await click(page.getByTestId("renpy-page-region-editor").locator('[data-component-id="title_hero"]'));
  await page.getByLabel("当前控件背景颜色", { exact: true }).fill("#264759");
  report.scope = "INSTALLED_DISCLOSURE_DIAGNOSTIC_NOT_AUTHOR_ACCEPTANCE";
  report.disclosure = [];
  for (let i = 0; i < 6; i++) {
    const navigation = page.locator(".renpy-page-navigation-fields");
    if (await navigation.getAttribute("open") !== null) await click(navigation.locator("summary"));
    await navigation.evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {})));
    });
    // Sample the real summary activation before another automation round trip,
    // and every rendered frame. A WeakMap distinguishes actual DOM replacement.
    await navigation.evaluate(element => {
      const ids = new WeakMap(); let nextId = 0;
      const identify = node => {
        if (node && !ids.has(node)) ids.set(node, ++nextId);
        return node ? ids.get(node) : null;
      };
      const sample = () => {
        const owner = document.querySelector(".renpy-page-navigation-fields");
        const output = owner?.querySelector('[data-testid="renpy-font-source"]');
        const style = owner && getComputedStyle(owner, "::details-content");
        return { at: performance.now(), owner: identify(owner), sameOwner: owner === element,
          connected: element.isConnected, open: owner?.hasAttribute("open"),
          text: output?.textContent.trim(), innerText: output?.innerText.trim(),
          visibility: style?.contentVisibility, opacity: style?.opacity, blockSize: style?.blockSize,
          buttons: [...(owner?.querySelectorAll("button") ?? [])].map(n => n.textContent),
          animations: owner?.getAnimations({ subtree: true }).map(a => ({
            property: a.transitionProperty, state: a.playState, time: a.currentTime,
            pseudo: a.effect?.pseudoElement, progress: a.effect?.getComputedTiming().progress })),
        };
      };
      window.__qaDisclosureSamples = [];
      window.__qaDisclosureSampling = new Promise(resolve => {
        element.querySelector("summary").addEventListener("click", () => {
          queueMicrotask(() => {
            const frames = window.__qaDisclosureSamples;
            const tick = () => {
              frames.push(sample());
              if (!frames.at(-1).animations?.some(a => a.state === "running" || a.state === "pending")
                && frames.length > 2) resolve(frames);
              else requestAnimationFrame(tick);
            };
            tick();
          });
        }, { once: true });
      });
    });
    await click(navigation.locator("summary"));
    const immediate = await navigation.getByTestId("renpy-font-source").innerText();
    const ready = await navigationSource(page, "title");
    const samples = await page.evaluate(() => window.__qaDisclosureSampling);
    const row = { iteration: i, display, immediate, ready, samples };
    report.disclosure.push(row); save();
    assert(samples.every(s => s.sameOwner && s.connected));
    const firstOpen = samples.findIndex(s => s.open);
    assert(firstOpen >= 0 && samples.slice(firstOpen).every(s => s.open));
    assert(samples.every(s => ["继承", "覆盖"].includes(s.text)));
    assert(["继承", "覆盖"].includes(samples.at(-1).innerText));
    assert(["继承", "覆盖"].includes(ready.source));
  }
  await host.shot("disclosure-4k-settled");
  report.status = "DIAGNOSTIC_COMPLETE";
}

function validateCandidateConfig(value) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.match(value.version || "", /^\d+\.\d+\.\d+$/);
  assert.equal(value.agentvnNavigation, "existing", "New candidates keep the existing AgentVN pages");
  const qa = path.resolve(value.qa || "");
  assert.equal(path.dirname(qa), path.resolve("F:/AgentVN/QA"));
  assert.match(path.basename(qa), new RegExp(`^Editor-${value.version.replaceAll(".", "\\.")}-\\d{8}-01$`));
  assert(value.actual && /^[a-f0-9]{64}$/.test(value.actual.sha256 || ""));
  assert.equal(path.resolve(value.actual.path), path.join(qa, "install-01/actual-installation.json"));
  return { ...value, qa };
}

function build(original, receipt, options = {}) {
  const version = options.version ?? "1.9.31";
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert(options.agentvnNavigation === undefined || options.agentvnNavigation === "existing");
  const result = require("./candidate-1930-layout-author.cjs").build(original);
  let source = result.source;
  const adaptations = [...result.adaptations];
  function one(before, after, reason) {
    assert.equal(source.split(before).length - 1, 1, reason);
    source = source.replace(before, () => after); adaptations.push({ before, after, reason });
  }
  one('let installationFile = "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json";',
    `let installationFile = ${JSON.stringify(receipt)};`, `Authentic frozen ${version} NSIS receipt`);
  one('candidateVersion: "1.9.30", scope: "INSTALLED_1930_ALL_PAGE_AUTHOR_WITH_CONFIRMATION_NVL_BUBBLE_NOT_EXPORT_OR_ANDROID",',
    `candidateVersion: "${version}", scope: "INSTALLED_AUTHOR_AND_ACTUAL_RUNTIME_MATERIAL_CONSUMPTION_NOT_EXPORT_OR_ANDROID",`,
    "Never relabel historical 1.9.30 evidence");
  one("async function preview(t, entry) {", "async function layoutPreview(t, entry) {",
    "Preserve existing Runtime preview controls and extend their material assertions");
  one("function component(profiles, t, e) {",
    [materialAssertion, consumptionProbe, nodePreview, checkedPreview].map(f => f.toString()).join("\n")
      + "\nfunction component(profiles, t, e) {", "Actual node preview supplements diagrams using ordinary UI");
  one("row.preview = await preview(t, entry);", "row.preview = await checkedPreview(t, entry);",
    "Collect independent page consumption failures without aborting other pages");
  one('row.status = "PASS"; save();', 'row.status = row.consumptionFailure ? "FAILED" : "PASS"; save();',
    "An authored value without its renderer never passes");
  one('assert(report.pages.every(r => r.status === "PASS"));',
    'assert(report.pages.every(r => r.status === "PASS"), "Actual Runtime consumption failed; see page evidence");',
    "Reject partial author-only success after preserving restart evidence");
  one('save();\n  }\n  const before = await projectSnapshot',
    'save();\n    if (report.pages.some(r => r.consumptionFailure)) break;\n  }\n  const before = await projectSnapshot',
    "First failing display retains all independent page probes; do not repeat known failures across 12 displays");
  one("function component(profiles, t, e) {", navigationSource.toString()
    + "\nfunction component(profiles, t, e) {", "Wait for rendered inheritance source in the current installed page");
  one('const overrideCount = await override.count();',
    'const navigationReady = await navigationSource(page, entry[0]);\n'
    + '    const overrideCount = await override.count();',
    "An open disclosure is not yet a rendered content owner; poll actual source before deciding which action exists");
  one('overrideCount, overrideVisible: await override.isVisible(), source: await page.getByTestId("renpy-font-source").innerText()',
    'overrideCount, overrideVisible: await override.isVisible(), source: navigationReady.source, readiness: navigationReady',
    "Preserve source and presentation readiness evidence instead of an immediate transient innerText read");
  if (options.agentvnNavigation === "existing") {
    one('t === "agentvn" ? standard : [...menus, standard[1], standard[2]]',
      't === "agentvn" ? standard.filter(entry => entry[0] !== "game_menu") : [...menus, standard[1], standard[2]]',
      "User confirmed existing AgentVN pages; retain the actual Ren’Py shared navigation");
    one('(type === "agentvn" ? 11 : 12)', '(type === "agentvn" ? 10 : 12)',
      "Require22 real authored pages per display, including confirmation/NVL/bubble");
    one('await open(t);\n    for (const [i, entry]',
      `await open(t);
    if (t === "agentvn") {
      assert.equal(await page.locator(".runtime-layout-screen-list").getByRole("button",
        { name: "游戏菜单", exact: true }).count(), 0, "No phantom default navigation editor");
      const legacy = (await projectSnapshot(host.current.ports[0])).settings.runtimeUILayoutProfiles.profiles.agentvn
        .screens.find(screen => screen.screen_id === "game_menu");
      assert(legacy?.components.some(component => component.component_type === "game_menu_nav"),
        "Compatibility data must remain even though its editor entry is retired");
      (report.retainedDefaultMenu ??= []).push({ display, legacy });
    }
    for (const [i, entry]`,
      "Assert retired entry and retained data separately on every actual installed display");
    one('report.profiles = before.settings.runtimeUILayoutProfiles;',
      `report.profiles = before.settings.runtimeUILayoutProfiles;
  assert.deepEqual(report.profiles.profiles.agentvn.screens.find(screen => screen.screen_id === "game_menu"),
    report.retainedDefaultMenu[0].legacy, "All-page authoring must preserve the retired default menu data");`,
      "Compare legacy data before all edits and after the full author chain, not only after restart");
  }
  if (options.disclosureProbe) {
    one("function component(profiles, t, e) {", probeDisclosure.toString()
      + "\nfunction component(profiles, t, e) {", "Inspect actual installed animated disclosure without author matrix");
    one("  for (const display of displayMatrix) {",
      '  await step("Actual installed4K disclosure readiness diagnostic", probeDisclosure); return;\n'
      + "  for (const display of displayMatrix) {", "Run only the precise failure seam; preserve finally restoration");
  }
  return { source, adaptations };
}

if (require.main === module) {
  assert(["self-test", "author"].includes(process.argv[2]));
  const configArgs = process.argv.filter(arg => arg.startsWith("--candidate-config="));
  assert(configArgs.length <= 1);
  const config = configArgs.length
    ? validateCandidateConfig(JSON.parse(fs.readFileSync(configArgs[0].slice("--candidate-config=".length), "utf8")))
    : null;
  const version = config?.version ?? "1.9.31", qa = config?.qa ?? base;
  const options = { ...(config ? { version, agentvnNavigation: config.agentvnNavigation } : {}),
    ...(process.argv.includes("--disclosure-probe") ? { disclosureProbe: true } : {}) };
  const descriptor = deriveActual(config?.actual ?? { path: actual, sha256: receiptHash }, version);
  if (process.argv[2] === "self-test") {
    const result = build(fs.readFileSync(path.join(__dirname, "installed-layout-pages-current.cjs"), "utf8"),
      qa + "/self-test-receipt-not-executed.json", options);
    new vm.Script(Module.wrap(result.source));
    const valid = { present: true, count: 1, background: "rgba(38, 55, 70, 0.78)", opacity: "1",
      visible: true, rect: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
      viewport: { width: 1920, height: 1080 }, overflow: 0, focusUnavailable: false };
    const style = { backgroundColor: "#263746" };
    materialAssertion(valid, style, "about");
    for (const patch of [{ present: false }, { count: 2 }, { background: "rgb(1, 2, 3)" },
      { opacity: "0" }, { visible: false }, { overflow: 50 }, { focusUnavailable: true },
      { rect: { ...valid.rect, right: 2000 } }])
      assert.throws(() => materialAssertion({ ...valid, ...patch }, style, "about"));
    console.log(JSON.stringify({ status: "PASS", actualVersion: descriptor.version,
      checkedAdaptations: result.adaptations.length, rejectedMaterialEvidence: 8 }));
  } else {
    assert.match(process.argv[3] || "", /^\d{2}$/);
    assert(process.argv.includes("--codex-cache-view"));
    assert(!process.argv.some(a => a.startsWith("--audit=")));
    const prep = path.join(qa, "layout-consumption-preparation-" + process.argv[3]);
    fs.mkdirSync(prep, { recursive: false });
    const receipt = path.join(prep, "derived-actual-installation.json");
    fs.writeFileSync(receipt, JSON.stringify(descriptor, null, 2), { flag: "wx" });
    const file = path.join(__dirname, "installed-layout-pages-current.cjs");
    const result = build(fs.readFileSync(file, "utf8"), receipt, options);
    new vm.Script(Module.wrap(result.source));
    const executed = path.join(prep, "executed-layout-pages.cjs");
    fs.writeFileSync(executed, result.source, { flag: "wx" });
    fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify({
      version, options, source: { path: file, sha256: sha(file) },
      executed: { path: executed, sha256: sha(executed) },
      adapter: { path: __filename, sha256: sha(__filename) },
      adaptations: result.adaptations, productChanges: 0, modelRequests: 0,
    }, null, 2), { flag: "wx" });
    const worker = new Module(file, module); worker.filename = file;
    worker.paths = Module._nodeModulePaths(path.dirname(file)); worker._compile(result.source, file);
  }
}
module.exports = { build, materialAssertion, validateCandidateConfig };
