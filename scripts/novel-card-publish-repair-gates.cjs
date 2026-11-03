"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { qa, summary, desc } = require("./native-novel-card-publish.cjs");
const root = path.resolve(__dirname, "..");
const load = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
async function main() {
  const [name, iteration, audit] = process.argv.slice(2);
  assert(/^gates-\d{2}$/.test(name) && /^\d{2}$/.test(iteration) && /^audit-\d{2}$/.test(audit));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const behavior = path.join(qa, `session-${iteration}/report.json`), receipt = path.join(qa, audit, "receipt.json");
  const r = { status: "RUNNING", at: new Date().toISOString(), behavior: desc(behavior), audit: desc(receipt),
    before: desc(path.join(root, "AgentVN Dev.exe")), steps: [],
    testSources: [__filename, path.join(root, "scripts/novel-card-position-playwright.cjs"),
      path.join(root, "scripts/novel-task-floating-playwright.cjs")].map(desc),
    floatingBrowser: { headless: process.env.FLOATING_HEADFUL !== "1" } };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  const sourceFixture = load(path.join(root, "output/native-novel-default-20261020-01/preparation.json")).input.path;
  const fixture = load(sourceFixture); fixture.project_id = "editor_isolated_small"; fixture.title = "卡片发布隔离组件验收";
  delete fixture.editor_settings.novelPersistence;
  const input = path.join(out, "component-small.vnproj");
  fs.writeFileSync(input, JSON.stringify(fixture, null, 2), { flag: "wx" }); r.input = desc(input);
  async function command(label, script, overrides = {}) {
    const s = { label, command: script, status: "RUNNING", startedAt: new Date().toISOString() }; r.steps.push(s); save();
    console.log(`START ${label}`); const file = path.join(out, `${label}.log`), fd = fs.openSync(file, "wx");
    try {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `$ErrorActionPreference='Stop'; ${script}; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}`], {
        cwd: root, windowsHide: true, stdio: ["ignore", fd, fd],
        env: { ...process.env, AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: path.join(out, `${label}-evidence`),
          PYTHONIOENCODING: "utf-8", ...overrides },
      });
      s.pid = child.pid; save();
      s.code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
      assert.equal(s.code, 0, `${label} failed; see ${file}`); s.status = "PASS"; console.log(`PASS ${label}`);
    } catch (error) {
      s.status = "FAILED"; s.error = String(error.stack || error); throw error;
    } finally { fs.closeSync(fd); s.log = desc(file); s.finishedAt = new Date().toISOString(); save(); }
  }
  try {
    const b = load(behavior), a = load(receipt);
    assert.equal(b.status, "CURRENT_NATIVE_NOVEL_CARD_PUBLISH_PASS");
    assert.equal(a.status, "CURRENT_NATIVE_NOVEL_CARD_PUBLISH_EVIDENCE_VERIFIED");
    assert.equal(a.report.sha256, r.behavior.sha256); assert(a.invalidVariantsRejected >= 23);
    for (const s of b.sources) assert.equal(desc(s.path).sha256, s.sha256);
    await command("position-store", "node scripts/novel-card-position-store-test.cjs");
    await command("position-browser", "node scripts/novel-card-position-playwright.cjs");
    await command("task-handoff-normal", "node scripts/novel-task-floating-playwright.cjs --case=handoff",
      { FLOATING_VIEWPORTS: "1080p,1440p,4k", FLOATING_REDUCED: "0" });
    await command("task-handoff-reduced", "node scripts/novel-task-floating-playwright.cjs --case=handoff",
      { FLOATING_VIEWPORTS: "1080p,1440p,4k", FLOATING_REDUCED: "1" });
    await command("typecheck", "npm --prefix D:\\AgentVN\\editor run typecheck");
    await command("editor-build", "npm --prefix D:\\AgentVN\\editor run build");
    await command("gamecli-build", "npm --prefix D:\\AgentVN\\GameCli_framework run build");
    await command("workspace-contract", "node scripts/editor-workspace-contract.cjs");
    await command("dev-build", "& powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1");
    r.dev = desc(path.join(root, "AgentVN Dev.exe"));
    r.built = desc(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
    r.player = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(r.dev.sha256, r.built.sha256);
    assert(Date.parse(r.dev.modifiedAt) >= Date.parse(r.steps.find(s => s.label === "dev-build").startedAt));
    for (const s of b.sources) assert.equal(desc(s.path).sha256, s.sha256, "Build changed tested source");
    r.resources = [];
    for (const f of ["GameCli_framework/src/components/player/DialogBox.tsx", "GameCli_framework/src/styles/shell.css",
      "shared/cartridge/validators.ts"]) {
      const source = path.join(root, f), bundled = path.join(root, "editor/src-tauri/bundle-workspace", f);
      assert.equal(desc(source).sha256, desc(bundled).sha256); r.resources.push(desc(bundled));
    }
    const version = path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json");
    assert.equal(load(version).editorVersion, load(path.join(root, "editor/src-tauri/tauri.conf.json")).version);
    r.resources.push(desc(version)); r.status = "NOVEL_CARD_PUBLISH_GATES_ACTUAL_DEV_COPY_PASS";
    r.boundary = "Dev source Python; not packaged backend/Release/Windows setup/Android or complete goal";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, dev: r.dev, error: r.error })); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
