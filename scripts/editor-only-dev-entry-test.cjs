"use strict";
// Execute the actual PowerShell branch with a controlled build callee, never Cargo.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const [out, sourceFile = path.resolve(__dirname, "build-dev-launcher.ps1")] = process.argv.slice(2);
assert(out && !fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const source = fs.readFileSync(sourceFile, "utf8");
const report = { status: "RUNNING", scope: "POWERSHELL_AST_REAL_BRANCH_CONTROLLED_BUILD_CALLEE", source: sourceFile, cases: [] };
try {
  const discovery = [
    `$tree = [Management.Automation.Language.Parser]::ParseFile('${sourceFile.replaceAll("'", "''")}',[ref]$null,[ref]$null)`,
    "$branch = $tree.Find({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -eq '$SkipGameCliPlayer'},$true)",
    "if(!$branch){throw 'Missing explicit Editor-only branch'}", "$branch.Extent.Text",
  ].join("\n");
  const found = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(discovery, "utf16le").toString("base64")],
    { windowsHide: true, encoding: "utf8" });
  assert.equal(found.status, 0, found.stderr);
  const branch = found.stdout.trim();
  for (const name of ["reuse", "missing", "default"]) {
    const base = path.resolve(out, name), player = path.join(base, "resource/player.exe");
    fs.mkdirSync(path.dirname(player), { recursive: true });
    if (name !== "missing") fs.writeFileSync(player, "existing-player", { flag: "wx" });
    const built = path.join(base, "GameCli_framework/src-tauri/target/release/agentvn-player.exe");
    const q = s => "'" + s.replaceAll("'", "''") + "'";
    fs.writeFileSync(path.join(base, "build-game-shell-windows.ps1"),
      `[IO.Directory]::CreateDirectory(${q(path.dirname(built))})|Out-Null\n[IO.File]::WriteAllText(${q(built)},'new-player')\n$global:LASTEXITCODE=0\n`,
    { flag: "wx" });
    const wrapper = path.join(base, "run.ps1");
    fs.writeFileSync(wrapper, [
      "$ErrorActionPreference='Stop'", `$Root=${q(base)}`, `$PlayerResource=${q(player)}`,
      `$SkipGameCliPlayer=$${name === "default" ? "false" : "true"}`, branch,
    ].join("\n"), { flag: "wx" });
    const result = spawnSync("powershell.exe", ["-NoProfile", "-File", wrapper], { windowsHide: true, encoding: "utf8" });
    if (name === "missing") {
      assert.notEqual(result.status, 0); assert(!fs.existsSync(built)); assert(!fs.existsSync(player));
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(player, "utf8"), name === "reuse" ? "existing-player" : "new-player");
      assert.equal(fs.existsSync(built), name === "default");
    }
    report.cases.push({ name, exitCode: result.status, status: "PASS" });
  }
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report));
