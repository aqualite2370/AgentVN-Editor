"use strict";
// One reviewed inventory, not a blanket exception for credentials in tests.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const inventory = "F:/AgentVN/QA/Git-Content-Review-20261103-01/inventory-01/report.json";
const output = "F:/AgentVN/QA/Git-Content-Review-20261103-01/review-01.json";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const approved = [
  ["scripts/current-knowledge-closure.cjs", 299, "c945cee67a385e1e54e3b3938778102bfb642064f9777061e92759e05f16444b", "local-controlled"],
  ["scripts/current-novel-prompt-privacy-audit.cjs", 66, "61e3934656cf7d797cd39923bf2413ddcfce49c4c1603d1b63ae7e3ee752bc5a", "privacy-sentinel"],
  ["scripts/installed-controlled-inquiry-guard-test.cjs", 10, "1e1e62eac32c023fa157589b962cb5f139e744fc801d095fd8871453748b0207", "local-controlled"],
  ["scripts/installed-controlled-inquiry-guard-test.cjs", 30, "1e1e62eac32c023fa157589b962cb5f139e744fc801d095fd8871453748b0207", "rejected-dummy"],
  ["scripts/installed-controlled-provider-guard-test.cjs", 9, "2b8c1253b94bf1570f80ffdffde8a0d4479409c27d6fa4f647fef2cb9975dcdb", "local-controlled"],
  ["scripts/lib/editor-profile-upgrade-flow.cjs", 64, "9c323dbb66e5f70cab9f0493b425e08b015271feb3df1a5d3676f452703e4944", "local-controlled"],
  ["scripts/lib/renpy-official-android-flow.cjs", 188, "522dcd5279222e114766bed28219bfdb9a91f7baf6a055ffe17a76ab82669ef1", "rejected-url"],
  ["scripts/novel-processing-backend-perf-audit.cjs", 168, "2a2016d3c26b9990ae278f7a163b150235808f9d0d309706cc1a240b1493afe2", "performance-sentinel"],
  ["scripts/packaged-backend-api-acceptance.cjs", 172, "83a9c108adfc5e2a0117a49b2cb52b04dde1de6b4e3d5af8946969d93e840463", "local-controlled"],
  ["scripts/packaged-creation-authorization.cjs", 191, "08dd9dd05b2e5a507459faa644c4471d85574c523c75fbb40066eab0bb92ebee", "local-controlled"],
  ["scripts/packaged-creation-cross-process.cjs", 141, "757afeb7ebca6c2e17ede577be643a3cde12ed4f64b50fa8327e2b6c68014ded", "local-controlled"],
];
const reasons = {
  "local-controlled": ["5629f2f8ed7be4f2be69f9988b9211803c27ab707de79e60ec5cf4000c596a26",
    "Fixed test-only token for loopback controlled-provider/guard specimens; no user credential."],
  "privacy-sentinel": ["37bfa69874bb4c6a5d1b3159cd6a598c42e95231e804a9b4bcae13f3959c0999",
    "Mnemonic synthetic marker in pure AST-extracted prompt test; no provider/network execution."],
  "rejected-dummy": ["3429b5b899b0351af307f451b4f33e2378124c300865c1573080071853141ed1",
    "Mnemonic dummy token in explicit guard-denial case; no HTTP request."],
  "rejected-url": ["a28b8176f57374f4f478f28ad1530d57fff8e37cdb58a74e5146350154124e29",
    "Fictional user/password URL in a managed-resource rejection test; not an actual endpoint credential."],
  "performance-sentinel": ["a2da4074aabb745579cc61013097cafe443614dd6483dfc9c8e7f8ae10a9f1fd",
    "Mnemonic do-not-return marker on example.invalid in isolated performance/serialization fixture."],
};
function validate(report) {
  assert.equal(report.findings.length, approved.length);
  assert.deepEqual(report.errors, []);
  return report.findings.map(f => {
    const row = approved.find(a => a[0] === f.relative && a[1] === f.line); assert(row);
    assert.equal(report.files.find(x => x.relative === row[0])?.sha256, row[2]);
    assert.equal(sha(fs.readFileSync(path.join(root, row[0]))), row[2]);
    const [fingerprint, reason] = reasons[row[3]]; assert.equal(f.fingerprint, fingerprint);
    return { relative: f.relative, line: f.line, rule: f.rule, fingerprint,
      sourceSha256: row[2], classification: "REVIEWED_SYNTHETIC_TEST_LITERAL", reason };
  });
}
module.exports = { validate };
if (require.main === module) {
  assert(!fs.existsSync(output));
  const original = JSON.parse(fs.readFileSync(inventory, "utf8"));
  const reviewed = validate(original);
  const variants = [
    r => { r.findings.push({ ...r.findings[0], line: 1 }); },
    r => { r.findings[0].fingerprint = "0".repeat(64); },
    r => { r.findings[0].relative = "backend/app/main.py"; },
    r => { r.files.find(x => x.relative === approved[0][0]).sha256 = "0".repeat(64); },
    r => { r.findings.pop(); },
  ];
  for (const change of variants) { const value = structuredClone(original); change(value); assert.throws(() => validate(value)); }
  const report = { status: "PASS", scope: "EXACT_ELEVEN_REVIEWED_FINDINGS_NOT_FULL_SOURCE_OR_HISTORY_AUDIT",
    at: new Date().toISOString(), source: { path: inventory, sha256: sha(fs.readFileSync(inventory)) },
    reviewed, rejectedVariants: variants.length, originalReportPreserved: true,
    productChanges: 0, paidRequests: 0, stagedPaths: 0, pushes: 0 };
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, reviewed: reviewed.length, rejectedVariants: variants.length, output }));
}
