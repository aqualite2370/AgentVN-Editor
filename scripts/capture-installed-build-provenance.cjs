const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
assert(process.argv[2] && process.argv[3], "usage: node script <installed-run-directory> <build-cache-directory>");
const runRoot = path.resolve(process.argv[2]);
const cache = path.resolve(process.argv[3]);
const state = JSON.parse(fs.readFileSync(path.join(runRoot, "installed-processes.json"), "utf8"));
const installation = JSON.parse(fs.readFileSync(path.join(runRoot, "installer-resource-report.json"), "utf8"));
assert(installation.deployments.some(item => item.installedRoot === state.installRoot));
const workspace = path.join(cache, "build-workspace");
const output = path.join(runRoot, `build-provenance-${path.basename(cache)}.json`);
assert(!fs.existsSync(output), "never replace earlier provenance");
async function describe(file) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  const stat = fs.statSync(file);
  return { path: file, sha256: digest.digest("hex"), bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(), capturedAt: new Date().toISOString() };
}
async function main() {
  const files = ["build-versions.json", "GameCli_framework/src-tauri/src/lib.rs", "shared/cartridge/uiSkin.ts"];
  const helpers = JSON.parse(fs.readFileSync(path.join(__dirname, "standalone-build-scripts.json"), "utf8")).scripts;
  files.push(...helpers.map(name => `scripts/${name}`));
  const report = { status: "RUNNING", installationRoot: state.installRoot, workspace, files: [] };
  for (const relative of files) {
    const installed = await describe(path.join(state.installRoot, relative));
    const staged = await describe(path.join(workspace, relative));
    // The workspace version writer is allowed to normalize JSON whitespace.
    const identical = relative === "build-versions.json"
      ? JSON.parse(fs.readFileSync(installed.path, "utf8")).editorVersion === JSON.parse(fs.readFileSync(staged.path, "utf8")).editorVersion
      : installed.sha256 === staged.sha256;
    assert(identical, `installation/workspace mismatch: ${relative}`);
    report.files.push({ relative, installed, staged, identical });
  }
  const cartridge = fs.readdirSync(cache).filter(name => name.endsWith(".vncart"));
  assert.equal(cartridge.length, 1);
  report.cartridge = await describe(path.join(cache, cartridge[0]));
  report.layout = await describe(path.join(workspace, "GameCli_framework/src-tauri/resources/embedded-cartridge/ui/layout.json"));
  report.note = "Timestamps describe captured files, not inferred source creation or ZIP entry times. This proves selected installed/staged inputs, not a completed build or runtime pass.";
  report.optimization = JSON.parse(fs.readFileSync(path.join(cache, "diagnostics/release-optimization-report.json"), "utf8"));
  report.status = "INPUTS_VERIFIED";
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(`PASS ${report.files.length} installed/staged file comparisons; cartridge and layout hashes saved: ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
