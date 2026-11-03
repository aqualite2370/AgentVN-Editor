"use strict";
// Build once after the exact historical failure is repaired; retain each stage.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = path.resolve("F:/AgentVN/QA/Original-Component-Replay-20261103-01");
const [mode, attempt = "01"] = process.argv.slice(2), version = "1.9.40";
assert(["gates", "dev", "release", "resources", "install"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `${mode}-${attempt}`); assert(!fs.existsSync(out));
// Installer itself creates its fresh journal directory.
if (mode !== "install") fs.mkdirSync(out);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sources = ["GameCli_framework/src/components/shell/RenpyTitleView.tsx", "shared/cartridge/renpyTitleControls.ts"]
  .map(file => desc(path.join(root, file)));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), mode, version,
  scope: "ORIGINAL_COMPONENT_MENU_REPAIR_CANDIDATE_NOT_FULL_PRODUCT_ACCEPTANCE",
  sources, commands: [], paidRequests: 0, beforeDev: desc(path.join(root, "AgentVN Dev.exe")) };
const reportFile = mode === "install" ? path.join(qa, `install-command-${attempt}.json`) : path.join(out, "report.json");
assert(!fs.existsSync(reportFile));
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
function verifySources() { for (const item of sources) assert.equal(sha(item.path), item.sha256); }
function prior(name) {
  const file = path.join(qa, name, "report.json"), data = read(file);
  assert.equal(data.status, "PASS"); assert(data.commands.length && data.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  assert.deepEqual(data.sources, sources);
  for (const c of data.commands) assert.equal(sha(c.log.path), c.log.sha256);
  report[name] = desc(file); return data;
}
async function command(name, executable, args) {
  const logFile = mode === "install" ? path.join(qa, `install-command-${attempt}.log`) : path.join(out, `${name}.log`);
  const fd = fs.openSync(logFile, "wx"), item = { name, executable, args, cwd: root, status: "RUNNING",
    startedAt: new Date().toISOString() };
  report.commands.push(item); save(); console.log("START " + name);
  try {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
    item.pid = child.pid; save();
    item.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(item.exitCode, 0, logFile); item.status = "PASS";
  } catch (e) { item.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); item.log = desc(logFile); item.finishedAt = new Date().toISOString(); save(); }
  console.log("PASS " + name);
}
(async () => {
  for (const file of ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/tauri.conf.json"])
    assert.equal(read(path.join(root, file)).version, version);
  assert.equal(read(path.join(root, "editor/package-lock.json")).packages[""].version, version);
  for (const file of ["editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock"])
    assert(new RegExp(`name = "agentvn-editor"\\r?\\nversion = "${version.replace(/\./g, "\\.")}"`).test(
      fs.readFileSync(path.join(root, file), "utf8")));
  const browserFile = path.join(qa, "browser-02/report.json"), browser = read(browserFile);
  assert.equal(browser.status, "PASS"); assert.equal(browser.matrix.length, 12); assert.equal(browser.cleanup, "PASS");
  for (const item of browser.sources) assert.equal(sha(item.path), item.sha256);
  report.directBrowser = desc(browserFile);
  if (mode === "gates") {
    await command("placement-regression", process.execPath, ["scripts/renpy-title-navigation-placement-test.cjs"]);
    await command("title-text-and-export", process.execPath, ["scripts/renpy-title-text-runtime-test.cjs"]);
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    for (const [name, project, action] of [
      ["editor-typecheck", "editor", "typecheck"], ["editor-build", "editor", "build"],
      ["gamecli-build", "GameCli_framework", "build"],
    ]) await command(name, process.execPath, [npm, "--prefix", project, "run", action]);
  } else if (mode === "dev") {
    prior("gates-01");
    await command("complete-dev-launcher", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.dev = desc(path.join(root, "AgentVN Dev.exe"));
    assert.notEqual(report.dev.sha256, report.beforeDev.sha256);
    assert(Date.parse(report.dev.modifiedAt) >= Date.parse(report.startedAt));
    assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert.equal(read(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json")).editorVersion, version);
  } else if (mode === "release") {
    prior("gates-01"); prior("dev-01");
    await command("exe-only-contract", process.execPath, ["scripts/exe-only-installers-test.cjs", path.join(out, "exe-contract")]);
    await command("editor-exe-package", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/package-installers.ps1"), "-Target", "editor", "-Version", version,
      "-ReleaseRoot", "releases/component-menu-1940-20261103-01", "-ExpectedRoot", root, "-SkipClean"]);
    const folder = path.join(root, "releases/component-menu-1940-20261103-01/editor"), files = fs.readdirSync(folder);
    assert.equal(files.filter(name => name.endsWith(".exe")).length, 1); assert(!files.some(name => name.endsWith(".msi")));
    const installer = path.join(folder, files.find(name => name.endsWith(".exe")));
    fs.copyFileSync(installer, path.join(out, path.basename(installer)), fs.constants.COPYFILE_EXCL);
    report.installer = desc(path.join(out, path.basename(installer)));
    report.releaseExe = desc(path.join(root, "editor/src-tauri/target/release/agentvn-editor.exe"));
  } else if (mode === "resources") {
    prior("release-01");
    await command("actual-installer-resources", process.execPath, ["scripts/editor-installer-resources-acceptance.cjs",
      path.join(out, "payload"), version, path.join(qa, "release-01")]);
    const payloadFile = path.join(out, "payload/installer-resource-report.json");
    assert.equal(read(payloadFile).status, "PASS"); report.payload = desc(payloadFile);
  } else {
    prior("resources-01");
    await command("actual-isolated-nsis-install", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/player-aspect-install-session.ps1"),
      "-ResourceReport", path.join(qa, "resources-01/payload/installer-resource-report.json"),
      "-RunRoot", path.join(qa, `installation-${attempt}`), "-ExpectedVersion", version, "-AllowedRunRoot", qa]);
    report.installation = desc(path.join(qa, `installation-${attempt}/installation.json`));
    assert.equal(read(report.installation.path).status, "PASS");
  }
  verifySources(); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, mode, out, error: report.error })); });
