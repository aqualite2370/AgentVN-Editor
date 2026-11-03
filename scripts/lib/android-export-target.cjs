"use strict";
// Explicit final-project authorization is separate from the small-fixture guard.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const A = require("./installed-acceptance.cjs");
const { loadProjectContainerSync } = require("../project-container.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
function checked(file, hash) {
  assert.equal(A.sha256(fs.readFileSync(file)), hash, `FINAL_PROOF_HASH_MISMATCH: ${file}`);
}
function validateExportTarget({ title, proofFile, projectFile, sessionRoot }) {
  assert(title, "PROJECT_TITLE_REQUIRED");
  if (title !== "隐忍的成长") {
    assert(!proofFile, "FINAL_PROOF_SCOPE_MISMATCH");
    return { scope: "isolated-project", title };
  }
  assert(proofFile, "FINAL_PROJECT_PROOF_REQUIRED");
  const proof = read(proofFile);
  assert.equal(proof.status, "FINAL_HIDDEN_GROWTH_AUTHORIZED");
  assert(projectFile && sessionRoot);
  assert.equal(path.resolve(projectFile), path.resolve(proof.projectFile));
  assert.equal(path.resolve(sessionRoot), path.resolve(proof.sessionRoot));
  assert(A.inside(sessionRoot, projectFile) && A.inside(sessionRoot, proofFile));
  const provenance = read(proof.inputProvenance.path);
  checked(proof.inputProvenance.path, proof.inputProvenance.sha256);
  assert.equal(provenance.sourceSha256, "e1c43983ae8b7488c080c55889727d38915602596d873180e6062fff5a3df250");
  assert(provenance.graphPreserved && provenance.sourcePreserved);
  checked(provenance.source, provenance.sourceSha256);
  checked(provenance.output, provenance.outputSha256); checked(projectFile, provenance.outputSha256);
  const windows = read(proof.windowsTerminal.path); checked(proof.windowsTerminal.path, proof.windowsTerminal.sha256);
  assert.equal(windows.status, "INSTALLED_FINAL_WINDOWS_TERMINAL_AUDIT_PASS");
  assert.equal(windows.checks.length, 5); assert(windows.checks.every(c => c.status === "PASS"));
  const runtime = windows.checks[0].evidence.runtime, exported = windows.checks[0].evidence.export;
  checked(runtime.path, runtime.sha256); checked(exported.path, exported.sha256);
  const resource = read(exported.path);
  assert.equal(resource.assets.length, 143);
  assert.equal(resource.inputProvenance.sha256, proof.inputProvenance.sha256);
  const project = loadProjectContainerSync(projectFile).project;
  assert.equal(project.project_id, "project_msiz08p7_0_89ebc8a8cb"); assert.equal(project.title, title);
  assert.equal(project.nodes.length, 19); assert.equal(project.edges.length, 21);
  assert.equal(project.asset_manifest.length, 143);
  return { scope: "final-hidden-growth", title, projectId: project.project_id, assets: 143,
    provenance, resource, proof: { path: proofFile, sha256: A.sha256(fs.readFileSync(proofFile)) } };
}
module.exports = { validateExportTarget };
