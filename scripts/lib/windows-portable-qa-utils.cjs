"use strict";
const net = require("node:net");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
function copyDirectory(source, destination) {
  assert(!fs.existsSync(destination), "Never replace an existing QA directory");
  assert(fs.lstatSync(source).isDirectory() && !fs.lstatSync(source).isSymbolicLink());
  fs.mkdirSync(destination);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), "Do not follow resource links");
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else { assert(entry.isFile()); fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); }
  }
}
module.exports = { freePort, copyDirectory };
