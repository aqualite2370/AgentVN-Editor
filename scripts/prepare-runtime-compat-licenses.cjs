"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const runtime = path.resolve(__dirname, "..", "GameCli_framework");
const manifest = JSON.parse(fs.readFileSync(path.join(runtime, "package.json"), "utf8"));
const destination = path.join(runtime, "dist", "third-party-licenses");
assert(fs.existsSync(path.join(runtime, "dist", "index.html")), "必须先生成实际 Runtime 产物");
fs.mkdirSync(destination, { recursive: true });
for (const [dependency, output] of [
  ["core-js-pure", "core-js-pure.txt"],
  ["@juggle/resize-observer", "resize-observer.txt"],
]) {
  const directory = path.join(runtime, "node_modules", dependency);
  const installed = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  assert.equal(installed.version, manifest.dependencies[dependency], "兼容层依赖版本必须与锁定配置一致");
  fs.copyFileSync(path.join(directory, "LICENSE"), path.join(destination, output));
  console.log(`Bundled license: ${dependency}@${installed.version}`);
}
