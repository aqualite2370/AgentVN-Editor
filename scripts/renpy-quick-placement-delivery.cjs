"use strict";
// Publish only the reviewed delta using a separate Git index. Never move real HEAD/index.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { scan } = require("./git-content-inventory.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Renpy-Quick-Placement-20261116-01";
const parent = "76bb789860f027d1c15ed517db4f9af3c4b906d1", branch = "codex/editor-autosave-recovery-20261116";
const mode = process.argv[2]; assert(["--audit", "--publish"].includes(mode)); assert.equal(process.argv.length, 3);
const product = ["shared/cartridge/renpyQuickBar.ts", "shared/cartridge/uiSkin.ts",
  "shared/cartridge/runtimeCapabilities.ts", "shared/cartridge/constants.ts",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "GameCli_framework/src/components/player/RenpyQuickBar.tsx", "GameCli_framework/src/components/player/DialogBox.tsx"];
const files = [...product, "docs/ASSISTANT_USER_GUIDE.md", "editor/src/assistant/agentvnDocIndex.generated.ts",
  "scripts/renpy-quick-placement-test.cjs", "scripts/renpy-quick-placement-playwright.cjs",
  "scripts/renpy-quick-placement-delivery.cjs"];
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sha = file => hash(fs.readFileSync(file));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, options = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options });
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(),
  indexSha256: sha(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())) });
const output = path.join(base, mode === "--audit" ? "source-audit-01.json" : "source-delivery-01.json");
assert(!fs.existsSync(output), "Preserve original evidence");
const report = { status: "RUNNING", mode, startedAt: new Date().toISOString(), before: state(),
  scope: "SOURCE_BROWSER_CUSTOM_QUICK_BAR_NOT_NATIVE_RELEASE_OR_PHYSICAL_PHONE",
  checks: [], files: [], nativeBuilds: 0, installations: 0, modelRequests: 0, computerUse: false };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
