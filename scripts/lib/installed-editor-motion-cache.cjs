"use strict";
// Extend only the current candidate's exact motion-run boundary. Historical
// profile-protection code stays unchanged; execute an archived local copy.
const assert = require("node:assert/strict");
const path = require("node:path");
function buildCache(original) {
  const candidate = process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
    ? require("./candidate-1924-quick-adapter.cjs").quickCandidate() : null;
  const allowedRoot = path.resolve(candidate?.base || "F:/AgentVN/QA/Editor-1.9.30-20261026-01");
  assert.match(allowedRoot, /^F:\\AgentVN\\QA\\Editor-\d+\.\d+\.\d+-\d{8}-\d{2}$/);
  let source = original; const adaptations = [];
  function one(before, after, reason) {
    assert.equal(source.split(before).length - 1, 1, reason);
    source = source.replace(before, () => after); adaptations.push({ before, after, reason });
  }
  one("    if(!$validEditor -and !$validDiagnostic",
    `    $validCurrentMotion=$allowedRoot -ceq '${allowedRoot}' -and $parent -ceq $allowedRoot -and $leaf -match '^editor-motion-\\d{2}$'\n` +
    "    if(!$validCurrentMotion -and !$validEditor -and !$validDiagnostic",
    "Allow only current candidate exact editor-motion leaf, no arbitrary or nested root");
  const boundaryLoop = "    foreach($test in $tests){\n        $valid=$true;try{Boundary $test[0]}catch{$valid=$false}";
  one(boundaryLoop,
    `    if($allowedRoot -ceq '${allowedRoot}'){\n` +
    "        $tests += @(@((Join-Path $allowedRoot 'editor-motion-02'),$true),\n" +
    "          @((Join-Path $allowedRoot 'editor-motion-02\\nested'),$false),\n" +
    "          @((Join-Path $allowedRoot 'editor-motion-two'),$false),\n" +
    "          @(($allowedRoot+'-other\\editor-motion-02'),$false))\n" +
    "    }\n" + boundaryLoop,
    "Run real original PowerShell boundary suite plus current motion positive/negative cases");
  return { source, adaptations };
}
module.exports = { buildCache };
