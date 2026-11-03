"use strict";
// QA-tool regression only. Executes the exact three source wait statements in
// a controlled real browser; no Editor, native IPC, project, or model is used.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const ts = require("../editor/node_modules/typescript");
const { chromium } = require("../editor/node_modules/playwright");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Async-Readiness-Audit-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/Async-Readiness-Audit-20261020-01";
const summary = path.join(root, "output/async-readiness-audit-20261020-01");
const targets = [
  ["story", "scripts/client-experience-final-e2e-playwright.cjs"],
  ["save", "scripts/dialog-presentation-native-preview-playwright.cjs"],
  ["geometry", "scripts/renpy-button-frame-playwright.cjs"],
];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const artifact = file => ({ path: file, sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const [mode, iteration = "01"] = process.argv.slice(2);
assert(["prepare", "red", "green"].includes(mode));
if (mode === "prepare") {
  for (const dir of [qa, checkpoint, summary]) {
    assert(!fs.existsSync(dir), `Never overwrite ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  }
  const files = [...targets.map(([, file]) => file), "AGENTS.md", "plans/ACTIVE_TASKS.md",
    "plans/FULL_REGRESSION_20261017.md"];
  const saved = files.map(file => {
    const dest = path.join(checkpoint, file); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, file), dest, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(dest), sha(path.join(root, file))); return { file, sha256: sha(dest) };
  });
  const preparation = { status: "PASS", at: new Date().toISOString(), saved, qa, checkpoint,
    products: ["AgentVN Dev.exe", "editor/src-tauri/binaries/agentvn-player.exe"].map(f => artifact(path.join(root, f))),
    scope: "QA scripts and existing task index only; no product changes, native interaction, model calls, or deletion" };
  for (const file of [path.join(checkpoint, "manifest.json"), path.join(summary, "preparation.json")])
    fs.writeFileSync(file, JSON.stringify(preparation, null, 2), { flag: "wx" });
  console.log(JSON.stringify(preparation, null, 2));
} else {
  const out = path.join(qa, `${mode}-${iteration}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", at: new Date().toISOString(), mode,
    scope: "CONTROLLED_REAL_BROWSER_QA_WAIT_SEAMS_NOT_PRODUCT_ACCEPTANCE",
    modelRequests: 0, cases: [], sources: targets.map(([key, file]) => ({ key, file, sha256: sha(path.join(root, file)) })),
    playwrightVersion: require("../editor/node_modules/playwright/package.json").version };
  const helper = path.join(root, "scripts/lib/async-readiness.cjs");
  if (fs.existsSync(helper)) report.helper = artifact(helper);
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  function seam(file) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const found = [];
    function walk(node) {
      if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
        const call = node.expression, fn = call.expression;
        const name = ts.isPropertyAccessExpression(fn) ? fn.name.text : ts.isIdentifier(fn) ? fn.text : "";
        if (["waitForFunction", "waitForAsyncFunction"].includes(name)
          && call.arguments.some(a => (ts.isArrowFunction(a) || ts.isFunctionExpression(a))
            && a.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword))) found.push(node.getText(tree));
      }
      ts.forEachChild(node, walk);
    }
    walk(tree); assert.equal(found.length, 1, `One exact async wait seam required in ${file}`);
    return found[0];
  }
  async function controlledPage(browser) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      assert.equal(url.hostname, "readiness.agentvn.invalid", "No external service access");
      if (url.pathname === "/src/store/runtimeStore.ts") {
        await route.fulfill({ contentType: "text/javascript", body:
          "export const useRuntimeStore={getState(){const n=++window.__storyReads;return {launchTransition:n>=3?'idle':'covering',engineState:{currentCommandIndex:n>=3?1:0,dialog:{isNarration:n>=3}}}}};" });
      } else await route.fulfill({ contentType: "text/html", body: "<!doctype html><main>Controlled QA readiness observations</main>" });
    });
    await page.goto("http://readiness.agentvn.invalid/");
    return page;
  }
  async function check(name, fn) {
    const row = { name, status: "RUNNING" }; report.cases.push(row);
    try { row.detail = await fn(row); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); }
    console.log(`${row.status} ${name}`);
  }
  (async () => {
    const browser = await chromium.launch();
    try {
      for (const [kind, file] of targets) await check(`${kind}: exact source wait must retry false observations`, async row => {
        const page = await controlledPage(browser);
        try {
          await page.evaluate(kind => {
            window.__storyReads = 0; window.__saveReads = 0; window.__geometryReads = 0;
            window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
              if (command !== "read_save" || args.installId !== "qa-owned" || args.slot !== 1) throw Error("Unexpected QA IPC");
              const n = ++window.__saveReads;
              await new Promise(resolve => requestAnimationFrame(resolve));
              return { save_id: n >= 3 ? "new-snapshot" : "old-snapshot" };
            } };
            if (kind === "geometry") {
              document.body.innerHTML = '<section data-testid="renpy-title-view" data-renpy-scale="1"><button data-testid="start-new-game">Start</button></section>';
              const title = document.querySelector("section"), button = document.querySelector("button");
              title.getBoundingClientRect = () => {
                const n = ++window.__geometryReads;
                return new DOMRect(0, 0, 300 + Math.min(n, 5), 240);
              };
              button.getBoundingClientRect = () => new DOMRect(0, 0, 100, 40);
            }
          }, kind);
          row.statement = seam(file);
          const run = new Function("page", "player", "installId", "beforeSave", "waitForAsyncFunction",
            `return (async () => { ${row.statement}; })()`);
          await run(page, page, "qa-owned", { save_id: "old-snapshot" },
            fs.existsSync(helper) ? require(helper).waitForAsyncFunction : undefined);
          row.observed = await page.evaluate(() => ({
            story: window.__storyReads, save: window.__saveReads, geometry: window.__geometryReads,
          }));
          const expected = kind === "geometry" ? 6 : 3;
          assert(row.observed[kind] >= expected,
            `${kind} wait returned before readiness: expected >=${expected} observations; got ${row.observed[kind]}`);
          return { observations: row.observed[kind], expectedMinimum: expected };
        } finally { await page.close(); }
      });
      if (mode === "green") {
        const { waitForAsyncFunction } = require(helper);
        await check("Serial async polling waits for fourth result without overlap", async () => {
          const page = await controlledPage(browser);
          try {
            await page.evaluate(() => { window.__polls = 0; window.__pending = 0; window.__maxPending = 0; });
            const actual = await waitForAsyncFunction(page, async () => {
              const n = ++window.__polls; window.__pending++;
              window.__maxPending = Math.max(window.__maxPending, window.__pending);
              await new Promise(resolve => requestAnimationFrame(resolve));
              window.__pending--; return n >= 4 ? { done: true } : false;
            }, null, { timeout: 2000, polling: 10 });
            assert.deepEqual(actual, { done: true });
            const state = await page.evaluate(() => ({ polls: window.__polls, pending: window.__pending, max: window.__maxPending }));
            assert.deepEqual(state, { polls: 4, pending: 0, max: 1 }); return state;
          } finally { await page.close(); }
        });
        await check("Resolved false cannot pass and deadline is bounded", async () => {
          const page = await controlledPage(browser);
          try {
            await page.evaluate(() => { window.__polls = 0; });
            await assert.rejects(waitForAsyncFunction(page, async () => { window.__polls++; return false; },
              null, { timeout: 250, polling: 10 }), /Async readiness timed out/);
            const polls = await page.evaluate(() => window.__polls); assert(polls > 1); return { polls };
          } finally { await page.close(); }
        });
        await check("Read rejection is surfaced once, not retried or accepted", async () => {
          const page = await controlledPage(browser);
          try {
            await page.evaluate(() => { window.__polls = 0; });
            await assert.rejects(waitForAsyncFunction(page, async () => {
              window.__polls++; throw Error("qa-read-failure");
            }, null, { timeout: 2000 }), /qa-read-failure/);
            const polls = await page.evaluate(() => window.__polls); assert.equal(polls, 1); return { polls };
          } finally { await page.close(); }
        });
        await check("Never-resolving read cannot hang the suite", async () => {
          const page = await controlledPage(browser);
          try {
            await assert.rejects(waitForAsyncFunction(page, async () => new Promise(() => {}),
              null, { timeout: 150 }), /Async readiness timed out/);
            return { deadlineEnforced: true };
          } finally { await page.close(); }
        });
        await check("Late truthy result after deadline cannot pass", async () => {
          const page = await controlledPage(browser);
          try {
            await assert.rejects(waitForAsyncFunction(page, async () => {
              await new Promise(resolve => setTimeout(resolve, 500)); return true;
            }, null, { timeout: 100 }), /Async readiness timed out/);
            return { lateSuccessRejected: true };
          } finally { await page.close(); }
        });
      }
    } finally { await browser.close(); report.cleanup = { browserClosed: true }; }
    assert.equal(report.cases.length, mode === "green" ? 8 : 3, "No empty or partial PASS");
    report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  })().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
  .finally(() => {
    if (report.status !== "PASS") process.exitCode = 1;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, out }));
  });
}
