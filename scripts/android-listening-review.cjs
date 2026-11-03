const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { acceptanceStatus } = require('./android-acceptance-evidence.cjs');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function finalizeListening(runDir, review, runtimeReportPath = path.join(runDir, 'runtime-smoke-report.json')) {
  runDir = path.resolve(runDir);
  const reportPath = path.resolve(runtimeReportPath);
  const runtime = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const source = JSON.parse(fs.readFileSync(path.join(runDir, 'audio/source-comparison.json'), 'utf8'));
  const boot = JSON.parse(fs.readFileSync(path.join(runDir, 'cold-boot.json'), 'utf8'));
  const capture = runtime.audioCapture;
  if (review.status !== 'PASS' || review.reviewer !== 'user' || !review.statement || !review.confirmedAt
    || review.runId !== runtime.runId || review.captureSha256 !== capture.sha256
    || review.apkSha256 !== runtime.sourceApk.sha256 || sha(capture.wavPath) !== review.captureSha256
    || sha(runtime.sourceApk.path) !== review.apkSha256) throw Error('LISTENING_REVIEW_IDENTITY_MISMATCH');
  if (source.status !== 'PASS' || source.captureSha256 !== review.captureSha256
    || source.apkSha256 !== review.apkSha256 || !capture.captureComplete || !capture.nonSilent
    || !capture.continuous || !capture.notSustainedClipping) throw Error('AUDIO_OBJECTIVE_EVIDENCE_REQUIRED');
  const stages = { ...runtime.stages, audio: 'PASS' };
  if (runtime.uninstallStatus !== 'PASS' || runtime.apkCleanupStatus !== 'PASS'
    || runtime.rotationRestoreStatus !== 'PASS' || boot.emulatorCleanupStatus !== 'PASS'
    || runtime.cleanupError || fs.existsSync(runtime.stagingApk.path)) stages.cleanup = 'FAILED';
  const finalizedSource = { ...source, listeningStatus: 'VERIFIED_BY_USER' };
  return { schemaVersion: 1, runId: runtime.runId, recordedAt: new Date().toISOString(),
    status: acceptanceStatus(stages), stages, originalReport: { path: reportPath, sha256: sha(reportPath) },
    listeningReview: review, audioSourceComparison: finalizedSource,
    scope: 'Android acceptance only; does not certify the full release matrix',
    cleanup: { uninstallStatus: runtime.uninstallStatus, apkCleanupStatus: runtime.apkCleanupStatus,
      rotationRestoreStatus: runtime.rotationRestoreStatus, emulatorCleanupStatus: boot.emulatorCleanupStatus } };
}
module.exports = { finalizeListening };
if (require.main === module) {
  const [runDir, reviewPath, outputPath, runtimeReportPath] = process.argv.slice(2);
  const result = finalizeListening(runDir, JSON.parse(fs.readFileSync(reviewPath, 'utf8')), runtimeReportPath);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, stages: result.stages, outputPath }));
  if (result.status !== 'RUNTIME_PASS') process.exitCode = 1;
}
