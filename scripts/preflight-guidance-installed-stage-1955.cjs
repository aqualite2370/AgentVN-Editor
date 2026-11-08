"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const attempt = process.argv[2] || "10"; assert(["10", "11"].includes(attempt));
const root = path.resolve(__dirname, ".."), base = `F:/AgentVN/QA/Windows-Isolated-1944-20261108-${attempt}`;
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const release = read("F:/AgentVN/QA/Preflight-Guidance-Release-1955-20261108-01/report.json");
assert.equal(release.status, "BUILD_AND_PAYLOAD_PASS_INSTALLATION_PENDING_LIVE_DEV_PRESERVED");
assert.equal(release.version, "1.9.55");
assert(!fs.existsSync(base)); fs.mkdirSync(base);
const harness = path.join(base, "harness"), copies = [];
fs.mkdirSync(path.join(harness, "scripts"), { recursive: true }); fs.mkdirSync(path.join(base, "jobs"));
for (const name of ["windows-isolated-account-controller.ps1", "windows-isolated-account-child.ps1",
  "animation-install-1945.ps1", "audit-installed-editor-marker.cjs", "preflight-guidance-installed-1955.cjs"]) {
  const source = path.join(root, "scripts", name), target = path.join(harness, "scripts", name);
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(target)); copies.push({ source, ...desc(target) });
}
fs.cpSync(path.join(root, "scripts/lib"), path.join(harness, "scripts/lib"), { recursive: true, force: false });
const modules = path.join(harness, "editor/node_modules"), packages = new Map();
function pkg(name, from) {
  if (packages.has(name) || name === "fsevents") return;
  const file = require.resolve(name + "/package.json", { paths: [from] }), source = path.dirname(file);
  const metadata = read(file), target = path.join(modules, name);
  fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: true,
    filter: f => { assert(!fs.lstatSync(f).isSymbolicLink()); return true; } });
  packages.set(name, { name, version: metadata.version, ...desc(path.join(target, "package.json")) });
  for (const dep of Object.keys(metadata.dependencies || {})) pkg(dep, source);
}
pkg("playwright", path.join(root, "editor")); pkg("jszip", path.join(root, "editor"));
const fixture = read("F:/AgentVN/QA/Preflight-Optional-Guidance-20261108-01/browser-02/可选素材测试.vnproj");
fixture.project_id = "qa-installed-preflight-guidance-1955"; fixture.title = "安装版七类可选素材建议";
fs.writeFileSync(path.join(base, "fixture.vnproj"), JSON.stringify(fixture), { flag: "wx" });
for (const record of [release.installer, release.payload]) assert.equal(sha(record.path), record.sha256);
fs.writeFileSync(path.join(base, "candidate.json"), JSON.stringify({
  version: "1.9.55", installer: release.installer, payloadReport: release.payload, payload: [],
}, null, 2), { flag: "wx" });
const runner = path.join(harness, "scripts/preflight-guidance-installed-1955.cjs");
execFileSync(process.execPath, ["--check", runner], { windowsHide: true });
fs.writeFileSync(path.join(base, "staging.json"), JSON.stringify({
  status: "PASS", copies, packages: [...packages.values()], credentialsWritten: false,
  fixturePreparation: "SUPPORTED_PROJECT_IMPORT_API_NOT_NATIVE_PICKER_ACCEPTANCE",
}, null, 2), { flag: "wx" });
fs.writeFileSync(path.join(base, "jobs/job-01.json"), JSON.stringify({
  script: runner, sha256: sha(runner), arguments: [path.resolve(base)],
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "STAGED", base, packages: packages.size }));
