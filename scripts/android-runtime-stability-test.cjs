"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const source = fs.readFileSync(`${__dirname}/android-apk-runtime-qa.cjs`, 'utf8');
const context = vm.createContext({ require: createRequire(__filename), __dirname, process, console, Buffer,
  setTimeout: callback => { callback(); return 1; }, clearTimeout, AbortSignal });
vm.runInContext(source.slice(0, source.indexOf('\nmain().catch(')) + `
  let iteration = 0;
  report.viewport = { physical: { width: 2400, height: 1080 } };
  run = args => args.includes('pidof') ? '100' : args.includes('meminfo') ? 'TOTAL PSS: ' + (100000 + iteration++ * 1000) : 'ok';
  captureScreenshot = name => { const file=require('node:path').join(outputDir,name+'.png'); require('node:fs').mkdirSync(outputDir,{recursive:true}); require('node:fs').writeFileSync(file,'image'); return file; };
  delay = async () => {};
  globalThis.exercise = exerciseRuntimeStability;
  globalThis.report = report;
`, context);
(async () => {
  const cdp = { call: async () => ({ documents: 2, nodes: 410, jsEventListeners: 188 }) };
  await context.exercise(cdp);
  assert.equal(context.report.runtimeStability.status, 'PASS');
  assert.equal(context.report.runtimeStability.samples.length, 7);
  assert.equal(context.report.runtimeStability.durationSeconds, 60);
  console.log('android-runtime-stability: PASS (seven samples, bounded DOM/listeners, non-monotonic-growth contract)');
})().catch(error => { console.error(error); process.exitCode = 1; });
