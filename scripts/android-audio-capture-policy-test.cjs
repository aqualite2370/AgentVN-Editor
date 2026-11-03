"use strict";
const assert = require('node:assert/strict');
const { captureProcessTimeoutMs } = require('./android-audio-capture-policy.cjs');
assert.equal(captureProcessTimeoutMs(8), 163_000, '8-second capture must outlive the slow emulator gRPC deadline and report write');
assert.equal(captureProcessTimeoutMs(30), 485_000);
assert.throws(() => captureProcessTimeoutMs(0), /positive/);
console.log('android-audio-capture-policy: PASS (parent timeout outlives slow emulator gRPC capture)');
