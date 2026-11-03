const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bundledRuntime = path.join(
  root,
  "editor",
  "src-tauri",
  "bundle-workspace",
  "GameCli_framework",
);

function requiredFile(...segments) {
  const filePath = path.join(bundledRuntime, ...segments);
  assert.ok(fs.existsSync(filePath), `Bundled standalone dependency file is missing: ${filePath}`);
  return filePath;
}

requiredFile("node_modules", "lucide-react", "dist", "cjs", "lucide-react.js");
requiredFile("node_modules", "lucide-react", "dist", "lucide-react.d.ts");
requiredFile("node_modules", "sharp", "dist", "index.cjs");

const sharpProbe = spawnSync(
  process.execPath,
  ["-e", "require(process.argv[1]); console.log('sharp-ready')", path.join(bundledRuntime, "node_modules", "sharp")],
  {
    cwd: bundledRuntime,
    encoding: "utf8",
    windowsHide: true,
  },
);
assert.equal(
  sharpProbe.status,
  0,
  `Bundled sharp must be loadable.\nstdout:\n${sharpProbe.stdout}\nstderr:\n${sharpProbe.stderr}`,
);

const buildCommand = process.platform === "win32" ? "cmd.exe" : "npm";
const buildArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", "npm run build"]
  : ["run", "build"];
const build = spawnSync(buildCommand, buildArgs, {
  cwd: bundledRuntime,
  encoding: "utf8",
  windowsHide: true,
});
assert.equal(
  build.status,
  0,
  `Bundled GameCLI workspace must compile without reinstalling dependencies.\nerror:\n${build.error ?? ""}\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`,
);

console.log("PASS bundled standalone workspace preserves and loads runtime dependency distributions");
