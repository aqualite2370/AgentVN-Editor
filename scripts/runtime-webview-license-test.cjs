"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = process.argv[2] ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "..", "GameCli_framework");
for (const [dependency, name] of [
  ["core-js-pure", "core-js-pure.txt"],
  ["@juggle/resize-observer", "resize-observer.txt"],
]) {
  const source = fs.readFileSync(path.join(root, "node_modules", dependency, "LICENSE"));
  const output = fs.readFileSync(path.join(root, "dist", "third-party-licenses", name));
  assert(source.equals(output), `生产产物必须完整保留 ${dependency} 许可证`);
  console.log(`PASS ${dependency} ${crypto.createHash("sha256").update(output).digest("hex")}`);
}
