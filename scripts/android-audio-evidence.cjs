"use strict";
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function compareCapturedAudio({ apkPath, apkSha256, capture, assetId, outputDir, python = 'python',
  spawn = spawnSync, readReport = file => JSON.parse(fs.readFileSync(file, 'utf8')) }) {
  const result = { status: 'BLOCKED', sourceComparisonStatus: 'BLOCKED', listeningStatus: 'NOT_VERIFIED' };
  if (!assetId || !capture?.captureComplete || !capture.nonSilent || !capture.continuous || !capture.notSustainedClipping) {
    return { ...result, reason: 'VALID_CAPTURE_AND_RUNTIME_ASSET_REQUIRED' };
  }
  const reportPath = path.join(outputDir, 'source-comparison.json');
  const command = spawn(python, [path.join(__dirname, 'compare-android-audio.py'), '--apk', apkPath,
    '--capture', capture.wavPath, '--asset-id', assetId, '--output', reportPath],
  { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  if (command.error || command.status !== 0) return { ...result, reason: 'SOURCE_COMPARISON_UNAVAILABLE',
    error: String(command.error || command.stderr || command.stdout), exitCode: command.status };
  try {
    const evidence = readReport(reportPath);
    if (evidence.apkSha256 !== apkSha256 || evidence.captureSha256 !== capture.sha256 || evidence.assetId !== assetId) {
      return { ...result, sourceComparisonStatus: 'FAILED', reason: 'AUDIO_EVIDENCE_IDENTITY_MISMATCH', evidence };
    }
    return { ...result, sourceComparisonStatus: evidence.status, evidence, reportPath,
      reason: evidence.status === 'PASS' ? 'LISTENING_REQUIRED' : 'SOURCE_COMPARISON_INCONCLUSIVE' };
  } catch (error) { return { ...result, reason: 'SOURCE_REPORT_UNAVAILABLE', error: String(error) }; }
}

module.exports = { compareCapturedAudio };
