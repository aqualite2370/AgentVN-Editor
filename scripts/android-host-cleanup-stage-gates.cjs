"use strict";
// Native Editor final-cleanup lifecycle gates. No Android build/install here:
// those run later from an actual installation through the elevated entry.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const A = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
const versionProvenance = process.argv.includes("--version-provenance");
const out = path.join(root, versionProvenance ? "output/android-version-provenance-gates" : "output/android-host-cleanup-gates",
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const sources = [
  "editor/src-tauri/src/main.rs", "editor/src-tauri/Cargo.toml", "editor/src-tauri/tauri.conf.json",
  "scripts/build-runtime-standalone-android.ps1", "scripts/android-acceptance-evidence.cjs",
  "scripts/android-installed-cleanup-evidence-audit.cjs", "scripts/android-host-cleanup-stage-gates.cjs",
  "scripts/installed-player-authoring-release.cjs", "scripts/installed-current-android-acceptance.cjs",
  "scripts/installed-android-export-admin.ps1",
  ...(versionProvenance ? ["scripts/android-version-provenance-test.cjs",
    "scripts/android-acceptance-evidence-test.cjs", "GameCli_framework/src-tauri/Cargo.toml",
    "GameCli_framework/src-tauri/tauri.conf.json", "shared/cartridge/constants.ts"] : []),
];
const input = path.join(root, "scripts/fixtures/dialog-presentation-isolated.vnproj");
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(),
  scope: versionProvenance ? "Android game/engine/protocol metadata and native cleanup compatibility; no Editor/Runtime motion changes; not installed acceptance"
    : "Editor native final cleanup and Android artifact evidence; no Editor/Runtime motion changes; not installed acceptance",
  isolatedInput: { path: input, sha256: A.sha256(fs.readFileSync(input)) },
  sourceBefore: sources.map(file => ({ file, sha256: A.sha256(fs.readFileSync(path.join(root, file))) })),
  steps: [],
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
async function run(name, command, args, extra = {}) {
  const step = { name, command: [command, ...args], status: "RUNNING",
    startedAt: new Date().toISOString(), log: path.join(out, `${name}.log`) };
  report.steps.push(step); save(); console.log(`START ${name}`);
  const log = fs.createWriteStream(step.log, { flags: "wx" }); let text = "";
  try {
    const nativeEnv = command.toLowerCase().endsWith("powershell.exe") ? {
      PSModulePath: [path.join(process.env.USERPROFILE, "Documents/WindowsPowerShell/Modules"),
        path.join(process.env.ProgramFiles, "WindowsPowerShell/Modules"),
        path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/Modules")].join(path.delimiter),
    } : {};
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...nativeEnv, AGENTVN_TEST_PROJECT: input,
        AGENTVN_WORKSPACE_OUTPUT: path.join(out, name), ...extra } });
    step.pid = child.pid; save();
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", chunk => { text += chunk; log.write(chunk); });
    step.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    assert.equal(step.exitCode, 0, `${name}\n${text.slice(-4000)}`);
    if (name === "editor-native-all-tests") {
      assert.match(text, /running 67 tests/, "Full native suite must run, not a zero-test filter");
      assert.equal((text.match(/test standalone_evidence_cleanup_tests::.+ \.\.\. ok/g) || []).length, 12);
      const summary = text.match(/test result: ok\. (\d+) passed; 0 failed; (\d+) ignored; 0 measured; 0 filtered out/);
      assert(summary && Number(summary[1]) >= 65 && Number(summary[1]) + Number(summary[2]) === 67);
      step.nativeTests = { passed: Number(summary[1]), ignored: Number(summary[2]),
        ignoredCases: text.split(/\r?\n/).filter(line => /\.\.\. ignored/.test(line)) };
    }
    step.evidence = [...text.matchAll(/Evidence:\s*([^\r\n]+)/g)].map(match => match[1].trim());
    step.status = "PASS"; console.log(`PASS ${name}`);
  } catch (error) { step.status = "FAILED"; step.error = String(error.stack || error); throw error; }
  finally { log.end(); step.finishedAt = new Date().toISOString(); save(); }
}
const node = (name, file, env = {}) => run(name, process.execPath, [`scripts/${file}.cjs`], env);
(async () => {
  await run("editor-native-all-tests", "cargo", ["test", "--manifest-path", "editor/src-tauri/Cargo.toml", "--", "--nocapture"]);
  for (const file of ["android-acceptance-evidence-test", "android-acceptance-runner-test",
    "android-cleanup-behavior-test", "android-build-diagnostics-behavior-test",
    "package-build-result-dialog-contract", "installed-editor-android-export-contract-test",
    "android-diagnostics-bundled-workspace-test"])
    await node(file, file);
  if (versionProvenance) await node("android-version-provenance-test", "android-version-provenance-test");
  await run("editor-typecheck", process.execPath, [npm, "--prefix", path.join(root, "editor"), "run", "typecheck"]);
  await run("editor-build", process.execPath, [npm, "--prefix", path.join(root, "editor"), "run", "build"]);
  await run("gamecli-build", process.execPath, [npm, "--prefix", path.join(root, "GameCli_framework"), "run", "build"]);
  await node("editor-workspace-contract", "editor-workspace-contract");
  await node("editor-workspace-real-browser", "editor-workspace-playwright");
  const dev = path.join(root, "AgentVN Dev.exe"), before = fs.statSync(dev).mtimeMs;
  await run("full-dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/build-dev-launcher.ps1")]);
  report.dev = { path: dev, sha256: A.sha256(fs.readFileSync(dev)),
    compiledSha256: A.sha256(fs.readFileSync(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"))),
    overwritten: fs.statSync(dev).mtimeMs > before, modifiedAt: fs.statSync(dev).mtime.toISOString(),
    pending: fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")) };
  assert(report.dev.overwritten && !report.dev.pending); assert.equal(report.dev.sha256, report.dev.compiledSha256);
  report.sourceAfter = report.sourceBefore.map(row => ({ ...row,
    unchanged: A.sha256(fs.readFileSync(path.join(root, row.file))) === row.sha256 }));
  assert(report.sourceAfter.every(row => row.unchanged));
  report.bundled = ["scripts/build-runtime-standalone-android.ps1", "scripts/android-acceptance-evidence.cjs",
    ...(versionProvenance ? ["GameCli_framework/src-tauri/Cargo.toml", "shared/cartridge/constants.ts"] : [])].map(file => ({
    file, sha256: A.sha256(fs.readFileSync(path.join(root, file))),
    bundledSha256: A.sha256(fs.readFileSync(path.join(root, "editor/src-tauri/bundle-workspace", file))),
  }));
  assert(report.bundled.every(row => row.sha256 === row.bundledSha256));
  report.status = versionProvenance ? "ANDROID_VERSION_PROVENANCE_SOURCE_DEV_PASS" : "ANDROID_HOST_CLEANUP_SOURCE_DEV_PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); console.error(report.error); process.exitCode = 1;
}).finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${out}`); });
