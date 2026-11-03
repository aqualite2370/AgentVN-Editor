"use strict";
// Build/publication only after the real default flow and independent audit pass.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { qa, summary } = require("./native-novel-default.cjs");
const root = path.resolve(__dirname, ".."), load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const describe = f => ({ path: f, bytes: fs.statSync(f).size,
  sha256: crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"), modifiedAt: fs.statSync(f).mtime.toISOString() });
async function main() {
  const [name, iteration, audit] = process.argv.slice(2);
  assert(/^gates-\d{2}$/.test(name) && /^\d{2}$/.test(iteration) && /^audit-\d{2}$/.test(audit));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const evidence = path.join(qa, `session-${iteration}/report.json`), receipt = path.join(qa, audit, "receipt.json");
  const r = { at: new Date().toISOString(), status: "RUNNING", steps: [],
    behavior: describe(evidence), audit: describe(receipt), before: describe(path.join(root, "AgentVN Dev.exe")) };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  async function command(label, script) {
    const s = { label, command: script, status: "RUNNING", startedAt: new Date().toISOString() };
    r.steps.push(s); save(); console.log(`START ${label}`);
    const file = path.join(out, `${label}.log`), fd = fs.openSync(file, "wx");
    try {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `$ErrorActionPreference='Stop'; ${script}; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}`], {
        cwd: root, windowsHide: true, stdio: ["ignore", fd, fd], env: { ...process.env, PYTHONIOENCODING: "utf-8",
          AGENTVN_TEST_PROJECT: load(path.join(summary, "preparation.json")).input.path,
          AGENTVN_WORKSPACE_OUTPUT: out },
      });
      s.pid = child.pid; save();
      s.code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
      assert.equal(s.code, 0, `${label} failed: ${file}`);
      s.status = "PASS"; console.log(`PASS ${label}`);
    } finally { fs.closeSync(fd); s.log = describe(file); s.finishedAt = new Date().toISOString(); save(); }
  }
  try {
    const b = load(evidence), a = load(receipt);
    assert.equal(b.status, "CURRENT_NATIVE_NOVEL_DEFAULT_PASS");
    assert.equal(a.status, "CURRENT_NATIVE_NOVEL_DEFAULT_EVIDENCE_VERIFIED");
    assert.equal(a.report.sha256, describe(evidence).sha256); assert(a.invalidVariantsRejected >= 23);
    for (const f of b.sources) assert.equal(describe(f.path).sha256, f.sha256);
    await command("null-boundary", "node scripts/novel-default-null-contract.cjs");
    await command("phase-facts", "node scripts/novel-phase-facts-test.cjs");
    await command("event-compatibility", "node scripts/ai-novel-event-compatibility-contract.cjs");
    await command("processing-core", "node scripts/novel-processing-core-test.cjs");
    await command("append-contract", "node scripts/novel-import-append-graph-contract-test.cjs");
    await command("typecheck", "npm --prefix D:\\AgentVN\\editor run typecheck");
    await command("editor-build", "npm --prefix D:\\AgentVN\\editor run build");
    await command("gamecli-build", "npm --prefix D:\\AgentVN\\GameCli_framework run build");
    await command("workspace-contract", "node scripts/editor-workspace-contract.cjs");
    await command("dev-build", "& powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1");
    r.dev = describe(path.join(root, "AgentVN Dev.exe"));
    r.built = describe(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
    assert.equal(r.dev.sha256, r.built.sha256);
    assert(Date.parse(r.dev.modifiedAt) >= Date.parse(r.steps.find(s => s.label === "dev-build").startedAt));
    for (const f of b.sources) assert.equal(describe(f.path).sha256, f.sha256, "Build changed tested source");
    r.resourceChecks = [];
    for (const f of ["GameCli_framework/src/components/player/DialogBox.tsx", "shared/cartridge/validators.ts",
      "GameCli_framework/src/styles/shell.css"]) {
      const bundled = path.join(root, "editor/src-tauri/bundle-workspace", f);
      assert.equal(describe(bundled).sha256, describe(path.join(root, f)).sha256); r.resourceChecks.push(describe(bundled));
    }
    const version = path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json");
    assert.equal(load(version).editorVersion, load(path.join(root, "editor/src-tauri/tauri.conf.json")).version);
    r.resourceChecks.push(describe(version)); r.player = describe(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    r.backendBoundary = "Dev runs source Python; this build does not prove installed creator-backend.exe.";
    r.status = "NOVEL_DEFAULT_GATES_AND_ACTUAL_DEV_COPY_PASS";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, dev: r.dev, error: r.error })); }
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
