"use strict";
// Read either retained installation evidence schema without manufacturing an
// installation or treating an extracted installer payload as an installed app.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function verifiedInstalledCandidate(file) {
  file = path.resolve(file);
  const raw = read(file);
  assert.equal(raw.status, "PASS", "Installation evidence must pass");
  if (!raw.deployments) {
    assert.equal(raw.metadataRestoration, "PASS", "Legacy installation metadata must be restored");
    assert(samePath(raw.executable.path, path.join(raw.installRoot, "agentvn-editor.exe")));
    assert.equal(sha(raw.executable.path), raw.executable.sha256);
    for (const resource of raw.resources ?? []) {
      const relative = path.relative(raw.installRoot, resource.path);
      assert(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative), "Resource must stay inside the recorded installation");
      assert.equal(sha(resource.path), resource.sha256);
    }
    return { ...raw, sourceReceipt: { path: file, sha256: sha(file), schema: "legacy installation" } };
  }
  const installed = raw.deployments.filter(item => item.kind === "NSIS actual isolated installation");
  assert.equal(installed.length, 1, "Require one actual installation, never payload-only evidence");
  const deployment = installed[0], actual = read(deployment.installationReport);
  assert.equal(actual.status, "PASS");
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.registryRestored, true);
  assert(samePath(actual.installRoot, deployment.installedRoot));
  assert(samePath(actual.executable.path, deployment.executable.path));
  assert(samePath(actual.executable.path, path.join(actual.installRoot, "agentvn-editor.exe")));
  assert.equal(actual.executable.sha256, deployment.executable.sha256);
  assert.equal(sha(actual.executable.path), actual.executable.sha256);
  const installer = raw.installers.find(item => item.sha256 === actual.installer.sha256);
  assert(installer && samePath(installer.path, actual.installer.path), "Installer identity mismatch");
  const payloads = raw.deployments.filter(item => item.kind === "NSIS actual payload"
    && item.executable.sha256 === actual.executable.sha256);
  assert.equal(payloads.length, 1);
  const resources = ["creator-backend.exe", "agentvn-player.exe"].map(name => {
    const expected = payloads[0].runtimeProvenance.find(item => item.name === name);
    assert(expected, `Missing bundled provenance for ${name}`);
    const resource = { path: path.join(actual.installRoot, name), sha256: expected.sha256 };
    assert.equal(sha(resource.path), expected.sha256, `Installed ${name} differs from payload`);
    assert.equal(raw.runtimeCandidate.find(item => item.name === name)?.sha256, expected.sha256);
    return resource;
  });
  return {
    status: raw.status, installRoot: actual.installRoot,
    executable: { ...actual.executable, version: raw.version }, resources,
    registryRestored: actual.registryRestored,
    sourceReceipt: { path: file, sha256: sha(file), schema: "resource audit plus actual NSIS install",
      actualInstallation: { path: deployment.installationReport, sha256: sha(deployment.installationReport) } },
  };
}
module.exports = { verifiedInstalledCandidate };
