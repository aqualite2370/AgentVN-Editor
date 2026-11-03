"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const sha = p => sha256(fs.readFileSync(p)), read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const run = "D:/AgentVN/output/installed-environment-cache-20261018-01", work = "F:/AgentVN-QA-InstalledEnvironmentCache-20261018-01";
const prep = read(path.join(run, "preparation.json")); assert(prep.profiles.every(p => fs.existsSync(p.held)));
const protectedCache = read(path.join(run, "cache-protection.json")); assert.equal(protectedCache.status, "PASS");
const destination = process.argv[2] || path.join(run, "fixtures.json");
assert.equal(path.dirname(path.resolve(destination)), path.resolve(run)); assert(!fs.existsSync(destination));
const archive = "D:/AgentVN/releases/editor/AgentVN_Editor_v1.9.8_20260925_101446.exe";
assert.equal(sha(archive), "f91118bf15d1f0f76e5628596e61bfd8d981c037d051f6cb6f59f8a5c92ccd42");
const report = { status: "RUNNING", at: new Date().toISOString(), source: { path: archive, sha256: sha(archive) },
  controlledFixturePreparation: true, oldPayloadIsExtractionNotInstallation: true,
  productChanges: 0, realModelRequests: 0, commands: [], error: null,
  tool: { path: __filename, sha256: sha(__filename) } };
try {
  const oldRoot = path.join(work, "original-release-1.9.8-payload"); assert(!fs.existsSync(oldRoot));
  const exe7z = "C:/Program Files/7-Zip/7z.exe";
  const listing = spawnSync(exe7z, ["l", "-slt", "-ba", archive],
    { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(listing.error); assert.equal(listing.status, 0);
  const entries = [...listing.stdout.matchAll(/^Path = (.+)$/gm)].map(m => m[1].trim());
  assert(entries.length > 100);
  for (const p of entries) assert(!/^[\\/]|^[a-z]:|(^|[\\/])\.\.([\\/]|$)/i.test(p), "Unsafe archive path");
  fs.mkdirSync(oldRoot);
  const args = ["x", "-y", `-o${oldRoot}`, archive], extracted = spawnSync(exe7z, args,
    { encoding: "utf8", windowsHide: true, timeout: 120000 });
  const log = path.join(run, "old-payload-extraction.log");
  fs.writeFileSync(log, `${extracted.stdout}\n${extracted.stderr}`, { flag: "wx" });
  report.commands.push({ executable: exe7z, args, exitCode: extracted.status, log, sha256: sha(log) });
  assert.equal(extracted.status, 0, log);
  const oldExe = path.join(oldRoot, "agentvn-editor.exe");
  const oldLaunch = read("D:/AgentVN/output/host-upgrade-20261018-02/old-launch.json");
  assert.equal(sha(oldExe), oldLaunch.executableSha256);
  report.old = { root: oldRoot, exe: oldExe, sha256: sha(oldExe), version: "1.9.8",
    originalInstalledIdentity: oldLaunch.executableSha256, backendSha256: sha(path.join(oldRoot, "creator-backend.exe")) };
  report.current = { root: prep.installRoot, exe: path.join(prep.installRoot, "agentvn-editor.exe"), version: "1.9.9" };
  report.current.sha256 = sha(report.current.exe);
  assert.equal(report.current.sha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
  const project = fixture("installed-environment-cache-isolated-20261018-01");
  project.schema_version = "1.1.0"; project.title = "双版本环境缓存隔离验收";
  project.nodes[0].data.loadingAnimation = { kind: "default" }; project.nodes[0].data.openingAudio = [];
  project.nodes[1].data.scene.commands = [{ type: "narration", text: "QA_ENVIRONMENT_ONLY：不构建、不修复工具链、不调用模型。" }];
  report.input = path.join(work, "环境检测缓存 临时工程.vnproj");
  fs.writeFileSync(report.input, JSON.stringify(project), { flag: "wx" });
  report.inputSha256 = sha(report.input); report.projectId = project.project_id; report.title = project.title;
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, old: report.old, current: report.current, error: report.error }, null, 2));
}
