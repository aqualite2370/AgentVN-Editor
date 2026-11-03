"use strict";
// QA adapters: exact current installed bytes, original control business checks.
// No product changes, model calls, animation probes or rewritten old reports.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), { spawn } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const qa = "F:/AgentVN/QA/Controls-1.9.35-20261102-01";
const editorRoot = "F:/AgentVN/QA/Installed-Layout-20261101-01";
const authorRoot = editorRoot + "/editor-07", roundtripRoot = editorRoot + "/editor-08";
const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/control-code-installed-1935-01";
const receipt = qa + "/derived-actual-installation.json";
const baseline = editorRoot + "/editor-02/report.json";
const auditRoot = qa + "/author-audit-01";
const playerHelper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const files = { author: "candidate-1924-control-author.cjs", audit: "candidate-1924-control-author-audit.cjs",
  roundtrip: "candidate-1924-control-roundtrip.cjs", player: "candidate-1924-control-player.cjs" };
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
function build(mode, original) {
  let source = original; const edits = [];
  function change(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.replaceAll(before, () => after); edits.push({ before, after, count });
  }
  const commonReceipt = 'const installationFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";';
  if (mode === "author") {
    change('assert.equal(attempt, "53");', 'assert.equal(attempt, "07");');
    change('F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${attempt}', editorRoot + "/editor-${attempt}");
    change(commonReceipt, `const installationFile = ${JSON.stringify(receipt)};`);
    change('const authorFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-50/report.json";',
      `const authorFile = ${JSON.stringify(baseline)};`);
    change('fixture("installed-1924-control-code")', 'fixture("installed-1935-control-code")');
    change("INSTALLED_1924_ORDINARY_AND_SAFE_CODE_AUTHOR_RESTART", "ACTUAL_1935_ORDINARY_AND_SAFE_CODE_AUTHOR_RESTART");
  } else if (mode === "audit") {
    change('const source = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-53";',
      `const source = ${JSON.stringify(authorRoot)};`);
    change('const out = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/control-author-audit-01";',
      `const out = ${JSON.stringify(auditRoot)};`);
    change('assert.equal(install.executable.version, "1.9.24");', 'assert.equal(install.version, "1.9.35");');
    change('assert.equal(l.executable.version, "1.9.24");', 'assert.deepEqual(l.executable, install.executable);');
    change('assert.equal(png.readUInt32BE(16), s.before.width * s.before.dpr);\n        assert.equal(png.readUInt32BE(20), s.before.height * s.before.dpr);',
      'const d = matrix.find(d => Math.abs(d.dpr - s.before.dpr) < 1e-6 && d.width === s.before.width && d.height === s.before.height && d.reduced === s.before.reduced); assert(d);\n' +
      '        assert.equal(png.readUInt32BE(16), d.width * d.dpr);\n        assert.equal(png.readUInt32BE(20), d.height * d.dpr);');
    change('matrix.some(d => key(d) === key(s.before))',
      'matrix.some(d => d.width === s.before.width && d.height === s.before.height && d.reduced === s.before.reduced && Math.abs(d.dpr - s.before.dpr) < 1e-6)');
  } else if (mode === "roundtrip") {
    change('assert.equal(process.argv[2], "54");', 'assert.equal(process.argv[2], "08");');
    change('out = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-54";',
      `out = ${JSON.stringify(roundtripRoot)};`);
    change('const priorFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-53/report.json";',
      `const priorFile = ${JSON.stringify(authorRoot + "/report.json")};`);
    change('const auditFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/control-author-audit-01/report.json";',
      `const auditFile = ${JSON.stringify(auditRoot + "/report.json")};`);
    change(commonReceipt, `const installationFile = ${JSON.stringify(receipt)};`);
    change("const host = installedReleaseSession", "let host = installedReleaseSession");
    change('    await click(page.locator(\'[data-help-key="toolbar.home"]\'));\n' +
      '    await page.locator(".project-home").waitFor();\n' +
      '    await page.locator(".project-import-button input").first().setInputFiles(report.portable.path);',
      '    await host.stop("Fresh DB before actual native portable open");\n' +
      '    const fresh = path.join(out, "fresh-profile"); fs.mkdirSync(fresh);\n' +
      '    host = installedReleaseSession({ installationFile, out: fresh, input, report, save }); page = await host.start();\n' +
      '    const trigger = page.getByLabel("创建或打开项目").getByRole("button", { name: "导入项目", exact: true });\n' +
      `    report.nativePickerCompletion = await require(${JSON.stringify(__filename)}).nativePick({ page, trigger, out, ownerPid: host.current.pid, selectedPath: report.portable.path }); save();`);
    change('    assert.deepEqual(skin, report.profiles.profiles.renpy);',
      '    const normalization = require("./lib/installed-control-normalization.cjs").normalizeInstalledControls(host.installation, report.profiles.profiles.renpy);\n' +
      '    assert.deepEqual(skin, normalization.layout); report.normalization = normalization.evidence;\n' +
      '    for (const id of ["title_start_button", "title_about_button"]) assert.deepEqual(skin.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === id).presentation, component(report.profiles, id).presentation);');
  } else if (mode === "player") {
    change('base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";', `base = ${JSON.stringify(qa)};`);
    change('const sourceFile = path.join(base, "control-export-review-01/report.json"), source = read(sourceFile);',
      `const sourceFile = ${JSON.stringify(roundtripRoot + "/report.json")}, source = read(sourceFile);\nsource.installation = { path: source.installation, sha256: sha(source.installation) };`);
    change('assert.equal(source.playerConsumption, "NOT_RUN");',
      'assert.equal(source.cases.length, 4); assert(source.cases.every(c => c.status === "PASS"));');
    change('assert.equal(sha(exe), "6e7f4ec17d8388a99937123f88ddf7cebbe161fac39a19cfe3a3bc849e642168");',
      'assert.equal(sha(exe), installation.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256);');
    change('assert.equal(installation.executable.version, "1.9.24");', 'assert.equal(installation.version, "1.9.35");');
    change('const out = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/control-code-installed-1924-01";',
      `const out = ${JSON.stringify(playerRoot)};`);
    change('"scripts/native-dev-preview-profile.ps1"', JSON.stringify(playerHelper));
    change("...installation.protectedFiles", "...(installation.protectedFiles || [])");
    change('assert.equal(actual.radius, "6px");',
      'assert.equal(actual.radius, `${6 * Math.min(viewport.width / 1280, viewport.height / 720)}px`);');
  } else assert.fail(mode);
  new vm.Script(Module.wrap(source)); return { source, edits };
}
async function nativePick({ page, trigger, out, ownerPid, selectedPath }) {
  const reportPath = path.join(out, "native-project-open.json"); assert(!fs.existsSync(reportPath));
  await trigger.click();
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "gui-directory-picker-uia.ps1"), "-OwnerPid", String(ownerPid),
    "-ReportPath", reportPath, "-Directory", selectedPath, "-TitlePattern", "^选择 AgentVN 工程文件$", "-File"];
  const result = await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
    child.once("error", reject); child.once("close", code => resolve({ code, log }));
  });
  assert.equal(result.code, 0, result.log);
  const r = read(reportPath); assert.equal(r.status, "PASS"); assert.equal(r.ownerPid, ownerPid);
  assert.equal(path.resolve(r.directory), path.resolve(selectedPath));
  return { ...describe(reportPath), method: "Windows UI Automation; not Computer Use" };
}
function main(mode) {
  assert(["self-test", ...Object.keys(files)].includes(mode));
  const actual = descriptor();
  if (mode === "self-test") {
    for (const [kind, name] of Object.entries(files)) {
      const text = fs.readFileSync(path.join(__dirname, name), "utf8"), result = build(kind, text);
      let reversed = result.source;
      for (const e of [...result.edits].reverse()) reversed = reversed.replaceAll(e.after, () => e.before);
      assert.equal(reversed, text); assert.throws(() => build(kind, ""));
    }
    return console.log(JSON.stringify({ status: "PASS", reversibleAdapters: 4, emptySourcesRejected: 4,
      candidate: actual.executable, productStarts: 0, modelRequests: 0 }));
  }
  fs.mkdirSync(qa, { recursive: true });
  const receiptValue = { ...actual, protectedFiles: [], protectedAbsent: [] };
  if (fs.existsSync(receipt)) assert.deepEqual(read(receipt), receiptValue);
  else fs.writeFileSync(receipt, JSON.stringify(receiptValue, null, 2), { flag: "wx" });
  const prior = read(baseline);
  assert.equal(prior.status, "PASS"); assert.equal(prior.profiles.activeType, "renpy");
  assert.equal(read(prior.installation).executable.sha256, actual.executable.sha256);
  const prep = qa + "/" + mode + "-preparation"; fs.mkdirSync(prep);
  const original = path.join(__dirname, files[mode]), result = build(mode, fs.readFileSync(original, "utf8"));
  fs.writeFileSync(prep + "/executed.cjs", result.source, { flag: "wx" });
  fs.copyFileSync(__filename, prep + "/frozen-adapter.cjs", fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(prep + "/binding.json", JSON.stringify({ mode, original: describe(original),
    executed: describe(prep + "/executed.cjs"), adapter: describe(__filename), edits: result.edits,
    actualInstallation: actual.actualInstallation, productChanges: 0, builds: 0, modelRequests: 0 }, null, 2), { flag: "wx" });
  process.env.AGENTVN_INSTALLED_GUI_QA_ROOT = path.resolve(editorRoot);
  process.argv = [process.execPath, original, mode === "author" ? "07" : mode === "roundtrip" ? "08" : "01"];
  const worker = new Module(original, module);
  worker.filename = original; worker.paths = Module._nodeModulePaths(path.dirname(original));
  worker._compile(result.source, original);
}
if (require.main === module) main(process.argv[2]);
module.exports = { build, nativePick, qa, authorRoot, roundtripRoot, playerRoot, receipt, auditRoot, files };
