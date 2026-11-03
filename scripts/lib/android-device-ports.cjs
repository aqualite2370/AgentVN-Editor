"use strict";
// QA only: this is the exact allocator used before Android device elevation.
const assert = require("node:assert/strict");
const { freePort } = require("./windows-portable-qa-utils.cjs");

async function allocateAndroidDevicePorts() {
  const ports = new Set();
  while (ports.size < 4) {
    const port = await freePort();
    assert(Number.isInteger(port) && port > 1024 && port <= 65535);
    ports.add(port);
  }
  return [...ports];
}

module.exports = { allocateAndroidDevicePorts };
