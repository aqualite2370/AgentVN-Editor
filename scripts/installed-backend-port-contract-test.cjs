const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const launcher = fs.readFileSync(
  path.join(root, "scripts", "launch-installed-options-acceptance.ps1"),
  "utf8",
);
const rust = fs.readFileSync(
  path.join(root, "editor", "src-tauri", "src", "main.rs"),
  "utf8",
);

assert.match(launcher, /\[int\]\$BackendPort = 8278/);
assert.match(launcher, /\$env:AGENTVN_BACKEND_PORT = \[string\]\$BackendPort/);
assert.match(launcher, /dedicated port|独立|专属/i);
assert.match(rust, /AGENTVN_BACKEND_PORT/);
assert.match(rust, /explicit_port/);
assert.match(rust, /parse::<u16>\(\)/);

console.log("installed-backend-port-contract: PASS");
