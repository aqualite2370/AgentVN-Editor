"use strict";
// Source/Dev acceptance only. Never changes frozen installers or user projects.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Speaker-Container-20261021-01";
const checkpoint = "F:/AgentVN/Checkpoints/Speaker-Container-20261021-01";
const [mode, attempt = "01"] = process.argv.slice(2);
const files = ["shared/cartridge/uiSkin.ts", "shared/cartridge/uiThemePresets.ts",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/RuntimeThemeDesigner.tsx",
  "editor/src/components/advanced/DialogPortraitLayoutEditor.tsx",
  "editor/src/components/common/hoverHelpCatalog.ts"];
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const write = (f, x) => fs.writeFileSync(f, JSON.stringify(x, null, 2), { flag: "wx" });
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
function api() {
  const req = require("node:module").createRequire(path.join(root, "editor/package.json")), m = { exports: {} };
  const source = req("esbuild").buildSync({ stdin: { contents: `
    export * from "./shared/cartridge/uiSkin";
    export * from "./shared/cartridge/uiLayoutProfiles";
    export * from "./shared/cartridge/uiThemePresets";
    export {exportEditorCartridge} from "./editor/src/cartridge/exportCartridge";
  `, resolveDir: root, loader: "ts" }, bundle: true, packages: "external",
  platform: "node", format: "cjs", write: false }).outputFiles[0].text;
  new Function("module", "exports", "require", source)(m, m.exports, req); return m.exports;
}
const speaker = l => l.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "speaker_label");
async function model() {
  const a = api(), layout = a.getDefaultUISkinLayout(), n = speaker(layout);
  assert.equal(n.label, "姓名容器", "Default author-visible label");
  assert.equal(n.style.borderRadius, 6, "A subtle radius, not a pill");
  assert.equal(n.style.backgroundColor, layout.tokens.colorSpeakerPlate);
  assert.equal(n.style.color, layout.tokens.colorSpeakerText);
  assert.equal(n.style.borderColor, "#465164", "Subdued neutral edge instead of an accent edge");
  for (const label of [undefined, "说话人名牌", "人物名牌", "姓名容器"]) {
    const old = { ...n, label, style: { ...n.style, borderRadius: 29, color: "#aabbcc" } };
    const before = structuredClone(old);
    assert.equal(a.speakerContainerDisplayLabel(old), "姓名容器");
    assert.deepEqual(old, before, "Display alias must not mutate a stored layout");
  }
  assert.equal(a.speakerContainerDisplayLabel({ ...n, label: "作者姓名牌" }), "作者姓名牌");
  for (const preset of a.runtimeThemePresets) {
    const style = a.componentStylesFromThemeTokens(preset.tokens).speaker_label;
    assert(style.borderRadius <= 6 && style.borderRadius >= 0);
    assert.equal(style.borderColor, preset.tokens.colorLine);
  }
  const customized = structuredClone(layout);
  Object.assign(speaker(customized).style, { borderRadius: 29, backgroundColor: "#354657", color: "#ccddee" });
  speaker(customized).label = "作者姓名牌";
  const before = structuredClone(customized);
  const normalized = a.normalizeUISkinLayoutForRuntime(customized);
  assert.deepEqual(customized, before, "Loading custom colors/radius is non-mutating");
  assert.deepEqual(speaker(normalized.layout), speaker(before));
  assert.equal(speaker(a.createRenpyUILayout()).style.borderRadius, 0, "Ren'Py flat style stays independent");
  const script = { schema_version: "1.1.0", game_id: "speaker-container", title: "姓名容器",
    entry_scene_id: "main", characters: [], scenes: [{ scene_id: "main", title: "Main",
      chapter: 1, tags: [], commands: [{ type: "narration", text: "姓名容器独立验收。" }] }] };
  for (const skin of [layout, customized, a.createRenpyUILayout()]) {
    const result = await a.exportEditorCartridge({ gameId: script.game_id, title: script.title,
      author: "QA", uiSkin: skin, projectAssets: [], projectAssetRefs: [], script });
    assert.deepEqual(result.errors, []);
    const zip = await require("../editor/node_modules/jszip").loadAsync(await result.blob.arrayBuffer());
    assert.deepEqual(speaker(JSON.parse(await zip.file("ui/layout.json").async("string"))), speaker(skin));
  }
  return { status: "PASS", themes: a.runtimeThemePresets.length, actualExports: 3,
    labels: 5, explicitOverridesPreserved: true, renpyIndependent: true };
}
async function browser(out, report, save) {
  const { chromium } = require("../editor/node_modules/playwright");
  const { startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
  const { settleEditor } = require("./lib/installed-acceptance.cjs");
  const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
  const a = api(), project = require("./lib/editor-ui-acceptance.cjs").fixture(`speaker-container-${path.basename(out)}`);
  const agentvn = a.getDefaultUISkinLayout(), renpy = a.createRenpyUILayout();
  speaker(agentvn).label = "说话人名牌"; speaker(renpy).label = "人物名牌";
  project.editor_settings = { runtimeUILayout: agentvn,
    runtimeUILayoutProfiles: { version: 1, activeType: "agentvn", profiles: { agentvn, renpy } } };
  process.env.AGENTVN_TEST_PROJECT = path.join(out, "姓名容器 独立工程.vnproj");
  write(process.env.AGENTVN_TEST_PROJECT, project);
  process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "browser");
  let host, b;
  report.matrix = [];
  try {
    host = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
    report.service = { url: host.url, backendUrl: host.backendUrl, frontendPid: host.server.pid, backendPid: host.backendPid };
    save(); b = await chromium.launch({ headless: true });
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const cell = { width, height, dpr, reduced, status: "RUNNING", types: [] };
        report.matrix.push(cell); save();
        const context = await b.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
          reducedMotion: reduced ? "reduce" : "no-preference" });
        const page = await context.newPage(); page.setDefaultTimeout(45000);
        const errors = []; page.on("pageerror", e => errors.push(String(e)));
        await page.route(/\/api\/(?:assistant|novel)/, r => {
          if (r.request().method() === "POST") { report.modelRequests++; return r.abort(); }
          return r.continue();
        });
        try {
          await host.open(page); await settleEditor(page);
          await page.locator('[data-workspace-surface="options"]:visible').click();
          await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
          for (const type of ["agentvn", "renpy"]) {
            const button = page.locator(`[data-layout-type-option="${type}"]:visible`);
            if (await button.getAttribute("aria-pressed") !== "true") await button.click();
            await page.waitForFunction(t => document.querySelector(".runtime-layout-designer")?.getAttribute("data-layout-type") === t
              && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false", type);
            const player = page.getByTestId("renpy-player-layout-entry");
            if (await player.isVisible()) await player.click();
            await page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true }).click();
            await settleEditor(page);
            const selector = '.runtime-layout-sidebar button[data-component-id="speaker_label"]';
            const control = page.locator(selector);
            assert.match(await control.innerText(), /姓名容器/, "Legacy builtin labels display the new name");
            assert.doesNotMatch(await control.innerText(), /说话人名牌|人物名牌/);
            await control.click();
            assert.match(await page.locator(".runtime-layout-inspector > header").innerText(), /姓名容器/);
            const appearance = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^外观$/ }) });
            if (await appearance.getAttribute("open") === null) await appearance.locator("summary").click();
            const numeric = page.locator('input[type="number"][data-help-key="layout.styleNumber"]');
            const radius = appearance.locator("label").filter({ hasText: /^borderRadius/ }).locator('input[type="number"]');
            assert.equal(await radius.inputValue(), type === "agentvn" ? "6" : "0");
            const geometry = await control.evaluate(n => {
              const r = n.getBoundingClientRect(), p = n.closest(".runtime-layout-sidebar").getBoundingClientRect();
              const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              const stage = document.querySelector(".runtime-layout-stage").getBoundingClientRect();
              const block = document.querySelector('.runtime-layout-block[data-component-id="speaker_label"]').getBoundingClientRect();
              return { rect: r.toJSON(), sidebar: p.toJSON(), stage: stage.toJSON(), block: block.toJSON(),
                hit: n === hit || n.contains(hit), overflow: document.documentElement.scrollWidth - innerWidth };
            });
            assert(geometry.hit && geometry.overflow <= 1);
            for (const [child, parent] of [[geometry.rect, geometry.sidebar], [geometry.block, geometry.stage]])
              assert(child.left >= parent.left - 1 && child.right <= parent.right + 1
                && child.top >= parent.top - 1 && child.bottom <= parent.bottom + 1, "Control clipped by its owning region");
            // Editing through actual controls proves explicit values remain supported.
            await radius.fill("9"); await radius.press("Tab");
            assert.equal(await radius.inputValue(), "9");
            await radius.fill(type === "agentvn" ? "6" : "0"); await radius.press("Tab");
            await page.locator('[data-help-key="layout.save"]:visible').click();
            await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
            cell.types.push({ type, geometry, radiusEditable: true, numericControls: await numeric.count() });
            if (width === 1920 && dpr === 1 && !reduced)
              cell.types.at(-1).screenshot = await captureSourceBrowser(page,
                path.join(out, `${type}-1080p.png`), { width, height, dpr, reduced });
          }
          assert.deepEqual(errors, []); cell.status = "PASS"; save();
        } finally { await context.close(); }
        console.log(`PASS ${width} DPR${dpr} ${reduced ? "reduce" : "normal"}`);
      }
    assert.equal(report.matrix.length, 12); assert(report.matrix.every(c => c.status === "PASS" && c.types.length === 2));
  } finally {
    await b?.close(); await host?.stop();
    report.cleanup = [];
    for (const url of [host?.url, host?.backendUrl].filter(Boolean)) {
      let responds = false; try { await fetch(url, { signal: AbortSignal.timeout(1000) }); responds = true; } catch {}
      report.cleanup.push({ url, status: responds ? "FAILED" : "PASS" });
    }
    save(); assert(report.cleanup.every(c => c.status === "PASS"));
  }
}
async function main() {
  if (mode === "prepare") {
    assert(!fs.existsSync(qa) && !fs.existsSync(checkpoint));
    fs.mkdirSync(qa, { recursive: true }); fs.mkdirSync(checkpoint, { recursive: true });
    const copies = [...files, "plans/ACTIVE_TASKS.md", ".gitignore", "scripts/push-agentvn-editor.ps1"].map(f => {
      const dest = path.join(checkpoint, f); fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(root, f), dest, fs.constants.COPYFILE_EXCL); return desc(dest);
    });
    const dev = path.join(root, "AgentVN Dev.exe");
    fs.copyFileSync(dev, path.join(checkpoint, "AgentVN Dev.before.exe"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(checkpoint, "worktree.patch"),
      execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: root, maxBuffer: 128 * 1024 * 1024 }), { flag: "wx" });
    const a = api(), project = require("./lib/editor-ui-acceptance.cjs").fixture("speaker-container-20261021");
    const agentvn = a.getDefaultUISkinLayout(), renpy = a.createRenpyUILayout();
    // Exercise legacy naming with fresh defaults after the fix, without migrating author styles.
    speaker(agentvn).label = "说话人名牌"; speaker(renpy).label = "人物名牌";
    project.editor_settings = { runtimeUILayout: agentvn,
      runtimeUILayoutProfiles: { version: 1, activeType: "agentvn", profiles: { agentvn, renpy } } };
    write(path.join(qa, "姓名容器 独立工程.vnproj"), project);
    write(path.join(checkpoint, "manifest.json"), { at: new Date().toISOString(), copies, dev: desc(dev),
      scope: "Recoverable affected source, untracked files, full tracked diff, Dev; frozen installed 1.9.19 unchanged" });
    console.log(JSON.stringify({ checkpoint, qa })); return;
  }
  assert(["model", "browser", "check", "dev"].includes(mode)); assert.match(attempt, /^\d{2}$/);
  const out = path.join(qa, `${mode}-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", mode, at: new Date().toISOString(), modelRequests: 0,
    scope: "SOURCE_AND_DEV_ONLY_NOT_INSTALLED_OR_ANDROID", commands: [],
    sources: files.map(f => desc(path.join(root, f))) };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const command = async (exe, args) => {
    const log = path.join(out, `${report.commands.length + 1}.log`), fd = fs.openSync(log, "wx");
    const c = { command: [exe, ...args], at: new Date().toISOString(), log, status: "RUNNING" };
    report.commands.push(c); save();
    const env = { ...process.env, AGENTVN_TEST_PROJECT: path.join(qa, "姓名容器 独立工程.vnproj"),
      AGENTVN_WORKSPACE_OUTPUT: path.join(out, "extra"), TEMP: out, TMP: out };
    if (exe === "powershell.exe") env.PSModulePath = [
      path.join(process.env.USERPROFILE, "Documents/WindowsPowerShell/Modules"),
      path.join(process.env.ProgramFiles, "WindowsPowerShell/Modules"),
      path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/Modules")].join(path.delimiter);
    try {
      const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
      c.pid = child.pid; save();
      c.exitCode = await new Promise((res, rej) => { child.once("exit", res); child.once("error", rej); });
      assert.equal(c.exitCode, 0, log); c.status = "PASS"; console.log("PASS " + args.join(" "));
    } finally { fs.closeSync(fd); save(); }
  };
  save();
  try {
    if (mode === "model") report.model = await model();
    if (mode === "browser") await browser(out, report, save);
    if (mode === "check") {
      for (const m of ["model-03", "browser-02"]) assert.equal(read(path.join(qa, m, "report.json")).status, "PASS");
      for (const name of ["layout-opacity-split-test", "runtime-layout-profiles-test", "ui-skin-legacy-compat-contract",
        "ui-skin-style-component-health-contract", "dialog-portrait-layout-model-test", "renpy-layout-runtime-test",
        "editor-workspace-contract", "gitpush-safety-test"])
        await command(process.execPath, [`scripts/${name}.cjs`]);
      const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
      for (const [folder, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
        await command(process.execPath, [npm, "--prefix", path.join(root, folder), "run", task]);
    }
    if (mode === "dev") {
      const check = read(path.join(qa, "check-01/report.json")); assert.equal(check.status, "PASS");
      assert.equal(check.commands.length, 11); for (const f of check.sources) assert.equal(sha(f.path), f.sha256);
      report.beforeDev = desc(path.join(root, "AgentVN Dev.exe"));
      await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts/build-dev-launcher.ps1")]);
      report.dev = desc(path.join(root, "AgentVN Dev.exe"));
      assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
      assert(Date.parse(report.dev.generatedAt) > Date.parse(report.at));
      await command(process.execPath, ["scripts/editor-installed-version-resources-test.cjs"]);
    }
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
