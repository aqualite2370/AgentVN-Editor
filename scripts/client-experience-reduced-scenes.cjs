"use strict";
// Focused correction of the six raw reduced-scene assertions. Reuses the same
// actual transition observer and exact UI-exported cartridges from full-02.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const { sceneTransition, line } = require("./lib/client-experience-current-flow.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Client-Experience-Safe-20261020-01";
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const input = path.join(qa, "客户端完整流程base64临时工程.vnproj");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), path.resolve(input));
const out = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || "");
assert(out.startsWith(path.resolve(qa) + path.sep) && !fs.existsSync(out)); fs.mkdirSync(out);
const priorPath = path.join(qa, "full-02/report.json"), prior = JSON.parse(fs.readFileSync(priorPath));
assert.equal(prior.status, "FAILED"); assert.equal(prior.cases.length, 12);
const report = { status: "RUNNING", at: new Date().toISOString(), cases: [],
  scope: "SOURCE_RUNTIME_REDUCED_AUTHORED_SCENE_POLICY_NOT_UI_TRANSITIONS_NOT_INSTALLED",
  prior: { path: priorPath, sha256: sha(priorPath), statusUnchanged: "FAILED" },
  sources: ["scripts/client-experience-reduced-scenes.cjs", "scripts/lib/client-experience-current-flow.cjs",
    "GameCli_framework/src/components/player/runtimeAnimation.ts"]
    .map(file => ({ file, sha256: sha(path.join(root, file)) })),
  products: ["AgentVN Dev.exe", "editor/src-tauri/binaries/agentvn-player.exe"].map(file => ({ file, sha256: sha(path.join(root, file)) })) };
let service, browser;
const persist = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
(async () => {
  service = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"), logFile: path.join(out, "runtime.log") });
  const port = Number(new URL(service.url).port);
  report.service = { pid: service.pid, runId: service.runId, url: service.url, port,
    identity: JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter 'ProcessId=${service.pid}'|Select-Object ProcessId,ExecutablePath,CreationDate|ConvertTo-Json -Compress`],
    { encoding: "utf8", windowsHide: true })) };
  browser = await chromium.launch();
  for (const original of prior.cases.filter(c => c.reduced)) {
    const { width, height, dpr, key, cartridge } = original;
    const row = { key, width, height, dpr, reduced: true, status: "RUNNING", cartridge }; report.cases.push(row); persist();
    assert.equal(sha(cartridge.path), cartridge.sha256);
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: "reduce" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    try {
      await service.run(async () => {
        await page.goto(`${service.url}/?mode=library`); await settleRuntime(page);
        await page.evaluate(async () => { window.__sceneLibrary = (await import("/src/store/libraryStore.ts")).useLibraryStore; });
        await page.getByTestId("web-cartridge-file").setInputFiles(cartridge.path);
        await page.waitForFunction(id => {
          const s = window.__sceneLibrary.getState(), game = s.games.find(g => g.install_id === s.selectedInstallId);
          return !s.importing && !s.loading && !s.error && game?.manifest.game_id === id;
        }, cartridge.gameId);
        await page.getByRole("button", { name: "启动卡带", exact: true }).click(); await settleRuntime(page);
        await page.getByTestId("start-new-game").click(); await settleRuntime(page); await line(page, "背景 A 已就位");
        for (const text of ["背景 B 已进入", "背景 C 完成", "角色 A 已显示", "角色 B 完成", "角色 C 完成"]) {
          await page.locator(".dialog-text").click(); await line(page, text);
        }
        row.transition = await sceneTransition(page, { name: "sprite-exit", kind: "fade",
          current: "hero_c", sprite: true, exit: true });
        assert.equal(row.transition.policy, "REDUCED_AUTHORED_EFFECT_SETTLED");
        await line(page, "角色退出动画完成");
        assert.equal(await page.locator('.sprite-slot[data-character-id="hero"]').count(), 0);
        assert.deepEqual(errors, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
        row.screenshot = await captureSourceBrowser(page, path.join(out, `${key}-end.png`), { width, height, dpr, reduced: true });
        row.status = "PASS";
      });
    } catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
    finally { await context.close(); persist(); }
    console.log(`${row.status} ${key}`);
  }
  assert.equal(report.cases.length, 6);
  report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  await browser?.close(); await service?.stop();
  if (service) {
    const response = await fetch(`${service.url}/__agentvn_acceptance_owner/${service.runId}`,
      { signal: AbortSignal.timeout(1000) }).catch(() => null);
    report.cleanup = { status: response === null ? "PASS" : "FAILED", pid: service.pid, port: report.service.port };
    if (response !== null) report.status = "FAILED";
  }
  for (const source of [...report.sources, ...report.products]) assert.equal(sha(path.join(root, source.file)), source.sha256);
  assert.equal(sha(priorPath), report.prior.sha256);
  report.finishedAt = new Date().toISOString(); persist();
  for (const source of report.sources) {
    const dest = path.join(out, "sources", source.file); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, source.file), dest, fs.constants.COPYFILE_EXCL);
  }
  if (report.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
