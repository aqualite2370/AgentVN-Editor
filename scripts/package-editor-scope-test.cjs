"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), out = process.argv[2];
assert(out && !fs.existsSync(out), "Use a new evidence directory");
fs.mkdirSync(out, { recursive: true });
const source = fs.readFileSync(path.join(root, "scripts/package-installers.ps1"), "utf8");
const functions = ["Set-PackageVersion", "Restore-PackageVersion"].map(name => {
  const start = source.indexOf(`function ${name} {`), end = source.indexOf("\nfunction ", start + 1);
  assert(start >= 0 && end > start); return source.slice(start, end);
}).join("\n");
const report = { status: "RUNNING", scope: "REAL_POWERSHELL_VERSION_MUTATION_AND_RESTORE", cases: [] };
try {
  for (const target of ["editor", "player", "all"]) {
    const base = path.resolve(out, target), paths = [
      "editor/src-tauri/tauri.conf.json", "editor/src-tauri/Cargo.toml",
      "GameCli_framework/src-tauri/tauri.conf.json", "GameCli_framework/src-tauri/Cargo.toml",
    ];
    for (const relative of paths) {
      const p = path.join(base, relative); fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, relative.endsWith(".json")
        ? JSON.stringify({ productName: "中文独立工程", version: "1.9.19" })
        : '[package]\nname = "test"\nversion = "1.9.19"\n', { flag: "wx" });
    }
    const before = paths.map(p => fs.readFileSync(path.join(base, p)));
    const ps = [
      "$ErrorActionPreference='Stop'", `$Root = '${base.replaceAll("'", "''")}'`, `$Target = '${target}'`,
      "$script:VersionFileBackups = @{}",
      "function Resolve-WorkspacePath { param([string]$RelativePath) Join-Path $Root $RelativePath }",
      "function Write-Utf8NoBom { param([string]$Path,[string]$Content) [IO.File]::WriteAllText($Path,$Content,[Text.UTF8Encoding]::new($false)) }",
      functions, "Set-PackageVersion '1.9.13'",
      "$seen = @{}; foreach($p in $script:VersionFileBackups.Keys) { $seen[$p] = [IO.File]::ReadAllText($p) }",
      "Restore-PackageVersion", "$seen | ConvertTo-Json -Compress",
    ].join("\n");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")],
      { windowsHide: true, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const mutated = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
    const row = { target, mutated: Object.keys(mutated), status: "RUNNING" }; report.cases.push(row);
    const expected = paths.filter(p => target === "all" || p.startsWith(target === "editor" ? "editor/" : "GameCli_framework/"));
    assert.equal(row.mutated.length, expected.length, `${target} must not version the other product`);
    for (const relative of expected) assert(mutated[path.join(base, relative)].includes("1.9.13"));
    for (let i = 0; i < paths.length; i++) assert.deepEqual(fs.readFileSync(path.join(base, paths[i])), before[i]);
    row.status = "PASS";
  }
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report));
