"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { spawn } = require("node:child_process"), { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), step = process.argv[2], out = path.resolve(process.argv[3] || "");
const version = process.argv[4] || "1.9.21";
assert.match(version, /^\d+\.\d+\.\d+$/);
const commands = {
  gamecli: ["powershell.exe", ["-NoProfile", "-Command", "npm --prefix D:\\AgentVN\\GameCli_framework run build; exit $LASTEXITCODE"]],
  dev: ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/build-dev-launcher.ps1")]],
  package: ["cmd.exe", ["/d", "/c", `package-installers.bat editor ${version} --preserve-build-cache`]],
};
assert(commands[step] && process.argv[3] && !fs.existsSync(out));
assert(out.startsWith("F:\\AgentVN\\QA\\"));
fs.mkdirSync(out, { recursive: true });
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const artifact = file => fs.existsSync(file) ? { path: file, sha256: hash(file),
  bytes: fs.statSync(file).size, generatedAt: fs.statSync(file).mtime.toISOString() } : null;
const dev = path.join(root, "AgentVN Dev.exe"), debug = path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe");
const beforeReleases = fs.readdirSync(path.join(root, "releases/editor"));
const [command, args] = commands[step];
const report = { status: "RUNNING", step, command, args, cwd: root, startedAt: new Date().toISOString(),
  beforeDev: artifact(dev), beforeReleases };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
save();
const log = fs.createWriteStream(path.join(out, "command.log"), { flags: "wx" });
const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
report.pid = child.pid; save();
child.stdout.on("data", bytes => { log.write(bytes); process.stdout.write(bytes); });
child.stderr.on("data", bytes => { log.write(bytes); process.stderr.write(bytes); });
child.on("error", error => { report.error = String(error); });
child.on("close", code => {
  try {
    report.exitCode = code; assert.equal(code, 0);
    if (step === "dev") {
      report.dev = artifact(dev); report.debug = artifact(debug);
      assert.equal(report.dev.sha256, report.debug.sha256);
      assert.notEqual(report.dev.sha256, report.beforeDev?.sha256);
      assert(Date.parse(report.dev.generatedAt) >= Date.parse(report.startedAt));
    }
    if (step === "dev" || step === "package") {
      const versions = path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json");
      report.versionMetadata = { ...artifact(versions), value: JSON.parse(fs.readFileSync(versions)) };
      assert.equal(report.versionMetadata.value.editorVersion, version);
      report.player = artifact(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    }
    if (step === "package") {
      report.newInstallers = fs.readdirSync(path.join(root, "releases/editor"))
        .filter(name => !beforeReleases.includes(name)).map(name => artifact(path.join(root, "releases/editor", name)));
      assert.equal(report.newInstallers.length, 1);
      assert(report.newInstallers[0].path.includes(`_v${version}_`) && report.newInstallers[0].path.endsWith(".exe"));
    }
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); log.end();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
