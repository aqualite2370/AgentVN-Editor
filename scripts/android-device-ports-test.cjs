"use strict";
const assert = require("node:assert/strict"), net = require("node:net");
const { allocateAndroidDevicePorts } = require("./lib/android-device-ports.cjs");

(async () => {
  const ports = await allocateAndroidDevicePorts(), servers = [];
  assert.equal(ports.length, 4);
  assert.equal(new Set(ports).size, 4);
  try {
    for (const port of ports) {
      const server = net.createServer();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      assert.equal(server.address().port, port, "Actual device ports must be bindable");
    }
  } finally {
    await Promise.all(servers.map(server => server.listening
      ? new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()))
      : Promise.resolve()));
  }
  console.log(JSON.stringify({ status: "PASS", ports, bound: 4, builds: 0, deviceActions: 0 }));
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
