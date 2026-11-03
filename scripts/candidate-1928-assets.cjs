"use strict";

// QA-only adapter: retain the historical invocation and allow an explicitly
// verified installed candidate to run the same complete business workflows.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const Module = require("node:module");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const configArgs = args.filter(a => a.startsWith("--candidate-config="));
assert(configArgs.length <= 1);
const directoryArgs = args.filter(a => a.startsWith("--directory-attempt="));
assert(directoryArgs.length <= 1);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const config = configArgs.length ? validateCandidateConfig(read(configArgs[0].slice(19))) : null;
assert(!directoryArgs.length || config, "Directory attempt requires an explicit candidate");
const directoryAttempt = directoryArgs.length ? directoryArgs[0].slice(20) : "11";
assert.match(directoryAttempt, /^\d{2}$/);
const action = args[0];
assert(["--self-test", "author", "player", "author-audit", "player-audit"].includes(action));
const numbers = args.slice(1).filter(a => !a.startsWith("--"));
assert.equal(args.length, 1 + numbers.length + configArgs.length + directoryArgs.length, "Unknown CLI argument");
for (const n of numbers) assert.match(n, /^\d{2}$/);
if (config) {
  assert.deepEqual(args, [action, ...numbers, configArgs[0], ...directoryArgs]);
  assert.equal(numbers.length, action === "player-audit" ? 3 : action === "player" || action === "author-audit" ? 2 : 1);
}
const preparation = config ? path.join(config.qa, `assets-preparation-${numbers[0]}`) : null;
const installationFile = config ? path.join(preparation, "derived-installed.json") :
  "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-62/derived-installation-receipt.json";
const installed = config ? deriveActual(config.actual, config.version) : read(installationFile);
assert.equal(installed.status, "PASS");
assert.equal(installed.version, config?.version ?? "1.9.28");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert.equal(sha(installed.executable.path), installed.executable.sha256);
const player = installed.resources.find(resource =>
  path.basename(resource.path).toLowerCase() === "agentvn-player.exe");
assert(player);
assert.equal(sha(player.path), player.sha256);

const protectedSourceFile = config ?
  path.join(config.qa, `project-directory-preparation-${directoryAttempt}/derived-installed.json`) :
  "F:/AgentVN/QA/Installed-Assets-20261021-01/editor-03/report.json";
const protectedSource = read(protectedSourceFile);
assert.equal(protectedSource.status, "PASS");
assert(Array.isArray(protectedSource.protectedFiles) && protectedSource.protectedFiles.length > 0);
if (config) assert.deepEqual(protectedSource.actualInstallation, config.actual);
const currentProtectedSourceFile = config ? installationFile :
  "F:/AgentVN/QA/Installed-Assets-20261021-01/protected-1.9.28-current.json";
const currentProtectedSource = {
  ...(config ? installed : {}),
  status: "PASS",
  protectionScope: "Fresh file hashes at this invocation, not preservation since historical baseline",
  source: { path: protectedSourceFile, sha256: sha(protectedSourceFile) },
  protectedFiles: protectedSource.protectedFiles.map(file => ({
    ...file,
    sha256: sha(file.path),
    bytes: fs.statSync(file.path).size,
    generatedAt: fs.statSync(file.path).mtime.toISOString(),
  })),
  protectedAbsent: protectedSource.protectedAbsent || [],
};
for (const file of currentProtectedSource.protectedAbsent) assert(!fs.existsSync(file), file);
if (config && action !== "author") {
  if (action !== "--self-test") {
    const retained = read(installationFile);
    assert.deepEqual(retained.actualInstallation, config.actual);
    assert.deepEqual(retained.executable, installed.executable);
    for (const file of retained.protectedFiles) assert.equal(sha(file.path), file.sha256);
    for (const file of retained.protectedAbsent) assert(!fs.existsSync(file), file);
  }
} else if (fs.existsSync(currentProtectedSourceFile)) {
  const existing = JSON.parse(fs.readFileSync(currentProtectedSourceFile, "utf8"));
  if (!config) {
    assert.deepEqual(existing.protectedFiles, currentProtectedSource.protectedFiles);
    assert.deepEqual(existing.source, currentProtectedSource.source);
  } else assert.fail("Never overwrite a candidate preparation");
} else {
  if (config) fs.mkdirSync(preparation, { recursive: false });
  fs.writeFileSync(
    currentProtectedSourceFile,
    `${JSON.stringify(currentProtectedSource, null, 2)}\n`,
    { flag: "wx" },
  );
}

