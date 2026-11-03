"use strict";
const assert = require('node:assert/strict');
const { compareCapturedAudio } = require('./android-audio-evidence.cjs');
const capture = { captureComplete: true, nonSilent: true, continuous: true,
  notSustainedClipping: true, wavPath: 'capture.wav', sha256: 'capture-hash' };
const expected = { status: 'PASS', apkSha256: 'apk-hash', captureSha256: 'capture-hash',
  assetId: '愿', sourceSha256: 'source-hash', correlation: 0.996, listeningStatus: 'NOT_VERIFIED' };
const base = { apkPath: 'source.apk', apkSha256: 'apk-hash', capture, assetId: '愿', outputDir: 'audio',
  spawn: () => ({ status: 0 }), readReport: () => expected };
assert.equal(compareCapturedAudio(base).sourceComparisonStatus, 'PASS');
assert.equal(compareCapturedAudio(base).status, 'BLOCKED', 'listening remains required');
assert.equal(compareCapturedAudio({ ...base, assetId: undefined }).sourceComparisonStatus, 'BLOCKED');
assert.equal(compareCapturedAudio({ ...base, spawn: () => ({ status: 1, stderr: 'decode error' }) }).sourceComparisonStatus, 'BLOCKED');
assert.equal(compareCapturedAudio({ ...base, readReport: () => ({ ...expected, apkSha256: 'different' }) }).sourceComparisonStatus, 'FAILED');
assert.equal(compareCapturedAudio({ ...base, readReport: () => ({ ...expected, captureSha256: 'different' }) }).sourceComparisonStatus, 'FAILED');
assert.equal(compareCapturedAudio({ ...base, capture: { ...capture, captureComplete: false } }).sourceComparisonStatus, 'BLOCKED');
assert.equal(compareCapturedAudio({ ...base, readReport: () => ({ ...expected, status: 'BLOCKED', correlation: 0.4 }) }).sourceComparisonStatus, 'BLOCKED');
console.log('android-audio-evidence: PASS (exact run hashes, source identity, capture failure, listening gate)');
