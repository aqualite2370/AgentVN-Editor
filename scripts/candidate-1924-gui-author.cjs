"use strict";
// Bind the existing complete library workflow to this exact installed candidate.
// New evidence only; no inherited old-candidate matrix or historical rewrites.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const current1930 = process.argv.includes("--candidate=1.9.30");
const version = current1930 ? "1.9.30" : "1.9.24";
const authorAttempt = current1930 ? "63" : "57";
const installationFile = current1930
  ? "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json"
  : "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const installation = JSON.parse(fs.readFileSync(installationFile,"utf8").replace(/^\uFEFF/,""));
assert.equal(installation.status,"PASS");
assert.equal(current1930 ? installation.version : installation.executable.version,version);
if(current1930) {
  assert.equal(sha(installation.actualInstallation.path),installation.actualInstallation.sha256);
  const actual=JSON.parse(fs.readFileSync(installation.actualInstallation.path,"utf8").replace(/^\uFEFF/,""));
  assert(actual.status==="PASS"&&actual.exitCode===0&&actual.registryRestored);
  assert.equal(actual.executable.sha256,installation.executable.sha256);
}
for(const f of [installation.executable,...installation.resources,...installation.protectedFiles])
  assert.equal(sha(f.path),f.sha256);
const previous = path.join(__dirname, "installed-gui-library-release.cjs");
assert.equal(sha(previous), "fe4073b21e2f1c7db2d023821676d2ea709c78a7a092d0f7163be63c5a76f0e5");
let source = fs.readFileSync(previous, "utf8"); const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('assert.match(attempt, /^\\d{2}$/);',
  `assert.equal(attempt, "${authorAttempt}"); assert.equal(process.argv.length, 3);`);
replace('const qa = "F:/AgentVN/QA/Installed-GUI-Library-1922-20261022-01";',
  'const qa = "F:/AgentVN/QA/Installed-Layout-20261021-01";');
replace('const installationFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json";',
  `const installationFile = ${JSON.stringify(installationFile)};`);
replace('const baseline = read("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json");',
  'const baseline = read(installationFile);\n' +
  `assert.equal(${current1930 ? "baseline.version" : "baseline.executable.version"}, "${version}");\n` +
  `assert.equal(baseline.executable.sha256, "${installation.executable.sha256}");\n` +
  'assert.equal(baseline.metadataRestoration, "PASS");');
replace('`installed-gui-library-1922-${attempt}`', '`installed-gui-library-' + version.replaceAll(".","") + '-${attempt}`');
replace('"ACTUAL_INSTALLED_1922_COMPLETE_OFFICIAL_GUI_LIBRARY_SCOPE_REVISION_RESTART_EXPORT"',
  `"ACTUAL_INSTALLED_${version.replaceAll(".","")}_COMPLETE_OFFICIAL_GUI_LIBRARY_SCOPE_REVISION_RESTART_EXPORT"`);
replace('protectedFiles: baseline.protectedFiles',
  'protectedFiles: [baseline.executable, ...baseline.resources, ...baseline.protectedFiles]');
replace('fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
  'fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
  'fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
  'fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
const start = source.indexOf('    await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")');
const end = source.indexOf('    const game = await JSZip.loadAsync(fs.readFileSync(target)');
assert(start > 0 && end > start);
replace(source.slice(start, end), `    await until(async () => {
      const dialog = page.getByTestId("package-environment-operation-dialog");
      if (await dialog.isVisible()) {
        const phase = await dialog.getAttribute("data-environment-phase");
        if (!["completed", "failed"].includes(phase)) return false;
        await dialog.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
      }
      try { await panel.locator('[data-package-stage="settings"]').click({ timeout: 750 }); } catch { return false; }
      return panel.locator('[data-help-key="package.mode"]').isVisible();
    }, "native GUI publishing preparation", 180000);
    await click(panel.locator('[data-help-key="package.mode"]'));
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warning.isVisible()) await warning.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]');
    if (await consent.isVisible()) await consent.check();
    const directory = path.join(out, "cartridge"); fs.mkdirSync(directory);
    const download = await A.realDownload(page, host.cdp, directory, panel.locator('[data-help-key="package.export"]'));
    report.completedDownload = download; save();
    const target = download.path;
`);
replace('report.finishedAt = new Date().toISOString(); save();',
  'report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();');
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  let replay = fs.readFileSync(previous, "utf8");
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after); }
  assert.equal(replay, source);
  assert(source.includes('assert.deepEqual(next, previous)'));
  assert(source.includes('assert.equal(report.matrix.length, 12)'));
  assert(source.includes('assert.equal(record.assetCount, 25)'));
  console.log(JSON.stringify({ status: "PASS", changes: changes.length, scope: "QA_CANDIDATE_BINDING_ONLY_NO_PRODUCT_RUN" }));
} else {
  if(current1930) {
    assert.deepEqual(process.argv.slice(2),[authorAttempt,"--candidate=1.9.30"]);
    process.argv.splice(3);
  }
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = source; worker.qaChanges = changes; worker._compile(source, __filename);
}
