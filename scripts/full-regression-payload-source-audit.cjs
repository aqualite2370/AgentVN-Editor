"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const [candidateArg, payloadArg, outArg] = process.argv.slice(2);
assert(candidateArg && payloadArg && outArg && !fs.existsSync(outArg),
  "Pass frozen manifest, payload audit, fresh evidence JSON");
const candidate = JSON.parse(fs.readFileSync(candidateArg, "utf8"));
const payload = JSON.parse(fs.readFileSync(payloadArg, "utf8"));
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "REAL_PACKAGE_SOURCE_BYTES_NOT_INSTALLED_RUNTIME_OR_UPGRADE",
  candidate: path.resolve(candidateArg), payload: path.resolve(payloadArg), deployments: [] };
async function hash(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
(async () => {
  assert.equal(candidate.status, "PASS"); assert.equal(payload.status, "PASS");
  assert.equal(candidate.version, payload.version);
  const frozenInstallers = candidate.artifacts.filter(row => /[\\/]installers[\\/]/.test(row.frozen.path));
  assert.equal(frozenInstallers.length, 3);
  assert.deepEqual(payload.installers.map(row => row.sha256).sort(),
    frozenInstallers.map(row => row.frozen.sha256).sort());
  assert.equal(payload.deployments.length, 3);
  const sources = candidate.source.map(row => ({ ...row, relative: path.relative(root, row.path) }))
    .filter(row => /^(GameCli_framework[\\/](src[\\/]|src-tauri[\\/]src[\\/])|shared[\\/])/.test(row.relative));
  assert(sources.length > 0, "Reject empty source matrix");
  for (const deployment of payload.deployments) {
    const item = { kind: deployment.kind, root: deployment.installedRoot, files: [] };
    report.deployments.push(item);
    for (const source of sources) {
      const file = path.resolve(deployment.installedRoot, source.relative);
      assert(file.startsWith(path.resolve(deployment.installedRoot) + path.sep));
      const digest = await hash(file);
      item.files.push({ relative: source.relative, actual: digest, expected: source.sha256 });
      assert.equal(digest, source.sha256, `Frozen/source payload mismatch: ${deployment.kind}/${source.relative}`);
    }
    for (const runtime of deployment.runtimeProvenance) {
      const frozen = candidate.artifacts.find(row => path.basename(row.frozen.path) === runtime.name);
      assert(frozen && runtime.sha256 === frozen.frozen.sha256, "Sidecar not from frozen candidate");
    }
    item.status = "PASS";
  }
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(outArg, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out: outArg,
    deployments: report.deployments.map(row => ({ kind: row.kind, files: row.files.length })),
    error: report.error }));
});
