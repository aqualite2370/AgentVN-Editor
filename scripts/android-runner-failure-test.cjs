const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, 'build-runtime-standalone-android.cjs'), 'utf8');
for (const failure of ['script', 'spawn', 'empty', 'manifest']) {
  const files = new Map();
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const fakeFs = { ...fs, mkdirSync() {}, appendFileSync() {},
    readFileSync(p) { if (!files.has(p)) throw Error('ENOENT'); return files.get(p); },
    writeFileSync(p, value) { files.set(p, value); },
  };
  const fakeProcess = { platform: 'win32', env: {},
    argv: ['node', 'runner', '--OutputDir', 'test-output', '--DiagnosticsDir', 'test-diag', '--CartridgePath', 'test.vncart', '--ReleaseIdentity', '{}', '--RunId', 'failure-test'],
    stdout: { write() {} }, stderr: { write() {} },
  };
  vm.runInNewContext(source, { require: n => n === 'node:fs' ? fakeFs : n === 'node:child_process' ? { spawn: () => child } : require(n), __dirname, process: fakeProcess, Buffer, console });
  if (failure === 'manifest') {
    files.set(path.resolve('test-diag', 'package-build-manifest.json'), JSON.stringify({ status: 'BLOCKED', failureCode: 'SPECIFIC_BUILD_FAILURE', runId: 'failure-test' }));
    child.emit('close', 1, null);
    assert.equal(JSON.parse(files.get(path.resolve('test-diag', 'package-build-manifest.json'))).failureCode, 'SPECIFIC_BUILD_FAILURE', 'existing structured reports must be preserved');
    continue;
  }
  if (failure === 'spawn') {
    child.emit('error', Error('spawn powershell ENOENT'));
    child.emit('close', -4058, null);
  }
  else {
    if (failure === 'script') child.stderr.emit('data', Buffer.from('Cannot set property isElevated: property does not exist.'));
    child.emit('close', failure === 'script' ? 1 : 0, null);
  }
  const manifest = JSON.parse(files.get(path.resolve('test-diag', 'package-build-manifest.json')) || '{}');
  assert.equal(manifest.status, 'FAILED', `${failure}: child failures need a diagnostic manifest`);
  assert.equal(manifest.runId, 'failure-test');
  assert.equal(manifest.failureCode, failure === 'spawn' ? 'ANDROID_RUNNER_START_FAILED' : 'ANDROID_RUNNER_FAILED');
  assert.equal(fakeProcess.exitCode, 1);
  if (failure === 'script') assert.match(manifest.message, /Cannot set property isElevated/);
}
console.log('PASS Android runner preserves script/spawn/missing-manifest failures');
