"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Windows-Isolated-1944-20261108-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p) });
const release = read("F:/AgentVN/QA/Novel-Range-Release-1954-20261108-02/report.json");
assert.equal(release.status, "BUILD_AND_PAYLOAD_PASS_INSTALLATION_PENDING_LIVE_DEV_PRESERVED");
assert(!fs.existsSync(base)); fs.mkdirSync(base);
const harness = path.join(base, "harness");
fs.mkdirSync(path.join(harness, "scripts"), { recursive: true }); fs.mkdirSync(path.join(base, "jobs"));
const copies = [];
for (const name of ["windows-isolated-account-controller.ps1", "windows-isolated-account-child.ps1",
  "animation-install-1945.ps1", "audit-installed-editor-marker.cjs", "novel-outline-installed-1953.cjs"]) {
  const source = path.join(root, "scripts", name), target = path.join(harness, "scripts", name);
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); copies.push({ source, ...desc(target) });
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
const fixture = read("F:/AgentVN/QA/Novel-Outline-Ranges-Browser-20261108-03/fixture-1.vnproj");
fixture.project_id = "qa-installed-outline-1954"; fixture.title = "安装版章节范围与断点恢复";
fs.writeFileSync(path.join(base, "fixture.vnproj"), JSON.stringify(fixture), { flag: "wx" });
for (const record of [release.installer, release.payload]) assert.equal(sha(record.path), record.sha256);
fs.writeFileSync(path.join(base, "candidate.json"), JSON.stringify({
  version: "1.9.54", installer: release.installer, payloadReport: release.payload, payload: [],
}, null, 2), { flag: "wx" });
fs.writeFileSync(path.join(base, "staging.json"), JSON.stringify({
  status: "PASS", copies, packages: [...packages.values()], credentialsWritten: false,
}, null, 2), { flag: "wx" });
const runner = path.join(harness, "scripts/novel-outline-installed-1953.cjs");
fs.writeFileSync(path.join(base, "jobs/job-01.json"), JSON.stringify({
  script: runner, sha256: sha(runner), arguments: [path.resolve(base)],
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "STAGED", base }));
