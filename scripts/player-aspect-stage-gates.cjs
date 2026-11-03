"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), [browserReport, output, ...flags] = process.argv.slice(2);
const out = path.resolve(output || "");
assert(browserReport && out.toLowerCase().startsWith("f:\\agentvn\\qa\\") && !fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({ file: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const report = { status: "RUNNING", scope: "CURRENT_PLAYER_ASPECT_SOURCE_GATES",
  startedAt: new Date().toISOString(), commands: [], modelRequests: 0 };
fs.copyFileSync(__filename, path.join(out, "executed-gates.cjs"), fs.constants.COPYFILE_EXCL);
report.testIdentity = describe(path.join(out, "executed-gates.cjs"));
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function execute(name, exe, args) {
  const item = { name, command: [exe, ...args], cwd: root, startedAt: new Date().toISOString(),
    log: path.join(out, `${name}.log`), status: "RUNNING" };
  report.commands.push(item); save(); console.log(`START ${name}`);
  const fd = fs.openSync(item.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
    item.pid = child.pid; save();
    item.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(item.exitCode, 0, `Gate failed: ${item.log}`);
    item.status = "PASS";
  } catch (error) { item.status = "FAILED"; throw error; }
  finally { fs.closeSync(fd); item.finishedAt = new Date().toISOString(); item.logIdentity = describe(item.log); save(); console.log(`${item.status} ${name}`); }
}
function inspectBrowser(file) {
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(r.status, "PASS"); assert.equal(r.cleanup, "PASS");
  assert(r.testIdentity); assert.equal(sha(r.testIdentity.file), r.testIdentity.sha256);
  assert.equal(r.smoke, false); assert.equal(r.isolationOnly, false);
  assert.equal(r.cases.length, 30); assert.deepEqual(r.errors, []);
  const cases = r.cases.filter(c => c.name === "player-ratio-title-settings-story-reload-reset");
  assert.equal(cases.length, 26);
  for (const type of ["agentvn", "renpy"]) {
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const c = cases.find(c => c.type === type && c.width === width && c.dpr === dpr && c.reduced === reduced && !c.mobile);
      assert(c && c.status === "PASS" && c.height === width * 9 / 16);
      assert.deepEqual(c.choices.map(choice => choice.ratio), ["16:9", "16:10", "4:3"]);
      for (const choice of c.choices) {
        assert.equal(choice.value.viewport.width, width);
        assert.equal(choice.value.viewport.dpr, dpr);
        assert.equal(choice.value.viewport.reduced, reduced);
        assert.equal(choice.geometry.length, 4); assert(choice.geometry.every(g => g.hit));
      }
    }
    assert(cases.some(c => c.type === type && c.mobile && c.width === 2400));
    assert(r.cases.some(c => c.type === type && c.name === "actual-ui-A-B-A-isolation-and-independent-reset"
      && c.browserProcessRestart === true && Object.keys(c.both).length === 2));
    const shared = r.cases.find(c => c.type === type && c.name.startsWith("shared-install-"));
    assert(shared && shared.identities.length === 4
      && shared.identities.every(i => i.installId === "preview_gamecli")
      && shared.identities[0].gameId !== shared.identities[1].gameId);
  }
  assert.equal(r.screenshots.length, 8);
  for (const shot of r.screenshots) {
    assert.equal(sha(shot.file), shot.sha256);
    const bytes = fs.readFileSync(shot.file);
    assert.equal(bytes.readUInt32BE(16), shot.w * shot.dpr);
    assert.equal(bytes.readUInt32BE(20), shot.h * shot.dpr);
  }
  for (const [file, expected] of Object.entries(r.sourceHashes)) assert.equal(sha(path.join(root, file)), expected);
  for (const input of r.inputs) {
    assert.equal(sha(input.file), input.sha256); assert.equal(sha(input.second), input.secondSha256);
  }
  return { identity: describe(file), browserCases: r.cases.length, screenshots: r.screenshots.length,
    sources: r.sourceHashes, scope: r.scope };
}
(async () => {
  save();
  report.browser = inspectBrowser(browserReport); save();
  for (const name of ["player-aspect-preferences-test", "game-viewport-ratios-test",
    "gamecli-preferences-contract", "runtime-layout-profiles-test"])
    await execute(name, process.execPath, [`scripts/${name}.cjs`]);
  for (const [project, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
    await execute(`${project}-${task}`, "cmd.exe", ["/d", "/c", `npm --prefix ${project} run ${task}`]);
  report.dev = { status: "NOT_RUN" };
  if (flags.includes("--dev")) {
    const targets = ["AgentVN Dev.exe", "GameCli_framework/src-tauri/target/release/agentvn-player.exe",
      "editor/src-tauri/binaries/agentvn-player.exe"];
    const before = path.join(out, "before-dev"); fs.mkdirSync(before);
    report.beforeDev = [];
    for (let i = 0; i < targets.length; i++) {
      const source = path.join(root, targets[i]);
      if (!fs.existsSync(source)) continue;
      const snapshot = path.join(before, `${i}-${path.basename(source)}`);
      fs.copyFileSync(source, snapshot, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(snapshot)); report.beforeDev.push({ ...describe(source), snapshot });
    }
    save();
    await execute("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
    const dev = describe(path.join(root, "AgentVN Dev.exe"));
    const compiled = describe(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
    assert.equal(dev.sha256, compiled.sha256);
    assert(new Date(dev.modifiedAt) >= new Date(report.startedAt), "Dev executable was not actually overwritten");
    const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
    const bundled = collectStageResourceEvidence(root, Object.keys(report.browser.sources));
    const player = describe(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe"));
    const previewResource = describe(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(player.sha256, previewResource.sha256);
    report.dev = { status: "PASS", dev, compiled, player, previewResource, bundled,
      scope: "BUILT_NOT_NATIVE_BEHAVIOR_OR_INSTALLED_ACCEPTANCE" };
  }
  inspectBrowser(browserReport);
  assert(report.commands.length >= 7 && report.commands.every(c => c.status === "PASS"));
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = error.stack; console.error(error);
  process.exitCode = 1;
}).finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(`Report: ${path.join(out, "report.json")}`); });