const candidate = {
  current: true,
  editor: { version: installed.version, sha256: installed.executable.sha256 },
  player: { sha256: player.sha256, multiframeVideo: true },
  installationFile,
  protectedSourceFile: currentProtectedSourceFile,
};

const entries = {
  author: [
    "installed-assets-current.cjs",
    "b85d9c42ecec1dc3261a85db368993a1dc1e5fef111cb74eec1d88e78572f38b",
  ],
  player: [
    "installed-assets-current-player.cjs",
    "5a30fa9ab7b55e83aacdf9216e361ed8f50cde02e3c8164b07a4efae3b64e158",
  ],
  "author-audit": [
    "installed-assets-current-audit.cjs",
    "ea742d3e37908506498733d91cd99c57e6cd70c1f07c3f24666495b71da7b389",
  ],
  "player-audit": [
    "installed-assets-current-player-audit.cjs",
    "39d92ff173420968b1697e6adaf1e00c881ba7b543750942c52d746880e216d6",
  ],
};

function adapt(action) {
  const [name, expected] = entries[action];
  const original = path.join(__dirname, name);
  assert.equal(sha(original), expected, `QA business source drift: ${name}`);
  let source = fs.readFileSync(original, "utf8");
  const changes = [];
  const replace = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, `Expected one source match: ${before}`);
    source = source.replace(before, after);
    changes.push({ before, after });
  };

  replace(
    'const candidate = require("./lib/installed-assets-candidate.cjs");',
    `const candidate = Object.freeze(${JSON.stringify(candidate)});`,
  );
  if (config && action === "author") {
    const begin = source.indexOf('  const dialog = page.getByTestId("package-environment-operation-dialog");');
    const end = source.indexOf('  await page.locator(\'[data-help-key="package.mode"]\').click();', begin);
    assert(begin > 0 && end > begin);
    replace(source.slice(begin, end), `  await until(async () => {
    const dialog = page.getByTestId("package-environment-operation-dialog");
    if (await dialog.isVisible()) {
      const phase = await dialog.getAttribute("data-environment-phase");
      if (!["completed", "failed"].includes(phase)) return false;
      report.incidentalEnvironment = { phase, text: await dialog.innerText(), scope: "QA cache Junction, not default environment acceptance" }; save();
      await dialog.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
    }
    try { await page.locator('[data-package-stage="settings"]').click({ timeout: 750 }); } catch { return false; }
    return page.locator('[data-help-key="package.mode"]').isVisible();
  }, "actual installed publishing settings", 180000);
`);
  }
  if (config && action === "player") {
    replace('path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out]',
      'path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"]');
    replace('    if (m.width === 1920 && m.dpr === 1 && !m.reduced || m.width === 3840 && m.dpr === 2 && m.reduced)\n      report.screenshots.push',
      '    report.screenshots.push');
  }
  if (config && ["player", "player-audit"].includes(action)) {
    replace('const { validate } = require("./lib/installed-assets-player-evidence.cjs");',
      'const { validate } = require("./lib/installed-assets-player-evidence.cjs");\n' +
      'const { attributeAudio } = require("./lib/installed-assets-audio-attribution.cjs");');
    const start = source.indexOf(action === "player"
      ? '    const voice = [...new Set(firstAudio.filter'
      : '      const voice = [...new Set(first.filter');
    const end = source.indexOf(action === "player"
      ? '    await cdp.send("Runtime.releaseObjectGroup"'
      : '      assert.deepEqual(c.diagnostics.consoleErrors', start);
    assert(start > 0 && end > start);
    replace(source.slice(start, end), action === "player"
      ? `    const attributed = attributeAudio({ first: firstAudio, later: laterAudio, bgm,
      events: currentCase.mediaEvents, assets: source.cartridge.assets });
    for (const row of attributed) await consumed(row.type, row);
`
      : `      const attributed = attributeAudio({ first, later, bgm, events: c.mediaEvents, assets: r.cartridge.assets });
      for (const row of attributed) {
        const a = c.consumed.find(a => a.type === row.type);
        assert(a); assert.equal(a.src, row.src); assert.equal(a.playerId, row.playerId);
        assert.equal(a.sha256, row.sha256); assert.equal(a.readyState, row.readyState);
        assert(a.readyState >= 2 && a.duration === .8 && !a.error && a.played && a.pipelinePlaying);
      }
`);
  }
  if (config && action === "player-audit") {
    replace('    assert.equal(r.screenshots.length, 2);', '    assert.equal(r.screenshots.length, 12);');
    replace('const bytes = fs.readFileSync(s.path), dpr = Math.round(s.before.dpr);',
      'const bytes = fs.readFileSync(s.path), dpr = s.before.dpr;');
    replace('    validateEditor(e, candidate.editor); assert.equal(sha(r.source.path), r.source.sha256);',
      '    validateEditor(e, candidate.editor); assert.equal(sha(r.source.path), r.source.sha256);\n' +
      '    assert.equal(sha(r.audioAttributionTool.path), r.audioAttributionTool.sha256);\n' +
      '    assert.equal(sha(path.join(source, "audio-attribution.cjs")), r.audioAttributionTool.sha256);');
  }
  const declaration = "const save = () => fs.writeFileSync";
  replace(
    declaration,
    `fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, { flag: "wx" });\n` +
      `fs.writeFileSync(path.join(out, "candidate-adaptations.json"), JSON.stringify(module.qaChanges, null, 2), { flag: "wx" });\n` +
      `report.currentCandidateBinding = ${JSON.stringify({
        installationFile,
        installationSha256: fs.existsSync(installationFile) ? sha(installationFile) : null,
        version: installed.version,
        originalBusiness: { path: original, sha256: expected },
        protectedSource: { path: protectedSourceFile, sha256: sha(protectedSourceFile) },
        actualInstallation: config?.actual,
      })};\n` +
      (config && action === "player"
        ? 'const audioTool = require.resolve("./lib/installed-assets-audio-attribution.cjs");\n' +
          'fs.copyFileSync(audioTool, path.join(out, "audio-attribution.cjs"), fs.constants.COPYFILE_EXCL);\n' +
          'report.audioAttributionTool = desc(audioTool);\n'
        : "") +
      declaration,
  );

  new vm.Script(Module.wrap(source), { filename: __filename });
  let replay = fs.readFileSync(original, "utf8");
  for (const change of changes) {
    assert.equal(replay.split(change.before).length - 1, 1);
    replay = replay.replace(change.before, change.after);
  }
  assert.equal(replay, source);
  return { source, changes };
}

if (action === "--self-test") {
  const transformations = Object.fromEntries(
    Object.keys(entries).map(action => [action, adapt(action).changes.length]),
  );
  console.log(JSON.stringify({
    status: "PASS",
    scope: "CANDIDATE_BINDING_AND_EXECUTED_SOURCE_ARCHIVE_ONLY",
    installation: { version: installed.version, actual: config?.actual,
      sha256: fs.existsSync(installationFile) ? sha(installationFile) : null },
    directoryAttempt,
    transformations,
  }));
} else {
  assert(entries[action], `Unknown action: ${action}`);
  const expectedArgs = action === "author" ? ["12"]
    : action === "player" ? ["12", "07"]
    : action === "author-audit" ? ["12", "02"]
    : ["07", "02"];
  if (!config) assert.deepEqual(process.argv.slice(3), expectedArgs);
  const adapted = adapt(action);
  process.argv = [process.argv[0], __filename,
    ...(config ? action === "player-audit" ? numbers.slice(1) : numbers : expectedArgs)];
  const worker = new Module(__filename, module);
  worker.filename = __filename;
  worker.paths = module.paths;
  worker.qaSource = adapted.source;
  worker.qaChanges = adapted.changes;
  worker._compile(adapted.source, __filename);
}
