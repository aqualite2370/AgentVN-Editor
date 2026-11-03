"use strict";
// Build accounting for the interaction repair. Dev publication is explicitly gated.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { qa, summary } = require("./native-assistant-interaction.cjs");
const root = path.resolve(__dirname, "..");
const load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: f, sha256: sha(f), bytes: fs.statSync(f).size, modifiedAt: fs.statSync(f).mtime.toISOString() });
async function main() {
  const name = process.argv[2], iteration = process.argv[3], audit = process.argv[4];
  assert(/^gates-\d{2}$/.test(name) && /^\d{2}$/.test(iteration) && /^audit-\d{2}$/.test(audit));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const evidence = path.join(qa, `session-${iteration}/report.json`), receipt = path.join(qa, audit, "receipt.json");
  const r = { at: new Date().toISOString(), status: "RUNNING", steps: [],
    behavior: describe(evidence), audit: describe(receipt), before: describe(path.join(root, "AgentVN Dev.exe")) };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  async function command(label, script) {
    const step = { label, command: script, startedAt: new Date().toISOString(), status: "RUNNING" };
    r.steps.push(step); save();
    const file = path.join(out, `${label}.log`), log = fs.openSync(file, "wx");
    console.log(`START ${label}`);
    try {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `$ErrorActionPreference='Stop'; ${script}; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}`],
      { cwd: root, windowsHide: true, stdio: ["ignore", log, log], env: { ...process.env,
        AGENTVN_TEST_PROJECT: load(path.join(summary, "preparation.json")).input.path,
        AGENTVN_WORKSPACE_OUTPUT: out } });
      step.pid = child.pid; save();
      step.code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
      assert.equal(step.code, 0, `${label} failed; see ${file}`);
      step.status = "PASS"; console.log(`PASS ${label}`);
    } finally {
      fs.closeSync(log); step.log = describe(file); step.finishedAt = new Date().toISOString(); save();
    }
  }
  try {
    const b = load(evidence), a = load(receipt);
    assert.equal(b.status, "CURRENT_NATIVE_INTERACTION_PASS");
    assert.equal(a.status, "CURRENT_INTERACTION_EVIDENCE_VERIFIED");
    assert.equal(a.report.sha256, sha(evidence));
    for (const f of b.sources) assert.equal(sha(f.path), f.sha256);
    await command("typecheck", "npm --prefix D:\\AgentVN\\editor run typecheck");
    await command("editor-build", "npm --prefix D:\\AgentVN\\editor run build");
    await command("gamecli-build", "npm --prefix D:\\AgentVN\\GameCli_framework run build");
    await command("workspace-contract", "node scripts/editor-workspace-contract.cjs");
    await command("dev-build", "& powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1");
    const dev = describe(path.join(root, "AgentVN Dev.exe"));
    const built = describe(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
    assert.equal(dev.sha256, built.sha256);
    assert(fs.statSync(dev.path).mtimeMs >= Date.parse(r.steps.find(s => s.label === "dev-build").startedAt),
      "Root Dev must actually be copied this run, not merely scheduled");
    r.dev = dev; r.built = built; r.hashChanged = dev.sha256 !== r.before.sha256;
    r.sameHashMeaning = "Frontend-only repair can leave native debug bytes identical; source hashes and real copy time are recorded separately.";
    const bundle = "editor/src-tauri/bundle-workspace";
    r.bundledSourceChecks = [];
    for (const f of b.sources) assert.equal(sha(f.path), f.sha256, "Build must not change tested product source");
    // The standalone workspace contains the player, not Editor frontend sources.
    for (const relative of ["GameCli_framework/src/components/player/DialogBox.tsx",
      "shared/cartridge/uiSkin.ts", "GameCli_framework/src/styles/shell.css"]) {
      const target = path.join(root, bundle, relative);
      assert(fs.existsSync(target), `Missing bundled source ${target}`);
      assert.equal(sha(target), sha(path.join(root, relative)), relative);
      r.bundledSourceChecks.push(describe(target));
    }
    const version = path.join(root, bundle, "build-versions.json");
    assert.equal(load(version).editorVersion, load(path.join(root, "editor/src-tauri/tauri.conf.json")).version);
    r.bundledSourceChecks.push(describe(version));
    r.player = describe(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    r.status = "BUILD_GATES_AND_ACTUAL_DEV_COPY_PASS";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; console.error(r.error); }
  finally { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, dev: r.dev })); }
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
