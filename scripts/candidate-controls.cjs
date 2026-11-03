"use strict";
// QA-only binding of the historical complete control workflows to one real
// installed candidate. Original business sources and failed receipts stay intact.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), crypto = require("node:crypto");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const argv = process.argv.slice(2), mode = argv.shift();
assert(["self-test", "prepare", "author", "author-audit", "roundtrip", "player"].includes(mode));
const configArgs = argv.filter(a => a.startsWith("--candidate-config="));
assert.equal(configArgs.length, 1);
const numbers = argv.filter(a => !a.startsWith("--"));
assert.equal(argv.length, numbers.length + 1);
assert.equal(numbers.length, 3);
assert(numbers.every(n => /^\d{2,3}$/.test(n)));
const [author, portable, playerAttempt] = numbers;
assert.notEqual(author, portable);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const configFile = configArgs[0].slice(19), config = validateCandidateConfig(read(configFile));
const actual = deriveActual(config.actual, config.version);
const editorRoot = n => `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${n}`;
const authorRoot = editorRoot(author), portableRoot = editorRoot(portable);
const playerRoot = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/control-code-installed-${config.version.replaceAll(".", "")}-${playerAttempt}`;
const prep = path.join(config.qa, `control-preparation-${author}`);
const installationFile = path.join(prep, "derived-installed.json");
const profilesFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-92/report.json";
const profileReport = read(profilesFile);
assert.equal(profileReport.status, "PASS");
assert.equal(profileReport.profiles.activeType, "renpy");
assert.equal(read(profileReport.installation).executable.sha256, actual.executable.sha256);
const authorAuditRoot = path.join(config.qa, `control-author-${author}-audit-01`);
const sourceTable = {
  author: ["candidate-1924-control-author.cjs", "03194c0d35182df969441c14557e0e5d8218696139c3aae463ea17564b59429f"],
  "author-audit": ["candidate-1924-control-author-audit.cjs", "6f26f20508c6db5371984ead12aeee43de4ec0a94556ac926eb0a25b2f5697b4"],
  roundtrip: ["candidate-1924-control-roundtrip.cjs", "818a55e5f071c7a3f890a011627d698888b8afeaa3780a19c949b89444c34555"],
  player: ["candidate-1924-control-player.cjs", "c19c7a64aa79fea167656b5fca2aa04fa0acfc1188c6b59ce6600742e64ceb88"],
};
function build(kind) {
  const [name, expected] = sourceTable[kind], file = path.join(__dirname, name);
  assert.equal(sha(file), expected, `Historical QA source drift: ${name}`);
  const original = fs.readFileSync(file, "utf8"); let source = original;
  const changes = [], replace = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, after); changes.push({ before, after });
  };
  if (kind === "author") {
    replace('assert.equal(attempt, "53");', `assert.equal(attempt, ${JSON.stringify(author)});`);
    replace('const installationFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";',
      `const installationFile = ${JSON.stringify(installationFile)};`);
    replace('const authorFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-50/report.json";',
      `const authorFile = ${JSON.stringify(profilesFile)};`);
    replace('const p = fixture("installed-1924-control-code");', `const p = fixture("installed-${config.version.replaceAll(".", "")}-control-code");`);
    replace('scope: "INSTALLED_1924_ORDINARY_AND_SAFE_CODE_AUTHOR_RESTART_NOT_PORTABLE_EXPORT_OR_PLAYER_ACTIONS",',
      'version: module.qaConfig.version, qaBinding: module.qaBinding,\n  scope: "CURRENT_INSTALLED_ORDINARY_AND_SAFE_CODE_AUTHOR_RESTART_NOT_PORTABLE_EXPORT_OR_PLAYER_ACTIONS",');
    replace('fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
      'fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
      'fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });');
  } else if (kind === "author-audit") {
    replace('const source = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-53";',
      `const source = ${JSON.stringify(authorRoot)};`);
    replace('const out = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/control-author-audit-01";',
      `const out = ${JSON.stringify(authorAuditRoot)};`);
    replace('const report = { status: "RUNNING", startedAt:',
      'const report = { status: "RUNNING", version: module.qaConfig.version, qaBinding: module.qaBinding, startedAt:');
    for (const before of ['assert.equal(install.executable.version, "1.9.24");', 'assert.equal(l.executable.version, "1.9.24");'])
      replace(before, before.replace('"1.9.24"', 'module.qaConfig.version'));
    replace('      const install = read(r.installation);',
      '      assert.equal(r.version, module.qaConfig.version);\n' +
      '      assert.deepEqual(r.qaBinding.configurationFile, module.qaBinding.configurationFile);\n' +
      '      assert.equal(sha(r.qaBinding.source.path), r.qaBinding.source.sha256);\n' +
      '      assert.equal(sha(path.join(source, "executed-business.cjs")), r.qaBinding.executedSourceSha256);\n' +
      '      const install = read(r.installation);');
    replace('    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);',
      '    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);\n' +
      '    fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });');
  } else if (kind === "roundtrip") {
    replace('assert.equal(process.argv[2], "54");', `assert.equal(process.argv[2], ${JSON.stringify(portable)});`);
    replace('out = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-54";', `out = ${JSON.stringify(portableRoot)};`);
    replace('const priorFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-53/report.json";',
      `const priorFile = ${JSON.stringify(path.join(authorRoot, "report.json"))};`);
    replace('const auditFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/control-author-audit-01/report.json";',
      `const auditFile = ${JSON.stringify(path.join(authorAuditRoot, "report.json"))};`);
    replace('const installationFile = "F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";',
      `const installationFile = ${JSON.stringify(installationFile)};`);
    replace('const report = { status: "RUNNING", startedAt:',
      'const report = { status: "RUNNING", version: module.qaConfig.version, qaBinding: module.qaBinding, startedAt:');
    replace('fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
      'fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
      'fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });');
    // Fresh database/native import, not the old browser-only file-input path.
    replace('    await click(page.locator(\'[data-help-key="toolbar.home"]\'));\n' +
      '    await page.locator(".project-home").waitFor();\n' +
      '    await page.locator(".project-import-button input").first().setInputFiles(report.portable.path);',
      '    await host.stop("Fresh isolated database before native portable open");\n' +
      '    const fresh = path.join(out, "fresh-profile"); fs.mkdirSync(fresh);\n' +
      '    host = installedReleaseSession({ installationFile, out: fresh, input, report, save }); page = await host.start();\n' +
      '    const trigger = page.getByLabel("创建或打开项目").getByRole("button", { name: "导入项目", exact: true });\n' +
      '    report.nativePickerCompletion = await A.nativeInput({ page, trigger, out, name: "control-portable-native-open",\n' +
      '      ownerPid: host.current.pid, selectedPath: report.portable.path, timeoutMs: 1200000 }); save();');
    replace('const host = installedReleaseSession', 'let host = installedReleaseSession');
    replace('    assert.deepEqual(skin, report.profiles.profiles.renpy);',
      '    const normalization = require("./lib/installed-control-normalization.cjs").normalizeInstalledControls(\n' +
      '      host.installation, report.profiles.profiles.renpy);\n' +
      '    assert.deepEqual(skin, normalization.layout);\n' +
      '    report.normalization = normalization.evidence;\n' +
      '    for (const id of ["title_start_button", "title_about_button"])\n' +
      '      assert.deepEqual(skin.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === id).presentation,\n' +
      '        component(report.profiles, id).presentation);');
    replace('        if (!["completed", "failed"].includes(phase)) return false;',
      '        if (!["completed", "failed"].includes(phase)) return false;\n' +
      '        report.incidentalEnvironment = { phase, text: await dialog.innerText(), scope: "QA Junction; not default physical environment acceptance" }; save();');
    replace('    report.cartridge = { ...download, manifest, image:',
      '    report.cartridge = { ...download, manifest, image:');
  } else {
    replace('base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01";', `base = ${JSON.stringify(config.qa)};`);
    replace('const sourceFile = path.join(base, "control-export-review-01/report.json"), source = read(sourceFile);',
      `const sourceFile = ${JSON.stringify(path.join(portableRoot, "report.json"))}, source = read(sourceFile);\n` +
      'source.installation = { path: source.installation, sha256: sha(source.installation) };');
    replace('assert.equal(source.playerConsumption, "NOT_RUN");',
      'assert.equal(source.version, module.qaConfig.version); assert.equal(source.cases.length, 4);\n' +
      'assert(source.cases.every(c => c.status === "PASS"));');
    replace('assert.equal(sha(exe), "6e7f4ec17d8388a99937123f88ddf7cebbe161fac39a19cfe3a3bc849e642168");',
      'assert.equal(sha(exe), installation.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256);');
    replace('assert.equal(installation.executable.version, "1.9.24");',
      'assert.equal(installation.executable.version, module.qaConfig.version);');
    replace('assert.equal(process.argv[2], "01");', `assert.equal(process.argv[2], ${JSON.stringify(playerAttempt)});`);
    replace('const out = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/control-code-installed-1924-01";',
      `const out = ${JSON.stringify(playerRoot)};`);
    replace('const report = { status: "RUNNING", startedAt:',
      'const report = { status: "RUNNING", version: module.qaConfig.version, qaBinding: module.qaBinding, startedAt:');
    replace('  assert.equal(actual.tag, "BUTTON");',
      '  (report.rawControlSamples ??= []).push({ id, viewport, actual }); save();\n  assert.equal(actual.tag, "BUTTON");');
    replace('assert.equal(actual.radius, "6px");',
      'assert.equal(actual.radius, `${6 * Math.min(viewport.width / 1280, viewport.height / 720)}px`);');
    replace('  unchanged(); save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
      '  unchanged(); save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
      '  fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });');
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  return { file, source, changes };
}
const compiled = Object.fromEntries(Object.keys(sourceTable).map(k => [k, build(k)]));
if (mode === "self-test") {
  const a = compiled.author.source, b = compiled["author-audit"].source;
  assert(a.includes('row.checks.length === 6') || a.includes('c.checks.length === 6'));
  assert(a.includes('assert.deepEqual(profiles.profiles.agentvn, prior.profiles.profiles.agentvn'));
  assert(a.includes('assert.equal(await page.evaluate(() => window.__qaUnsafeExecuted), undefined)'));
  assert(b.includes('badEvidenceRejected: 7'));
  assert(compiled.roundtrip.source.includes('await A.nativeInput'));
  assert(compiled.roundtrip.source.includes('assert.deepEqual(skin, normalization.layout)'));
  assert(compiled.player.source.includes('assert.equal(actual.images[0].sha256, source.cartridge.image.sha256)'));
  console.log(JSON.stringify({ status: "PASS", version: config.version, productStarts: 0,
    adaptations: Object.fromEntries(Object.entries(compiled).map(([k, v]) => [k, v.changes.length])),
    authorRoot, portableRoot, playerRoot, inheritedResults: false }));
} else if (mode === "prepare") {
  assert(!fs.existsSync(prep)); assert(!fs.existsSync(authorRoot)); assert(!fs.existsSync(portableRoot)); assert(!fs.existsSync(playerRoot));
  const protectedSource = path.join(config.qa, "project-directory-preparation-12/derived-installed.json");
  const protectedReport = read(protectedSource);
  assert.deepEqual(protectedReport.actualInstallation, config.actual);
  assert(protectedReport.protectedFiles.length > 0);
  for (const f of protectedReport.protectedAbsent ?? []) assert(!fs.existsSync(f));
  const installed = { ...actual, protectedSource: desc(protectedSource),
    protectedFiles: protectedReport.protectedFiles.map(f => desc(f.path)), protectedAbsent: protectedReport.protectedAbsent ?? [] };
  fs.mkdirSync(prep);
  fs.writeFileSync(installationFile, JSON.stringify(installed, null, 2), { flag: "wx" });
  const manifest = { status: "PASS", at: new Date().toISOString(), config: desc(configFile), installation: desc(installationFile),
    profiles: desc(profilesFile), adapter: desc(__filename), originalTools: Object.values(compiled).map(c => desc(c.file)),
    builds: 0, productChanges: 0, modelRequests: 0 };
  fs.writeFileSync(path.join(prep, "preparation.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  console.log(JSON.stringify(manifest, null, 2));
} else {
  const installed = read(installationFile);
  assert.deepEqual(installed.actualInstallation, config.actual);
  assert.deepEqual(installed.executable, actual.executable);
  for (const f of [...installed.resources, ...installed.protectedFiles]) assert.equal(sha(f.path), f.sha256);
  for (const f of installed.protectedAbsent) assert(!fs.existsSync(f));
  const generated = compiled[mode], worker = new Module(__filename, module);
  Object.assign(worker, { filename: __filename, paths: module.paths, qaConfig: config, qaSource: generated.source,
    qaBinding: { configurationFile: desc(configFile), actualInstallation: config.actual, source: desc(generated.file),
      adaptations: generated.changes, executedSourceSha256: crypto.createHash("sha256").update(generated.source).digest("hex"),
      author, portable, playerAttempt, inheritedBusinessResults: false } });
  process.argv = [process.execPath, __filename, mode === "author" ? author : mode === "roundtrip" ? portable : mode === "player" ? playerAttempt : "01"];
  worker._compile(generated.source, __filename);
}
