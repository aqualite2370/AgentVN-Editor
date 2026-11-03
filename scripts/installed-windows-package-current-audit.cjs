"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { validateBuildEvidence } = require("./lib/windows-package-current-evidence.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Windows-Package-20261021-01", out = path.join(base, "build-audit-01");
fs.mkdirSync(out); const file = path.join(base, "editor-01/report.json");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const r = read(file), report = { status: "RUNNING", at: new Date().toISOString(), source: { path: file, sha256: sha(file) } };
(async () => {
  Object.assign(report, validateBuildEvidence(r));
  for (const f of [...r.artifacts, r.cartridge, ...r.protectedFiles, r.installation])
    assert.equal(sha(f.path), f.sha256, f.path);
  // The collector snapshots, not subsequently edited working-tree QA tools,
  // are the executable evidence for this historical run.
  for (const f of r.tools) assert.equal(sha(path.join(base, "editor-01", path.basename(f.path))), f.sha256);
  const installation = read(r.installation.path);
  report.installedVersions = { path: path.join(installation.installRoot, "build-versions.json") };
  assert.equal(read(report.installedVersions.path).editorVersion, "1.9.16");
  report.installedVersions.sha256 = sha(report.installedVersions.path);
  const zip = await JSZip.loadAsync(fs.readFileSync(r.cartridge.path), { checkCRC32: true });
  const portable = r.artifacts.find(a => a.kind === "windows_portable_exe");
  const embedded = path.join(path.dirname(portable.path), "embedded-cartridge");
  report.embedded = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    assert(!name.split(/[\\/]/).includes("..") && !path.isAbsolute(name));
    const file = path.join(embedded, name), expected = await entry.async("nodebuffer");
    assert.deepEqual(fs.readFileSync(file), expected, name);
    report.embedded.push({ name, bytes: expected.length, sha256: sha(file) });
  }
  assert(report.embedded.some(f => f.name === "script.json"));
  assert(report.embedded.some(f => f.name === "ui/layout.json" && f.sha256 === r.cartridge.layoutSha256));
  report.portablePE = JSON.parse(ps(`$v=(Get-Item -LiteralPath '${portable.path}').VersionInfo;` +
    `@{fileVersion=$v.FileVersion;productVersion=$v.ProductVersion;productName=$v.ProductName}|ConvertTo-Json -Compress`));
  assert.equal(report.portablePE.fileVersion, "1.0.0"); assert.equal(report.portablePE.productName, r.cartridge.manifest.title);
  report.packageCacheRestoration = read(path.join(base, "editor-01/package-cache-restoration.json"));
  report.environmentCacheRestoration = read(path.join(base, "editor-01/native-cache-restoration.json"));
  assert.equal(report.packageCacheRestoration.status, "PASS"); assert.equal(report.environmentCacheRestoration.status, "PASS");
  assert.deepEqual(fs.readdirSync(path.join(base, "editor-01/package-cache")), []);
  const live = rows(), all = [...r.knownProcesses, ...r.buildKnownProcesses];
  assert(!all.some(p => live.some(n => p.ProcessId === n.ProcessId && p.Created === n.Created)));
  assert.equal(listeners(r.cleanups.flatMap(c => c.ports)).length, 0);
  report.ownedProcessIdentities = new Set(all.map(p => `${p.ProcessId}:${p.Created}`)).size;
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2)); });
