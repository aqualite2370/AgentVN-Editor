"use strict";
// Runtime source regression. Unchanged installed-authored cartridge imported
// through the real web file input, not a store mutation or native-picker claim.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const root = path.resolve(__dirname, "..");
const checkpoint = "F:/AgentVN/Checkpoints/Role-Geometry-Source-20261020-02";
const qa = "F:/AgentVN/QA/Role-Geometry-Source-20261020-02";
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const files = [
  "shared/cartridge/renpyGui.ts", "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
  "GameCli_framework/src/styles/renpy-button-roles.css", "GameCli_framework/src/styles/shell.css",
  "GameCli_framework/src/components/shell/renpy-menu.css",
  "GameCli_framework/src/components/common/Modal.tsx",
  "editor/src/components/advanced/RenpyButtonRoleEditor.tsx",
  "scripts/renpy-button-role-model-test.cjs", "scripts/installed-authored-role-states.cjs",
  "scripts/installed-authored-role-overflow.cjs", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "output/installed-layout-author-review-20261019-01/ROLE_STATES_REPORT.md",
];
const exported = JSON.parse(fs.readFileSync(path.join(root,
  "output/installed-layout-author-review-20261019-01/export-01/report.json"), "utf8"));
if (process.argv.includes("--prepare")) {
  assert(!fs.existsSync(checkpoint) && !fs.existsSync(qa), "Never overwrite an existing checkpoint");
  files.forEach(file => assert(fs.existsSync(path.join(root, file)), `Missing checkpoint input: ${file}`));
  fs.mkdirSync(checkpoint, { recursive: true }); fs.mkdirSync(qa, { recursive: true });
  const entries = files.map(file => {
    const src = path.join(root, file), dest = path.join(checkpoint, "files", file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    return { file, sha256: sha(src) };
  });
  const dev = path.join(root, "AgentVN Dev.exe");
  fs.copyFileSync(dev, path.join(checkpoint, "AgentVN Dev.exe"), fs.constants.COPYFILE_EXCL);
  assert.equal(sha(exported.cartridge.path), exported.cartridge.sha256);
  const cartridge = path.join(qa, "authored-original.vncart");
  fs.copyFileSync(exported.cartridge.path, cartridge, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify({
    at: new Date().toISOString(), entries, devSha256: sha(dev),
    cartridge: { original: exported.cartridge.path, path: cartridge, sha256: sha(cartridge) },
    scope: "Targeted pre-change recoverable copies, including untracked implementations and actual Dev; historical evidence untouched",
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ checkpoint, qa, entries: entries.length })); process.exit(0);
}
const output = process.env.AGENTVN_WORKSPACE_OUTPUT;
assert(output && path.resolve(output).startsWith(path.resolve(qa) + path.sep) && !fs.existsSync(output));
const cartridge = path.join(qa, "authored-original.vncart");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), path.resolve(cartridge));
assert.equal(sha(cartridge), exported.cartridge.sha256);
const smoke = process.argv.includes("--smoke");
const diagnostic = process.argv.includes("--diagnostic");
const explicit = process.argv.includes("--explicit");
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(__filename, path.join(output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const report = { status: "RUNNING", at: new Date().toISOString(),
  scope: "SOURCE_RUNTIME_REAL_FILE_INPUT_LIBRARY_MENU_ACTIONS_NOT_NATIVE_INSTALLED_OR_ANDROID",
  cartridge: { path: cartridge, sha256: sha(cartridge) }, cases: [], modelRequests: 0,
  testSha256: sha(__filename), sources: files.filter(f => !f.startsWith("output/") && !f.startsWith("plans/"))
    .map(file => ({ file, sha256: sha(path.join(root, file)) })) };
const write = () => fs.writeFileSync(path.join(output, "progress.json"), JSON.stringify(report, null, 2));
let server, browser;
async function ready(page, screen) {
  await page.waitForFunction(screen => {
    const n = document.querySelector("[data-runtime-screen-transition]");
    return n?.dataset.runtimePresentedScreen === screen && n.dataset.runtimeTransitionPhase === "idle"
      && !document.querySelector(".game-launch-blackout");
  }, screen);
  await settleRuntime(page);
}
async function probe(locator) {
  return locator.evaluate(n => {
    const r = n.getBoundingClientRect(), c = getComputedStyle(n), textRects = [], ancestors = [];
    const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      textRects.push(...[...range.getClientRects()].map(r => r.toJSON()));
    }
    for (let a = n; a; a = a.parentElement) {
      const css = getComputedStyle(a);
      if (a === n || css.overflowX !== "visible" || css.overflowY !== "visible" || css.clipPath !== "none")
        ancestors.push({ tag: a.tagName, className: a.className, rect: a.getBoundingClientRect().toJSON(),
          overflowX: css.overflowX, overflowY: css.overflowY, clipPath: css.clipPath });
    }
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d"); ctx.font = c.font;
    const ink = ctx.measureText(n.textContent.trim());
    return { label: n.textContent.trim(), rect: r.toJSON(), textRects, ancestors, color: c.color,
      font: c.font, fontSize: c.fontSize, lineHeight: c.lineHeight, padding: c.padding,
      width: innerWidth, height: innerHeight, scrollWidth: n.scrollWidth, clientWidth: n.clientWidth,
      scrollHeight: n.scrollHeight, clientHeight: n.clientHeight, overflowX: c.overflowX, overflowY: c.overflowY,
      hit: n.disabled || n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      focused: document.activeElement === n, focusVisible: n.matches(":focus-visible"), disabled: n.disabled,
      overflow: document.documentElement.scrollWidth - innerWidth, opacity: +c.opacity,
      inkMetricsDiagnosticOnly: { width: ink.width, ascent: ink.actualBoundingBoxAscent, descent: ink.actualBoundingBoxDescent },
      roleVars: Object.fromEntries(["width", "height", "font-size", "padding-x", "padding-y"].map(k =>
        [k, c.getPropertyValue(`--renpy-role-${k}`)])) };
  });
}
function assertGeometry(v) {
  const r = v.rect;
  assert(v.hit && v.scrollWidth <= v.clientWidth + 1 && v.opacity > 0 && v.overflow <= 1
    && r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= v.width + 1 && r.bottom <= v.height + 1,
  JSON.stringify(v));
  assert(!v.textRects.some(t => t.left < r.left - 1 || t.right > r.right + 1 || t.top < r.top - 1 || t.bottom > r.bottom + 1),
    `Text Range outside button: ${JSON.stringify(v)}`);
  for (const a of v.ancestors) {
    const clipsX = /hidden|clip|scroll|auto/.test(a.overflowX), clipsY = /hidden|clip|scroll|auto/.test(a.overflowY);
    assert(!v.textRects.some(t => (clipsX && (t.left < a.rect.left - 1 || t.right > a.rect.right + 1))
      || (clipsY && (t.top < a.rect.top - 1 || t.bottom > a.rect.bottom + 1))), `Text crosses clipping ancestor: ${JSON.stringify(v)}`);
  }
}
function envelope(a, b) {
  for (const k of ["x", "y", "width", "height"])
    assert(Math.abs(a.rect[k] - b.rect[k]) <= .15, `State geometry changed ${k}: ${JSON.stringify([a.rect, b.rect])}`);
}
(async () => {
  const archive = await require("../editor/node_modules/jszip").loadAsync(fs.readFileSync(cartridge));
  let input = cartridge;
  let layout = await archive.file("ui/layout.json").async("string");
  if (explicit) {
    // Controlled protection fixture, not a claim of authorship through Editor.
    const data = JSON.parse(layout);
    for (const role of ["page_navigation", "modal_action"]) {
      const config = data.renpy.shared.buttonRoles[role];
      config.geometry = { ...config.geometry, width: 200, height: 72 };
      config.states.hover.geometry = { width: 220, height: 80 };
    }
    layout = JSON.stringify(data);
    archive.file("ui/layout.json", layout);
    const checksum = JSON.parse(await archive.file("checksum.json").async("string"));
    const entry = checksum.files.find(file => file.path === "ui/layout.json"); assert(entry);
    entry.size_bytes = Buffer.byteLength(layout);
    entry.hash_sha256 = crypto.createHash("sha256").update(layout).digest("hex");
    archive.file("checksum.json", JSON.stringify(checksum, null, 2));
    input = path.join(output, "controlled-explicit-dimensions.vncart");
    fs.writeFileSync(input, await archive.generateAsync({ type: "nodebuffer" }), { flag: "wx" });
    report.controlledVariant = { path: input, sha256: sha(input), changes: "two roles explicit normal and hover dimensions only" };
  }
  report.layoutSha256 = crypto.createHash("sha256").update(layout).digest("hex");
  report.authoredRoles = JSON.parse(layout).renpy.shared.buttonRoles;
  server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(output, "vite.log") });
  report.service = { url: server.url, pid: server.pid, runId: server.runId };
  browser = await chromium.launch();
  const combos = [];
  for (const [width, height] of smoke ? [[1920, 1080], [3840, 2160]] : [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of smoke ? [1] : [1, 2]) for (const reduced of smoke ? [false] : [false, true])
      combos.push({ width, height, dpr, reduced });
  for (const c of combos) {
    const row = { ...c, status: "RUNNING", samples: [], violations: [], pageErrors: [] }; report.cases.push(row);
    const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.dpr,
      reducedMotion: c.reduced ? "reduce" : "no-preference" });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on("pageerror", e => row.pageErrors.push(String(e)));
    const sample = async (locator, role, state, prior) => {
      await settleRuntime(page);
      const v = { role, state, ...await probe(locator) }; row.samples.push(v);
      try {
        assertGeometry(v); if (prior) envelope(prior, v);
        const expectedState = state.includes("focus") ? "hover" : state;
        const color = report.authoredRoles[role].states[expectedState].textColor;
        const expected = `rgb(${[1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)).join(", ")})`;
        assert.equal(v.color, expected, `Authored ${role}/${expectedState} color changed`);
        if (role === "page_navigation" || role === "modal_action") {
          assert(v.scrollHeight <= v.clientHeight + 1, "Content-flow role has vertical overflow");
          if (explicit) assert(Math.abs(v.rect.width / v.rect.height - 220 / 80) < .005,
            "Explicit maximum-state envelope changed");
        }
      }
      catch (e) { row.violations.push({ role, state, error: String(e) }); }
      write(); return v;
    };
    const tabReach = async locator => {
      for (let i = 0; i < 70; i++) {
        if (await locator.evaluate(n => document.activeElement === n)) return i;
        await page.keyboard.press("Tab");
      }
      throw Error("Real Tab navigation failed to reach visible control");
    };
    try {
      await server.run(async () => {
        await page.goto(`${server.url}/?mode=library`);
        await page.getByTestId("web-cartridge-file").setInputFiles(input);
        await page.getByRole("button", { name: "启动卡带", exact: true }).click();
        await ready(page, "title_menu"); await page.mouse.move(0, 0);
        const start = page.getByTestId("start-new-game");
        const title = await sample(start, "title_action", "normal");
        await start.hover(); await sample(start, "title_action", "hover", title);
        await page.getByTestId("open-settings").click(); await ready(page, "settings"); await page.mouse.move(0, 0);
        const tab = page.locator('.settings-tabs button[data-renpy-role-state="normal"]').first();
        const label = (await tab.innerText()).trim();
        const chosen = page.locator(".settings-tabs").getByRole("button", { name: label, exact: true });
        const idle = await sample(chosen, "category_pagination", "normal");
        await chosen.hover(); await sample(chosen, "category_pagination", "hover", idle);
        await chosen.click(); await page.mouse.move(0, 0);
        await sample(chosen, "category_pagination", "selected", idle);
        assert.equal(await chosen.getAttribute("aria-pressed"), "true");
        const nav = page.getByTestId("renpy-menu-help");
        const normal = await sample(nav, "page_navigation", "normal");
        if (diagnostic) {
          row.navigationDiagnostic = await nav.evaluate(n => {
            const original = n.getAttribute("style"), results = {};
            for (const [name, property, value] of [["height-auto", "height", "auto"],
              ["padding-zero", "padding-block", "0px"], ["line-height-one", "line-height", "1"]]) {
              n.style.setProperty(property, value, "important");
              const r = n.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(n);
              results[name] = { rect: r.toJSON(), text: [...range.getClientRects()].map(r => r.toJSON()) };
              if (original === null) n.removeAttribute("style"); else n.setAttribute("style", original);
            }
            return results;
          });
          const restored = await probe(nav); assert.equal(restored.rect.height, normal.rect.height);
        }
        await nav.hover(); await sample(nav, "page_navigation", "hover", normal);
        await page.mouse.move(0, 0); row.tabSteps = await tabReach(nav);
        const focused = await sample(nav, "page_navigation", "keyboard-focus", normal);
        assert(focused.focused && focused.focusVisible);
        await page.keyboard.press("Enter"); await ready(page, "help");
        // This real author fixture intentionally has different page spacing.
        // Compare envelopes within a page, not across two authored layouts.
        const selected = await sample(nav, "page_navigation", "selected-focus");
        assert(selected.focused && selected.focusVisible);
        await page.keyboard.press("Tab"); await sample(nav, "page_navigation", "selected", selected);
        await page.getByTestId("renpy-menu-save-load").click(); await ready(page, "save_load"); await page.mouse.move(0, 0);
        await sample(page.getByTestId("save-page-previous"), "category_pagination", "disabled");
        const next = page.getByTestId("save-page-next");
        const nextIdle = await sample(next, "category_pagination", "normal");
        await next.hover(); await sample(next, "category_pagination", "hover", nextIdle);
        await next.click(); assert(await page.getByTestId("save-page-previous").isEnabled());
        await page.getByTestId("save-page-previous").click(); assert(await page.getByTestId("save-page-previous").isDisabled());
        const auto = page.getByRole("tab", { name: "自动", exact: true }); await auto.click(); await page.mouse.move(0, 0);
        await sample(auto, "category_pagination", "selected"); assert.equal(await auto.getAttribute("aria-selected"), "true");
        await page.getByTestId("renpy-menu-exit").click();
        const modal = page.getByRole("dialog", { name: "退出游戏？", exact: true }); await modal.waitFor(); await settleRuntime(page);
        const exit = modal.getByTestId("confirm-exit-game"), cancel = modal.getByRole("button", { name: "取消", exact: true });
        await page.mouse.move(0, 0); const modalIdle = await sample(exit, "modal_action", "normal");
        assert(await cancel.evaluate(n => document.activeElement === n));
        await exit.hover(); await sample(exit, "modal_action", "hover", modalIdle);
        await page.mouse.move(0, 0); row.modalTabSteps = await tabReach(exit);
        const modalFocus = await sample(exit, "modal_action", "keyboard-focus", modalIdle);
        assert(modalFocus.focused && modalFocus.focusVisible);
        row.modalButtons = await modal.locator("button").evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()));
        const [a, b] = row.modalButtons;
        assert(a && b && (Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1
          || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1), "Modal buttons overlap");
        row.screenshot = await captureSourceBrowser(page, path.join(output, `${c.width}-${c.dpr}-${c.reduced}-modal.png`), c);
        if (diagnostic) {
          // Isolated reversible SINGLE-variable probes. Never included as a
          // product PASS; restore exact original inline style after each.
          row.diagnostic = {};
          for (const [name, property, value] of [["width-auto", "width", "max-content"],
            ["padding-zero", "padding-inline", "0px"], ["font-smaller", "font-size", "27px"]]) {
            row.diagnostic[name] = await exit.evaluate((n, { property, value }) => {
              const original = n.getAttribute("style");
              n.style.setProperty(property, value, "important");
              const r = n.getBoundingClientRect(), result = { width: r.width, height: r.height,
                scrollWidth: n.scrollWidth, clientWidth: n.clientWidth };
              if (original === null) n.removeAttribute("style"); else n.setAttribute("style", original);
              return result;
            }, { property, value });
          }
          row.diagnostic.restored = await probe(exit);
          assert.equal(row.diagnostic.restored.scrollWidth, modalFocus.scrollWidth);
        }
        for (let i = 0; i < 5; i++) {
          await page.keyboard.press("Tab"); assert(await modal.evaluate(n => n.contains(document.activeElement)));
        }
        await page.keyboard.press("Escape"); await modal.waitFor({ state: "hidden" }); await ready(page, "save_load");
        assert(await page.getByTestId("renpy-menu-exit").evaluate(n => document.activeElement === n));
        await page.getByTestId("renpy-menu-return").click(); await ready(page, "title_menu");
        assert.deepEqual(row.pageErrors, []); assert.equal(row.samples.length, 17);
      });
      row.status = row.violations.length ? "FAILED" : "PASS";
    } catch (e) {
      row.status = "FAILED"; row.error = String(e.stack || e);
      row.failureText = await page.locator("body").innerText().catch(() => "");
      row.failureScreenshot = await captureSourceBrowser(page,
        path.join(output, `${c.width}-${c.dpr}-${c.reduced}-failure.png`), c).catch(e => ({ error: String(e) }));
    }
    finally { await context.close(); write(); console.log(JSON.stringify({ ...c, status: row.status,
      samples: row.samples.length, violations: row.violations.length, error: row.error })); }
  }
  assert.equal(report.cases.length, smoke ? 2 : 12);
  assert(report.cases.every(r => r.status === "PASS" && r.samples.length === 17), "Strict role geometry failures; see samples");
  for (const s of report.sources) assert.equal(sha(path.join(root, s.file)), s.sha256, `Source changed during run: ${s.file}`);
  assert.equal(sha(cartridge), exported.cartridge.sha256);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await server?.stop();
  report.cleanup = { status: "PASS", responds: false };
  if (server) try { report.cleanup.responds = (await fetch(server.url, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
  if (report.cleanup.responds) { report.cleanup.status = report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); write();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output }));
});
