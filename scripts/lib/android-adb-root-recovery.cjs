"use strict";
const assert = require("node:assert/strict");
async function recoverOwnedRootTransport(result, restartOwnedServer, verifySameBootAndRoot) {
  let mode = "ROOT_COMMAND_SUCCEEDED";
  if (result.status !== 0) {
    assert.match(String(result.stdout), /^(?:\s*|restarting adbd as root\s*)$/i);
    const closed = /^adb: unable to connect for root: closed\s*$/i.test(String(result.stderr).trim());
    if (!closed) assert.match(String(result.stderr), /timeout expired while waiting for device/i);
    await restartOwnedServer();
    mode = closed ? "RECOVERED_OWNED_SERVER_AFTER_ROOT_TRANSPORT_CLOSED"
      : "RECOVERED_OWNED_SERVER_AFTER_ROOT_RESTART_TIMEOUT";
  }
  await verifySameBootAndRoot();
  return mode;
}
module.exports = { recoverOwnedRootTransport };
