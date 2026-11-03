"use strict";
// Resume at the real native picker; preserve the original failed author/save
// receipt and consume its exact archived portable package without regenerating.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const previous = path.join(__dirname, "candidate-1924-control-roundtrip.cjs");
assert.equal(sha(previous), "818a55e5f071c7a3f890a011627d698888b8afeaa3780a19c949b89444c34555");
const resumeFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-54/report.json";
const resume = JSON.parse(fs.readFileSync(resumeFile, "utf8"));
assert.equal(resume.status, "FAILED"); assert.equal(resume.nativeCacheRestoration, "PASS");
assert.equal(resume.cases[0].status, "PASS"); assert.equal(resume.cases[1].status, "PASS");
assert(resume.error.includes("locator.setInputFiles"));
assert.equal(sha(resume.portable.path), resume.portable.sha256);
assert.equal(sha(resume.portable.originalNativePath), resume.portable.sha256);
let source = fs.readFileSync(previous, "utf8"); const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('assert.equal(process.argv[2], "54");', 'assert.equal(process.argv[2], "55");');
replace('out = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-54";',
  'out = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-55";');
replace('const input = path.join(out, "真实作者配置续接工程.vnproj");\nfs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });',
  'const input = module.qaResume.portable.path;');
replace('fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
  'fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
  'fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n' +
  'fs.writeFileSync(path.join(out, "adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });');
const start = source.indexOf('  await stage("Public isolated import of actual authored profiles; real About control authoring"');
const end = source.indexOf('  await stage("Real homepage portable-file import restores both layout configurations and code"');
assert(start > 0 && end > start);
replace(source.slice(start, end), `  report.resume = { path: ${JSON.stringify(resumeFile)}, sha256: ${JSON.stringify(sha(resumeFile))},
    boundary: "Actual UI author/native save from original failed QA receipt; no repeated author or save" };
  report.profiles = structuredClone(module.qaResume.profiles);
  report.portable = structuredClone(module.qaResume.portable);
  report.scope = "INSTALLED_NATIVE_PICKER_REOPEN_AND_FRESH_UI_CARTRIDGE_EXPORT_LINKED_TO_ACTUAL_AUTHOR_SAVE";
  report.fixtureBoundary = "No backend fixture import in this continuation; real native file picker consumes exact prior native-save package";
  save();
`);
replace('    await click(page.locator(\'[data-help-key="toolbar.home"]\'));\n    await page.locator(".project-home").waitFor();\n    await page.locator(".project-import-button input").first().setInputFiles(report.portable.path);',
`    await page.locator(".project-home").waitFor();
    const request = { id: require("node:crypto").randomUUID(), ownerPid: host.current.pid,
      selectedPath: report.portable.path, sha256: report.portable.sha256,
      requestedAt: new Date().toISOString(), completion: path.join(out, "native-picker-completed.json") };
    report.nativePicker = request;
    fs.writeFileSync(path.join(out, "native-picker-request.json"), JSON.stringify(request, null, 2), { flag: "wx" }); save();
    await click(page.locator('[data-help-key="home.importProject"]:visible').first());
    console.log(JSON.stringify({ stage: "NATIVE_PICKER_OPEN", request }));
    await until(() => fs.existsSync(request.completion), "Computer Use native project selection", 600000);
    const completion = JSON.parse(fs.readFileSync(request.completion, "utf8"));
    assert.equal(completion.requestId, request.id); assert.equal(completion.ownerPid, request.ownerPid);
    assert.equal(path.resolve(completion.selectedPath), path.resolve(request.selectedPath));
    assert.equal(completion.interaction, "COMPUTER_USE_SKY_NATIVE_DIALOG");
    assert.equal(sha(request.selectedPath), request.sha256);
    report.nativePickerCompletion = completion; save();`);
replace('assert.equal(report.cases.length, 4);', 'assert.equal(report.cases.length, 2);');
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  let replay = fs.readFileSync(previous, "utf8");
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after); }
  assert.equal(source, replay);
  assert(!source.includes('setInputFiles(report.portable.path)'));
  assert(source.includes("assert.deepEqual(skin, report.profiles.profiles.renpy)"));
  console.log(JSON.stringify({ status: "PASS", transformations: changes.length,
    scope: "QA_NATIVE_PICKER_CONTINUATION_NO_PRODUCT_RUN" }));
} else {
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaResume = resume; worker.qaSource = source; worker.qaChanges = changes; worker._compile(source, __filename);
}