function check(name, run) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = run(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { save(); }
}
function cases(directory, count) {
  const file = path.join(base, directory, "report.json"), value = read(file);
  assert.equal(value.status, "PASS", file); assert.equal(value.cases.length, count);
  assert(value.cases.every(c => c.status === "PASS"));
  return { path: file, sha256: sha(file), count };
}
(async () => {
  check("checkpoint protected real checkout daily Dev and frozen 1.9.80", () => {
    const checkpoint = read(path.join(base, "checkpoint.json"));
    const supplement = read(path.join(base, "checkpoint-supplement.json"));
    assert.equal(report.before.head, checkpoint.head);
    assert.equal(report.before.indexSha256, checkpoint.indexSha256.toLowerCase());
    assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), checkpoint.dailyDevSha256.toLowerCase());
    assert.equal(sha(supplement.frozenInstaller), supplement.frozenInstallerSha256.toLowerCase());
    for (const file of checkpoint.files) assert.equal(sha(path.join(base, "checkpoint", file.file)), file.sha256.toLowerCase());
    return { installer: supplement.frozenInstaller, frozenPackageUnchanged: true, realCheckoutUnchanged: true,
      initialCheckpointMissingRelativeInstallerPathRetained: true };
  });
  check("direct validation capability geometry and previous presentation compatibility", () => {
    const result = [cases("final-unit01", 15)];
    const value = read(path.join(base, "presentation-compat01/report.json"));
    assert.equal(value.status, "PASS"); assert.equal(value.checks.length, 22); assert(value.checks.every(c => c.status === "PASS"));
    return [...result, { path: path.join(base, "presentation-compat01/report.json"), count: 22 }];
  });
  check("real author controls save reopen and exported package with explicitly inherited provenance", () => {
    const value = read(path.join(base, "browser03/report.json"));
    assert.equal(value.status, "FAILED"); assert.equal(value.cases.length, 4);
    assert(value.cases.slice(0, 3).every(c => c.status === "PASS"));
    assert(value.cleanup.every(c => c.status === "PASS_STOPPED_AND_PORT_CLOSED"));
    const followup = read(path.join(base, "browser04/report.json"));
    assert.equal(followup.inheritedCases.length, 3);
    for (const row of followup.inheritedCases) assert.equal(sha(row.evidence), row.evidenceSha256);
    assert.equal(sha(path.join(base, "browser03/quick-placement.vncart")), value.cases[2].sha256);
    for (const entry of value.sourcesBefore) assert.equal(sha(path.join(root, entry.file)), entry.sha256);
    return { realAuthoringCases: 3, originalParentStatus: value.status, noReimportOrRegeneration: true,
      exportMethod: value.cases[2].exportMethod };
  });
  check("exported browser game plus 18 declared runtime display and controlled safe-area combinations", () => {
    const artifact = cases("browser04", 19), value = read(artifact.path);
    assert.deepEqual(value.errors, []); assert.equal(value.cleanup.length, 1);
    assert(value.cleanup.every(c => c.status === "PASS_STOPPED_AND_PORT_CLOSED"));
    assert.equal(value.cases[0].actions.length, 4);
    for (const row of value.cases.slice(1)) {
      assert(row.actualHistoryClick); assert(row.geometry.buttons.length === 9 && row.geometry.buttons.every(b => b.hit));
      assert([1920, 2560, 3840, 2400].includes(row.geometry.display.width));
    }
    assert.equal(value.cases.filter(c => c.name.includes("controlled-Android")).length, 6);
    assert.equal(value.cases.filter(c => c.name.endsWith("desktop")).length, 12);
    return artifact;
  });
  check("12 editor display combinations default custom restoration and real NVL continuation", () => {
    const artifact = cases("boundaries01", 13), value = read(artifact.path);
    assert.deepEqual(value.errors, []); assert.equal(value.cleanup.length, 3);
    assert(value.cleanup.every(c => c.status === "PASS_STOPPED_AND_PORT_CLOSED"));
    for (const row of value.cases.slice(0, 12)) assert(row.control.focused && row.control.hit && row.control.overflow <= 1);
    const nvl = value.cases[12].geometry; assert(nvl.nvl.height > 16 && nvl.bar.bottom < nvl.nvl.top);
    return artifact;
  });
  check("knowledge index retrieval and exact final frontend build receipt", () => {
    const results = [cases("knowledge-index01", 5), cases("knowledge-retrieval01", 24)];
    cp.execFileSync(process.execPath, ["scripts/build-agent-doc-index.cjs", "--check"], { cwd: root, windowsHide: true });
    const build = read(path.join(base, "build-receipt.json"));
    assert.equal(build.status, "PASS"); assert.equal(build.typecheckExitCode, 0); assert.equal(build.editorBuildExitCode, 0);
    assert.equal(build.includesRuntimeBuild, true); assert.equal(sha(build.log), build.logSha256);
    for (const entry of build.sources) assert.equal(sha(path.join(root, entry.file)), entry.sha256);
    return { results, build };
  });
  if (mode === "--publish") {
    assert.equal(read(path.join(base, "source-audit-01.json")).status, "PASS_SOURCE_BROWSER_NOT_NATIVE_DELIVERY");
    assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(parent + "\t"), "Remote changed; do not overwrite");
    const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "source-delivery.index") };
    assert(!fs.existsSync(alternate.GIT_INDEX_FILE)); git(["read-tree", parent], { env: alternate });
    for (const relative of files) {
      const bytes = fs.readFileSync(path.join(root, relative));
      assert.equal(scan(bytes.toString("utf8")).length, 0, "Review potential credential in " + relative);
      if (relative.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", path.join(root, relative)], { windowsHide: true });
      const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
      report.files.push({ file: relative, sha256: hash(bytes) });
    }
    const tree = git(["write-tree"], { env: alternate }).trim();
    assert.deepEqual(git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree]).trim().split("\n").sort(), [...files].sort());
    report.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], {
      input: "Support explicit Ren'Py quick-bar placement without changing default docking\n\nAdd opt-in authoring, preserved custom coordinates and anchors, safe-frame uniform row sizing, dialogue/NVL reading protection and Runtime 0.32 capability gating. Verify real source editor save/reopen/public export, exported game actions, 12 desktop Runtime plus six controlled Android viewport combinations, 12 editor control combinations and NVL continuation. Keep frozen 1.9.80, daily Dev and real checkout/index unchanged; native release and physical-phone feedback remain separate.\n",
    }).trim();
    save(); report.push = git(["push", "origin", `${report.commit}:refs/heads/${branch}`]);
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(report.commit + "\t"));
    for (const file of report.files) {
      const response = await fetch(`https://raw.githubusercontent.com/aqualite2370/AgentVN-Editor/${report.commit}/${file.file}`,
        { signal: AbortSignal.timeout(30000) });
      assert(response.ok); assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256);
      file.remoteVerified = true; save();
    }
    report.status = "PASS_SOURCE_PUSH_NOT_NATIVE_DELIVERY";
  } else report.status = "PASS_SOURCE_BROWSER_NOT_NATIVE_DELIVERY";
  report.after = state(); assert.deepEqual(report.after, report.before);
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, commit: report.commit, output, error: report.error })); });
