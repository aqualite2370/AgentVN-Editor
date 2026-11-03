"use strict";
// Complete only node-return and persistence. This candidate intentionally opens
// the event workbench on scene selection: minimize it before selecting another node.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Resource-Guidance-1.9.35-20261102-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const prior = read(path.join(qa, "finish-binding.json")), failedFile = path.join(qa, "session-03/report.json");
for (const f of [prior.originalExecuted, prior.adapter, prior.executed, prior.prior, prior.failedResume, prior.oracle.sourceDatabase])
  assert.equal(sha(f.path), f.sha256);
const failed = read(failedFile); assert.equal(failed.status, "FAILED");
assert(failed.error.includes("intercepts pointer events")); assert.equal(failed.cases[0].status, "PASS");
assert(failed.cleanups.every(c => c.status === "PASS")); assert.equal(read(failed.cacheRestoration.path).status, "PASS");
assert(!rows().some(p => /^(agentvn-editor|creator-backend|agentvn-player)\.exe$/i.test(p.Name)));
let source = fs.readFileSync(prior.executed.path, "utf8"); const edits = [];
function change(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, () => after); edits.push({ before, after });
}
change('const out = path.join(qa, "session-03");', 'const out = path.join(qa, "session-04");');
const begin = source.indexOf('  await stage("remaining-scoped-optional-character-target-and-node-isolation"');
const end = source.indexOf('  await stage("native-save-real-restart-and-fresh-host-portable-reimport-retain-correction"', begin);
assert(begin > 0 && end > begin);
change(source.slice(begin, end), `  await stage("remaining-node-return-uses-workbench-minimize-before-each-scene-selection", async () => {
    const workbench = page.getByRole("complementary", { name: "事件工作台" });
    const minimize = async () => {
      if (await workbench.isVisible()) {
        await workbench.getByRole("button", { name: "最小化事件工作台", exact: true }).click();
        await workbench.waitFor({ state: "hidden" });
      }
    };
    await minimize(); await page.locator('.react-flow__node[data-id="other"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".inspector-asset-audit article:not(.is-optional)").length === 0);
    await minimize(); await page.locator('.react-flow__node[data-id="scene"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".inspector-asset-audit article:not(.is-optional)").length === 20);
    assert.equal(await audit().locator("article.is-optional:visible").count(), 0);
    assert.deepEqual(await graph(), expected); await minimize();
    await host.shot("resource-node-return-with-real-window-actions");
    return { missingOtherScene: 0, missingCorrectedScene: 20, graphUnchanged: true,
      priorOptionalCharacterChecks: module.qaOptionalSource, nativeWorkbenchMinimized: true };
  });
`);
new vm.Script(Module.wrap(source));
const executed = path.join(qa, "persistence-executed.cjs"), binding = path.join(qa, "persistence-binding.json");
assert(!fs.existsSync(executed) && !fs.existsSync(binding));
fs.writeFileSync(executed, source, { flag: "wx" });
fs.writeFileSync(binding, JSON.stringify({ source: prior.executed, adapter: desc(__filename),
  executed: desc(executed), failed: desc(failedFile), first: prior.prior, oracle: prior.oracle, edits }, null, 2), { flag: "wx" });
const file = path.join(__dirname, "current-resource-guidance-closure.cjs"), worker = new Module(file, module);
Object.assign(worker, { filename: file, paths: Module._nodeModulePaths(__dirname), qaBinding: desc(binding),
  qaPrior: prior.prior, qaFailedResume: prior.failedResume, qaExecuted: desc(executed),
  qaExpectedCommands: prior.oracle.persistedCommands, qaOracle: prior.oracle, qaOptionalSource: desc(failedFile) });
worker._compile(source, file);
