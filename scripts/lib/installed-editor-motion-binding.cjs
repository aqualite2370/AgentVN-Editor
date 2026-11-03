"use strict";
// Shared current-candidate provenance for the complete Editor collector and owner.
const assert = require("node:assert/strict"), path = require("node:path");
const { validateInstallation } = require("../candidate-1930-exit.cjs");
const candidate = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
  ? require("./candidate-1924-quick-adapter.cjs").quickCandidate() : null;
const version = candidate?.version || "1.9.30";
const installationFile = path.resolve(candidate?.installation ||
  "F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json");
function motionBinding(args) {
  const candidates = args.filter(a => a.startsWith("--candidate="));
  if (!candidates.length) return undefined;
  assert.equal(candidates.length, 1, "Select one candidate");
  assert.equal(candidates[0], `--candidate=${version}`);
  const receipts = args.filter(a => a.startsWith("--installed="));
  assert.equal(receipts.length, 1, "Current candidate requires exactly one explicit installation");
  assert.equal(path.resolve(receipts[0].slice("--installed=".length)), installationFile);
  const installation = validateInstallation(installationFile);
  return { installationFile, installation, version, qa: candidate?.base || path.dirname(installationFile) };
}
function validateMotionPreparation(prep) {
  assert.equal(prep.candidateVersion, version);
  const binding = motionBinding([
    `--candidate=${prep.candidateVersion}`, `--installed=${prep.installationFile}`,
  ]);
  const run = path.resolve(prep.run);
  assert.equal(path.dirname(run), binding.qa);
  assert.match(path.basename(run), /^editor-motion-\d{2}$/);
  assert.equal(path.resolve(prep.launch.executable), path.resolve(binding.installation.executable.path));
  assert.equal(prep.launch.executableSha256, binding.installation.executable.sha256);
  return true;
}
module.exports = { motionBinding, validateMotionPreparation };
