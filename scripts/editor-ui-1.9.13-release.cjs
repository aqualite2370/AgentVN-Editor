"use strict";
// One candidate: source behavior -> full Dev -> actual requested BAT -> payloads.
// No Player installer, Android build, model request, or historical report rewrite.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Editor-1.9.13-20261021-01";
const [mode, attempt = "01"] = process.argv.slice(2);
assert(["check", "dev", "package", "payload", "install"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `${mode}-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const files = [
  "shared/cartridge/uiSkin.ts", "shared/cartridge/uiThemePresets.ts",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx", "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/RuntimeThemeDesigner.tsx", "editor/src/components/advanced/DialogPortraitLayoutEditor.tsx",
  "editor/src/components/common/hoverHelpCatalog.ts", "editor/src/components/editor/EditorToolbar.tsx",
  "editor/src/styles/editor-responsive.css", "editor/src/styles/layout.css",
  "editor/src/components/workspace/workspaceContracts.ts", "editor/src/components/novel-import/NovelTaskCard.tsx",
  "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx",
  "editor/src/components/novel-import/novel-task-floating.css", "editor/src/components/novel-import/useNovelTaskModalPriority.ts",
  "editor/package.json", "editor/package-lock.json", "editor/src-tauri/tauri.conf.json",
  "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock", "scripts/package-installers.ps1", "package-installers.bat",
  "scripts/build-dev-launcher.ps1", "scripts/build-editor-windows.ps1",
  "GameCli_framework/src-tauri/tauri.conf.json",
];
const report = { status: "RUNNING", mode, startedAt: new Date().toISOString(), version: "1.9.13",
  scope: "EDITOR_CANDIDATE_NOT_FULL_INSTALLED_FUNCTIONAL_ACCEPTANCE", commands: [],
  versionOrdering: "USER_REQUESTED_NUMBER_LOWER_THAN_PRESERVED_1.9.19_NOT_AN_UPGRADE_TEST",
  sources: files.map(f => desc(path.join(root, f))), modelRequests: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const verify = rows => { for (const row of rows) assert.equal(sha(row.path), row.sha256, row.path); };
function prior(phase) {
  const file = path.join(qa, `${phase}-${attempt}/report.json`), r = read(file);
  assert.equal(r.status, "PASS", file); assert(r.commands.length && r.commands.every(c => c.exitCode === 0));
  verify(r.sources); report.prerequisite = desc(file); return r;
}
const fixture = path.join(root, "scripts/fixtures/dialog-presentation-isolated.vnproj");
async function command(label, exe, args, extra = {}) {
  const log = path.join(out, `${String(report.commands.length + 1).padStart(2, "0")}.log`);
  const fd = fs.openSync(log, "wx"), row = { label, command: [exe, ...args], startedAt: new Date().toISOString(), log, status: "RUNNING" };
  report.commands.push(row); save(); console.log("START " + label);
  const env = { ...process.env, TEMP: out, TMP: out, AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED: "",
    AGENTVN_TEST_PROJECT: fixture, AGENTVN_WORKSPACE_OUTPUT: path.join(out, `behavior-${report.commands.length}`), ...extra };
  env.PSModulePath = [path.join(process.env.USERPROFILE, "Documents/WindowsPowerShell/Modules"),
    path.join(process.env.ProgramFiles, "WindowsPowerShell/Modules"),
    path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/Modules")].join(path.delimiter);
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, env, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((res, rej) => { child.once("exit", res); child.once("error", rej); });
    assert.equal(row.exitCode, 0, log); row.status = "PASS"; console.log("PASS " + label);
  } catch (e) { row.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  save();
  const version = read(path.join(root, "editor/src-tauri/tauri.conf.json")).version;
  assert.equal(version, "1.9.13");
  for (const relative of ["editor/package.json", "editor/package-lock.json"])
    assert.equal(read(path.join(root, relative)).version, version);
  assert.equal(read(path.join(root, "editor/package-lock.json")).packages[""].version, version);
  assert.match(fs.readFileSync(path.join(root, "editor/src-tauri/Cargo.toml"), "utf8"), /^version = "1\.9\.13"$/m);
  assert.match(fs.readFileSync(path.join(root, "editor/src-tauri/Cargo.lock"), "utf8"), /name = "agentvn-editor"\s+version = "1\.9\.13"/);
  if (mode === "check") {
    const packagingOnly = attempt === "04";
    if (packagingOnly) {
      const previousFile = path.join(qa, "check-03/report.json"), previous = read(previousFile);
      assert.equal(previous.status, "PASS");
      const approved = new Set(["editor/src-tauri/tauri.conf.json", "scripts/package-installers.ps1", "package-installers.bat"]
        .map(f => path.join(root, f)));
      const checkpoint = "F:/AgentVN/Checkpoints/Exe-Only-Installers-20261021-01";
      for (const row of previous.sources) {
        if (approved.has(row.path)) {
          assert.equal(sha(path.join(checkpoint, path.relative(root, row.path))), row.sha256);
        } else verify([row]);
      }
      for (const product of ["editor", "GameCli_framework"]) {
        const relative = `${product}/src-tauri/tauri.conf.json`;
        const before = read(path.join(checkpoint, relative)), now = read(path.join(root, relative));
        assert.deepEqual(now.bundle.targets, ["nsis"]);
        before.bundle.targets = ["nsis"]; assert.deepEqual(now, before, "Only installer targets changed");
      }
      report.references = { source: desc(previousFile), commands: previous.commands, references: previous.references,
        reason: "UI/Runtime source byte-identical; reviewed packaging-only delta against preserved checkpoint" };
      await command("EXE-only PowerShell build and artifact behavior", process.execPath,
        ["scripts/exe-only-installers-test.cjs", path.join(out, "exe-only")]);
      await command("Package target version isolation", process.execPath,
        ["scripts/package-editor-scope-test.cjs", path.join(out, "version-scope")]);
    }
    const resume = ["02", "03"].includes(attempt) ? read(path.join(qa, "check-01/report.json")) : null;
    if (resume) {
      assert.equal(resume.status, "FAILED");
      assert.equal(resume.commands.length, 10);
      assert.equal(resume.commands.at(-1).label, "Existing novel handoff");
      assert(resume.commands.slice(0, 9).every(c => c.status === "PASS" && c.exitCode === 0));
      verify(resume.sources);
      report.references = { source: desc(path.join(qa, "check-01/report.json")),
        reason: "Same unchanged product; preserve failed handoff, reuse nine completed source UI gates",
        commands: resume.commands.slice(0, 9) };
      save();
    }
    if (!resume && !packagingOnly) {
    await command("Name, defaults, explicit styles, real cartridge bytes", process.execPath, ["scripts/speaker-container-acceptance.cjs", "model", "04"]);
    await command("Name and editable radius, real UI 12 cells", process.execPath, ["scripts/speaker-container-acceptance.cjs", "browser", "03"]);
    await command("Expanded desk, real UI 12 cells", process.execPath, ["scripts/layout-workbench-fit-playwright.cjs", "05"]);
    await command("Reported screenshot geometry 4 cells", process.execPath, ["scripts/layout-workbench-fit-playwright.cjs", "06", "--reported"]);
    await command("Compact hide/reveal/drag/focus, real UI 12 cells", process.execPath, ["scripts/novel-task-card-compact-playwright.cjs", "05"]);
    for (const dpr of [1, 2]) for (const reduced of [false, true])
      await command(`Editor moving mask and reverse, DPR${dpr} reduce=${reduced}`, process.execPath,
        ["scripts/editor-selection-mask-motion-playwright.cjs"], {
          MOTION_VIEWPORTS: "1080p,1440p,4k", MOTION_DPR: String(dpr), MOTION_REDUCED: reduced ? "1" : "0",
          EDITOR_EXPECT_WORKSPACE_SPEED: "1.5",
        });
    }
    if (!packagingOnly) {
    for (const caseName of ["handoff", "ownership", "controller"])
      await command(`Existing novel ${caseName}`, process.execPath,
        ["scripts/novel-task-floating-playwright.cjs", `--case=${caseName}`], { FLOATING_VIEWPORTS: "1080p,1440p,4k" });
    for (const name of ["layout-opacity-split-test", "runtime-layout-profiles-test", "ui-skin-legacy-compat-contract",
      "ui-skin-style-component-health-contract", "dialog-portrait-layout-model-test", "renpy-layout-runtime-test",
      "editor-workspace-contract", "gitpush-safety-test", "package-version-contract", "package-version-encoding-regression-test"])
      await command(name, process.execPath, [`scripts/${name}.cjs`]);
    }
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    for (const task of ["typecheck", "build"])
      await command(`Editor ${task}`, process.execPath, [npm, "--prefix", path.join(root, "editor"), "run", task]);
  } else if (mode === "dev") {
    prior("check");
    await command("Editor-only Dev: reuse/missing/default branches", process.execPath,
      ["scripts/editor-only-dev-entry-test.cjs", path.join(out, "dev-entry")]);
    await command("Package target scope and exact version restore", process.execPath,
      ["scripts/package-editor-scope-test.cjs", path.join(out, "package-scope")]);
    await command("Full existing task UI and modal priority", process.execPath,
      ["scripts/novel-task-floating-playwright.cjs", "--case=ui"], { FLOATING_VIEWPORTS: "1080p,1440p,4k" });
    report.playerBefore = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    report.before = desc(path.join(root, "AgentVN Dev.exe"));
    await command("Full Editor Dev, existing native Player resource", "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/build-dev-launcher.ps1", "-SkipGameCliPlayer"]);
    verify([report.playerBefore]);
    report.dev = desc(path.join(root, "AgentVN Dev.exe"));
    assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert(Date.parse(report.dev.generatedAt) > Date.parse(report.startedAt));
    await command("Prepared version/resource faults", process.execPath, ["scripts/editor-installed-version-resources-test.cjs"]);
  } else if (mode === "package") {
    const dev = prior("dev"); verify([dev.dev]);
    report.playerSources = ["GameCli_framework/src-tauri/Cargo.toml", "GameCli_framework/src-tauri/Cargo.lock",
      "GameCli_framework/src-tauri/tauri.conf.json", "editor/src-tauri/binaries/agentvn-player.exe"].map(f => desc(path.join(root, f)));
    report.existingInstallers = fs.readdirSync(path.join(root, "releases/editor")).filter(f => /\.(exe|msi)$/.test(f))
      .map(f => desc(path.join(root, "releases/editor", f)));
    save();
    await command("Requested actual BAT, Editor only", "cmd.exe",
      ["/d", "/c", "package-installers.bat", "editor", "1.9.13", "--preserve-build-cache"]);
    verify(report.playerSources); verify(report.existingInstallers); verify([dev.dev]);
    const old = new Set(report.existingInstallers.map(f => f.path));
    report.installers = fs.readdirSync(path.join(root, "releases/editor"))
      .map(f => path.resolve(root, "releases/editor", f)).filter(f => !old.has(f) && /\.exe$|\.msi$/.test(f)).map(desc);
    assert.equal(report.installers.length, 1, "Exactly one EXE installer required");
    assert(report.installers.every(f => f.path.endsWith(".exe")));
    report.installerFormat = "nsis";
    assert(report.installers.every(f => path.basename(f.path).startsWith("AgentVN_Editor_v1.9.13_")));
    report.editor = desc(path.join(root, "editor/src-tauri/target/release/agentvn-editor.exe"));
    report.resources = desc(path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json"));
    assert.equal(read(report.resources.path).editorVersion, version);
    const pe = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      "(Get-Item -LiteralPath $env:AGENTVN_EXE).VersionInfo.ProductVersion"],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, AGENTVN_EXE: report.editor.path } }).trim();
    assert.equal(pe, version); report.actualPEVersion = pe;
  } else if (mode === "payload") {
    const packaged = prior("package"); verify(packaged.installers);
    const legacy = packaged.installerFormat !== "nsis";
    await command("Actual installer payloads", process.execPath,
      ["scripts/editor-installer-resources-acceptance.cjs", path.join(out, "deployments"), version,
        ...(legacy ? ["", "--with-legacy-msi"] : [])]);
    const r = read(path.join(out, "deployments/installer-resource-report.json"));
    assert.equal(r.status, "PASS"); assert.equal(r.deployments.length, legacy ? 3 : 1);
    report.installerFormat = r.installerFormat; report.deployments = r.deployments;
    report.archived = packaged.installers;
  } else {
    const payload = prior("payload"), packaged = read(path.join(qa, `package-${attempt}/report.json`));
    verify(payload.archived);
    // The bounded installer helper consumes a sealed standard journal.
    const journal = path.join(qa, "payload-01/report.json");
    assert(!fs.existsSync(journal)); fs.mkdirSync(path.dirname(journal), { recursive: true });
    fs.writeFileSync(journal, JSON.stringify(payload, null, 2), { flag: "wx" });
    const frozen = [
      path.join(root, "AgentVN Dev.exe"),
      "F:/AgentVN/QA/Android-RunId-Release-20261021-01/installed-editor/agentvn-editor.exe",
      ...["agentvn-editor.exe", "agentvn-player.exe", "creator-backend.exe", "build-versions.json"].map(n =>
        path.join("F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor", n)),
      ...["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"].map(n =>
        path.join(process.env.APPDATA, "com.agentvn.editor/backend", n)),
    ].filter(fs.existsSync).map(desc);
    const checkpoint = path.join(qa, "checkpoint-01/report.json");
    assert(!fs.existsSync(checkpoint)); fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
    fs.writeFileSync(checkpoint, JSON.stringify({ status: "PASS", scope: "READ_ONLY_PROTECTED_FILE_IDENTITIES",
      frozen, history: packaged.existingInstallers }, null, 2), { flag: "wx" });
    report.protectedFiles = [...frozen, ...packaged.existingInstallers]; save();
    for (const action of ["SelfTest", "Install"])
      await command(`Bounded actual NSIS ${action}`, "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", "scripts/runtime-dialog-installed-session.ps1", "-Action", action, "-QaRoot", qa, "-ExpectedVersion", version]);
    const installed = read(path.join(qa, "installation.json"));
    assert.equal(installed.status, "PASS"); assert.equal(installed.metadataRestoration, "PASS");
    report.installation = desc(path.join(qa, "installation.json")); verify(report.protectedFiles);
  }
  assert(report.commands.length > 0); verify(report.sources); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, mode, out, error: report.error })); });
