"use strict";
// Re-run all nine original business groups against sealed 1.9.24. No inherited
// old-candidate evidence, edits to the historical workflow, or model requests.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const previous = path.join(__dirname, "installed-components-current.cjs");
assert.equal(sha(previous), "83300842d7d386a6793907b57e5c5f0bb331dd88a1c11534dc0a4c82ac71bc9f");
const candidate = {
  current: true,
  expected: { version: "1.9.24", sha256: "ef457f369303302d488e30d105295e9b40a0161cf79d7e996383958429e1a143" },
  installationFile: "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json",
  protectedSourceFile: "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json",
};
let source = fs.readFileSync(previous, "utf8"); const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('const candidate = require("./lib/installed-components-candidate.cjs");',
  `const candidate = ${JSON.stringify(candidate)};`);
replace('qa = "F:/AgentVN/QA/Installed-Components-20261021-01"',
  'qa = "F:/AgentVN/QA/Installed-Components-1924-20261025-01"');
replace('const attempt = process.argv[2] || "01"; assert.match(attempt, /^\\d{2}$/);',
  'const attempt = process.argv[2]; assert.equal(attempt, "01"); assert.equal(process.argv.length, 3);');
replace('const protectedFiles = read(protectedSourceFile).protectedFiles;',
  'const sealed = read(protectedSourceFile);\n' +
  'const protectedFiles = [sealed.executable, ...sealed.resources, ...sealed.protectedFiles];');
replace('  unchanged(); report.gitBefore = git();',
  '  unchanged(); report.gitBefore = git();\n' +
  '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
  '  fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
const start = source.indexOf('    const operation = page.getByTestId("package-environment-operation-dialog");');
const end = source.indexOf('    await page.locator(\'[data-help-key="package.mode"]\').click();', start);
assert(start > 0 && end > start);
replace(source.slice(start, end), `    await until(async () => {
      const operation = page.getByTestId("package-environment-operation-dialog");
      if (await operation.isVisible()) {
        const phase = await operation.getAttribute("data-environment-phase");
        if (!["completed", "failed"].includes(phase)) return false;
        report.incidentalEnvironment = { phase, text: await operation.innerText(),
          scope: "QA cache Junction, not default Windows environment acceptance" }; save();
        await operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
        await operation.waitFor({ state: "detached" });
      }
      try { await page.locator('[data-package-stage="settings"]').click({ timeout: 750 }); } catch { return false; }
      return page.locator('[data-help-key="package.mode"]').isVisible();
    }, "real current publishing settings ready", 180000);
`);
replace('  report.finishedAt = new Date().toISOString(); save();',
  '  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();');
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  let replay = fs.readFileSync(previous, "utf8");
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after); }
  assert.equal(source, replay);
  for (const text of ['assert.equal(report.cases.length', 'validate(report, candidate.expected)',
    'assert.equal(cs.length, expectedComponents)', 'assert.deepEqual(await snapshot(), baseline)'])
    assert(source.includes(text) || text === 'assert.equal(report.cases.length' && source.includes('rejected: report.cases.length'));
  const installation = JSON.parse(fs.readFileSync(candidate.installationFile, "utf8"));
  assert.equal(sha(installation.executable.path), candidate.expected.sha256);
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../output/installed-components-20261018-01/fixtures.json"), "utf8"));
  for (const f of fixture.images) assert.equal(sha(f.path), f.sha256);
  assert(!fs.existsSync("F:/AgentVN/QA/Installed-Components-1924-20261025-01/editor-01"));
  console.log(JSON.stringify({ status: "PASS", adaptations: changes.length, scope: "QA_BINDING_ONLY_NO_PRODUCT_RUN" }));
} else {
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = source; worker.qaChanges = changes; worker._compile(source, __filename);
}
