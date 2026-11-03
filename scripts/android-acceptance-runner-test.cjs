"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const localRequire = createRequire(__filename);
const source = fs.readFileSync(path.join(__dirname, 'android-apk-runtime-qa.cjs'), 'utf8');
const startupStart = source.indexOf("  adbOwned = true;\n  run(['start-server']);");
const startupEnd = source.indexOf("\n  const bootPath = path.join(outputDir, 'cold-boot.json');", startupStart);
assert(startupStart > 0 && startupEnd > startupStart, 'Exercise the actual pre-install ADB handoff');
const startup = source.slice(startupStart, startupEnd);
function harness({ uninstallFailed = false, removeFailed = false, sensorFailed = false, nativeError = null, elevated = true, deviceStates = [] } = {}) {
  const files = new Set([path.resolve('中文验收', 'staging.apk'), path.resolve('用户源.apk')]);
  const calls = [];
  let deviceStateIndex = 0;
  const context = vm.createContext({ require(name) {
    if (name === 'node:fs') return { ...fs, existsSync: p => files.has(p), rmSync(p) { if (removeFailed) throw Error('EPERM staging cleanup'); files.delete(p); } };
    if (name === 'node:child_process') return { spawnSync(command, args, options) {
      calls.push({ command, args, options });
      if (command === 'powershell.exe') return { status: 0, stdout: String(elevated), stderr: '' };
      if (nativeError) return { status: null, error: nativeError, stdout: '', stderr: '' };
      if (args.includes('get-state') && deviceStates.length) {
        const state = deviceStates[Math.min(deviceStateIndex++, deviceStates.length - 1)];
        return state === 'device' ? { status: 0, stdout: 'device\n', stderr: '' }
          : { status: 1, stdout: '', stderr: `error: device ${state}` };
      }
      if (args.includes('sensor') && sensorFailed) return { status: 1, stdout: '', stderr: 'sensor command failed' };
      if (args.includes('uninstall') && uninstallFailed) return { status: 1, stdout: '', stderr: 'DELETE_FAILED_INTERNAL_ERROR' };
      return { status: 0, stdout: 'device', stderr: '* daemon started successfully *' };
    } };
    return localRequire(name);
  }, __dirname, process: { platform: 'win32', pid: 123, argv: ['node', 'qa', '--apk', '用户源.apk', '--package', 'com.test', '--output', '中文验收', '--adb-port', '5049'] }, console, Buffer, setTimeout, clearTimeout, AbortSignal });
  vm.runInContext(source.slice(0, source.indexOf('\nmain().catch(')) + `\nglobalThis.api = { run, waitFor, requireFreePort, isElevated, report, cleanupArtifacts, async startup() { ${startup} }, deviceReady: typeof waitForRuntimeDevice === 'function' ? waitForRuntimeDevice : undefined, adjustSensor() { sensorAdjusted = true; sensorBefore = '0:9.77631:0.812349'; }, own() { report.isElevated = true; stagingApk = require('node:path').resolve('中文验收', 'staging.apk'); stagingCreated = true; installAttempted = true; }, classify: acceptanceStatus };`, context);
  return { api: context.api, files, calls };
}
const healthy = harness();
assert.equal(healthy.api.isElevated(), true);
assert.equal(harness({ elevated: false }).api.isElevated(), false);
assert.equal(healthy.api.run(['get-state']), 'device', 'normal stderr must not turn exit 0 into failure');
assert.ok(healthy.calls.at(-1).args.includes('5049'));
assert.equal(healthy.calls.at(-1).options.timeout, 120000);
for (const code of ['ETIMEDOUT', 'DEVICE_OFFLINE', 'INSTALL_FAILED']) {
  assert.throws(() => harness({ nativeError: Object.assign(Error(code), { code }) }).api.run(['install', 'staging.apk']), new RegExp(code));
}
for (const failure of [{}, { uninstallFailed: true }, { removeFailed: true }]) {
  const h = harness(failure);
  h.api.own();
  h.api.cleanupArtifacts();
  h.api.cleanupArtifacts();
  assert.equal(h.calls.filter(call => call.args.includes('uninstall')).length, 1);
  assert.ok(h.files.has(path.resolve('用户源.apk')), 'source APK must survive every cleanup');
  assert.equal(h.api.report.stages.cleanup, failure.uninstallFailed || failure.removeFailed ? 'FAILED' : 'PASS');
  assert.equal(h.api.report.status, failure.uninstallFailed || failure.removeFailed ? 'FAILED' : 'BLOCKED');
  if (failure.uninstallFailed || failure.removeFailed) assert.ok(h.api.report.cleanupError);
}
const rotation = harness();
rotation.api.own();
rotation.api.report.rotationRestoreStatus = 'FAILED';
rotation.api.cleanupArtifacts();
assert.equal(rotation.api.report.stages.cleanup, 'FAILED', 'rotation restoration is part of mandatory cleanup');
for (const sensorFailed of [false, true]) {
  const h = harness({ sensorFailed });
  h.api.own();
  h.api.adjustSensor();
  h.api.cleanupArtifacts();
  assert.equal(h.api.report.sensorRestoreStatus, sensorFailed ? 'FAILED' : 'PASS');
  assert.equal(h.api.report.stages.cleanup, sensorFailed ? 'FAILED' : 'PASS');
  assert.equal(h.calls.find(call => call.args.includes('sensor')).args.at(-1), '0:9.77631:0.812349',
    'Restore the observed vector, not a fabricated default');
}
const unowned = harness();
unowned.api.report.isElevated = true;
unowned.api.cleanupArtifacts();
assert.equal(unowned.calls.length, 0, 'no uninstall before this run attempted installation');
assert.equal(unowned.files.size, 2, 'unowned staging file must survive');
console.log('android-acceptance-runner: PASS (Chinese paths, native stderr, timeout/offline/install errors, ownership, cleanup failures)');
(async () => {
  const handoff = harness({ deviceStates: ['offline', 'device', 'device'] });
  await handoff.api.startup();
  assert.equal(handoff.api.report.adbReadiness.status, 'PASS');
  assert.equal(handoff.calls.filter(call => call.args.includes('get-state')).length, 3,
    'New ADB transport must recover from offline and become stably online before installation');
  assert.match(handoff.api.report.adbReadiness.observations[0].error, /device offline/,
    'Retain the original transient error as evidence, rather than silently filtering it');
  const denied = harness({ deviceStates: ['unauthorized'] });
  await assert.rejects(denied.api.startup(), /unauthorized/);
  assert.equal(denied.calls.filter(call => call.args.includes('get-state')).length, 1,
    'Authorization failures must not be hidden behind a readiness retry');
  const disconnected = harness({ deviceStates: ['offline'] });
  await assert.rejects(disconnected.api.deviceReady(5, 0), /EMULATOR_NOT_READY.*device offline/);
  assert.equal(disconnected.api.report.adbReadiness.status, 'BLOCKED');
  assert(!disconnected.calls.some(call => call.args.includes('install')),
    'A permanently offline device must never receive an install attempt');
  console.log('android-acceptance-runner: PASS (actual startup handoff, stable readiness, preserved errors, bounded offline, authorization)');
  let navigationAttempts = 0;
  await healthy.api.waitFor({ evaluate: async () => {
    if (navigationAttempts++ === 0) throw Error('Inspected target navigated or closed');
    return true;
  } }, 'true', 'startup navigation');
  assert.equal(navigationAttempts, 2, 'a temporary startup navigation must be retried');
  await assert.rejects(healthy.api.waitFor({ evaluate: async () => { throw Error('Uncaught application failure'); } }, 'true', 'application'), /Uncaught application failure/);
  const server = require('node:net').createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await assert.rejects(healthy.api.requireFreePort(server.address().port), /PORT_OCCUPIED/); }
  finally { await new Promise(resolve => server.close(resolve)); }
  console.log('android-acceptance-runner: PASS (occupied ADB/CDP port is blocked without terminating owner)');
})().catch(error => { console.error(error); process.exitCode = 1; });
