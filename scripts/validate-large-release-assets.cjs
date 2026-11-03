const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const cartridgePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, ".playwright-cli", "project-1781025691934-0-1-0.vncart");
const tempRoot = path.join(root, ".tmp");
fs.mkdirSync(tempRoot, { recursive: true });
const outputDir = fs.mkdtempSync(path.join(tempRoot, "progressive-release-"));

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`Command failed with ${result.status ?? result.signal}: node ${args.join(" ")}`);
  }
}

console.log(`VALIDATION_ROOT=${outputDir}`);
run([path.join(root, "scripts", "unpack-vncart.cjs"), cartridgePath, outputDir]);
run([
  path.join(root, "scripts", "build-release-runtime-assets.cjs"),
  outputDir,
  "--profile",
  "balanced",
  "--report",
  path.join(outputDir, "release-optimization-report.json"),
]);

const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(outputDir, "startup-index.json"), "utf8"));
const report = JSON.parse(fs.readFileSync(path.join(outputDir, "release-optimization-report.json"), "utf8"));
console.log(JSON.stringify({
  ok: true,
  outputDir,
  assets: manifest.assets.length,
  indexedFiles: Object.keys(index.files).length,
  titleAssets: index.titleAssets.length,
  entrySceneAssets: index.entrySceneAssets.length,
  originalMiB: Number((report.originalBytes / 1024 / 1024).toFixed(2)),
  resultMiB: Number((report.resultBytes / 1024 / 1024).toFixed(2)),
  savedMiB: Number((report.savedBytes / 1024 / 1024).toFixed(2)),
  optimizedAssets: report.assets.filter((item) => item.status === "optimized").length,
  keptAssets: report.assets.filter((item) => item.status === "kept-original").length,
  warnings: report.warnings,
}, null, 2));
