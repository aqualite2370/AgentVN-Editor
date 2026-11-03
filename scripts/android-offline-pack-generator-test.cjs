const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-avnenv-generator-"));
const expanded = path.join(fixtureRoot, "expanded");
const archive = path.join(fixtureRoot, "fixture.avnenv");

try {
  const files = [
    ["payload/toolchain/dummy.bin", Buffer.from([0, 1, 2, 3, 255])],
    ["payload/gradle-home/cache/中文.txt", Buffer.from("隐忍的成长\n", "utf8")],
  ];
  for (const [relativePath, contents] of files) {
    const destination = path.join(expanded, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  }

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "scripts", "prepare-android-offline-pack.ps1"),
      "-OutputDir",
      expanded,
      "-ArchivePath",
      archive,
      "-ReuseExpanded",
      "-AllowIncomplete",
      "-KeepExpanded",
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(
    result.status,
    0,
    `generator failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(fs.readFileSync(archive).subarray(0, 4).toString("binary"), "PK\u0003\u0004");

  const format = JSON.parse(fs.readFileSync(path.join(expanded, "format.json"), "utf8"));
  assert.equal(format.fileCount, files.length);
  assert.equal(
    format.totalBytes,
    files.reduce((sum, [, contents]) => sum + contents.length, 0),
  );
  assert.deepEqual(
    format.files.map((file) => file.path),
    files.map(([relativePath]) => relativePath).sort(),
  );
  for (const file of format.files) {
    assert.equal(typeof file.bytes, "number");
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }

  console.log("PASS Android environment generator manifest aggregation and reuse recovery");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
