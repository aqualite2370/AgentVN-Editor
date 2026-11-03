const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { finalizeListening } = require('./android-listening-review.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvn-listening-'));
const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
try {
  fs.mkdirSync(path.join(dir, 'audio'));
  fs.writeFileSync(path.join(dir, 'audio/test.wav'), 'capture');
  fs.writeFileSync(path.join(dir, 'source.apk'), 'apk');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const review = { status: 'PASS', reviewer: 'user', statement: '音频没问题', confirmedAt: new Date().toISOString(),
    runId: 'test', captureSha256: hash('capture'), apkSha256: hash('apk') };
  const runtime = { runId: 'test', stages: { build: 'PASS', runtime: 'PASS', provenance: 'PASS', cleanup: 'PASS', audio: 'BLOCKED' },
    audioCapture: { sha256: review.captureSha256, wavPath: path.join(dir, 'audio/test.wav'), captureComplete: true,
      nonSilent: true, continuous: true, notSustainedClipping: true },
    sourceApk: { path: path.join(dir, 'source.apk'), sha256: review.apkSha256 },
    stagingApk: { path: path.join(dir, 'staging.apk') }, uninstallStatus: 'PASS', apkCleanupStatus: 'PASS', rotationRestoreStatus: 'PASS' };
  write('runtime-smoke-report.json', runtime);
  write('audio/source-comparison.json', { status: 'PASS', captureSha256: review.captureSha256, apkSha256: review.apkSha256 });
  write('cold-boot.json', { emulatorCleanupStatus: 'PASS' });
  const finalized = finalizeListening(dir, review);
  assert.equal(finalized.status, 'RUNTIME_PASS');
  assert.equal(finalized.audioSourceComparison.listeningStatus, 'VERIFIED_BY_USER');
  assert.throws(() => finalizeListening(dir, { ...review, runId: 'other' }), /IDENTITY_MISMATCH/);
  assert.throws(() => finalizeListening(dir, { ...review, reviewer: 'agent' }), /IDENTITY_MISMATCH/);
  fs.writeFileSync(path.join(dir, 'audio/test.wav'), 'changed');
  assert.throws(() => finalizeListening(dir, review), /IDENTITY_MISMATCH/);
  fs.writeFileSync(path.join(dir, 'audio/test.wav'), 'capture');
  runtime.stages.runtime = 'FAILED'; write('runtime-smoke-report.json', runtime);
  assert.equal(finalizeListening(dir, review).status, 'FAILED');
  runtime.stages.runtime = 'PASS'; write('runtime-smoke-report.json', runtime);
  write('cold-boot.json', { emulatorCleanupStatus: 'FAILED' });
  assert.equal(finalizeListening(dir, review).status, 'FAILED');
  write('cold-boot.json', { emulatorCleanupStatus: 'PASS' });
  fs.writeFileSync(path.join(dir, 'staging.apk'), 'residue');
  assert.equal(finalizeListening(dir, review).status, 'FAILED');
  console.log('android-listening-review: PASS (identity, changed capture, runtime failure, cleanup failure, staging residue)');
} finally {
  if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('agentvn-listening-')) throw Error('Unsafe test cleanup');
  fs.rmSync(dir, { recursive: true, force: true });
}
