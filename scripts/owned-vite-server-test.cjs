const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

(async () => {
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, "127.0.0.1", resolve));
  const port = occupied.address().port;
  const options = {
    root: path.resolve(__dirname, "../GameCli_framework"),
    configFile: path.resolve(__dirname, "../GameCli_framework/vite.config.cjs"),
    port,
  };
  try {
    await assert.rejects(startOwnedViteServer(options), /in use|EADDRINUSE|occupied/i,
      "occupied port must fail without connecting to or killing another service");
    assert.equal(occupied.listening, true, "an unrelated listener must remain running");
  } finally {
    await new Promise(resolve => occupied.close(resolve));
  }
  const owner = await startOwnedViteServer({ ...options, port: 0 });
  let other;
  try {
    await owner.assertAlive();
    assert.equal((await fetch(owner.url)).status, 200);
    other = await startOwnedViteServer({ ...options, port: 0 });
    await other.assertAlive();
    assert.notEqual(owner.url, other.url, "independent runs must not collapse port 0 onto Vite's shared default port");
    await assert.rejects(other.run(async () => {
      await other.stop();
      return new Promise(() => {});
    }), /exited during acceptance/, "early service exit must interrupt a pending UI step immediately");
    await owner.stop();
    await assert.rejects(owner.assertAlive(), /exit|stop|live/i,
      "a terminated owned process must not count as a healthy service");
  } finally {
    await other?.stop();
    await owner.stop();
  }
  console.log("owned-vite-server-test: PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
