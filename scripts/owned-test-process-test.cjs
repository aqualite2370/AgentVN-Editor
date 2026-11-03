const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { stopOwnedTestProcess } = require('./owned-test-process.cjs');
(async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  await stopOwnedTestProcess(child);
  assert.ok(child.stdout.destroyed && child.stderr.destroyed, 'inherited output handles cannot retain the acceptance process');
  assert.notEqual(child.exitCode, null);
  await stopOwnedTestProcess(child);
  assert.throws(() => stopOwnedTestProcess({ pid: process.pid }), /owned child/);
  console.log('owned-test-process: PASS (real owned child exit, pipe release, idempotence, no arbitrary pid)');
})().catch(error=>{ console.error(error);process.exitCode=1; });
