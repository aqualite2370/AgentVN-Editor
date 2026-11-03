"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Layout-Health-Hit-20261022-01";
const name = process.argv[2];
assert(/^\d{2}$/.test(name || ""));
const output = path.join(qa, `terminal-${name}.json`);
assert(!fs.existsSync(output));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "INDEPENDENT_SOURCE_DEV_AND_CLEANUP_NOT_FROZEN_RELEASE", checks: [], modelRequests: 0 };
(async () => {
  const gates = read(path.join(qa, "gates-01/report.json"));
  const matrix = read(gates.matrix.path), author = read(gates.author.path);
  assert.equal(gates.status, "PASS");
  assert.equal(sha(gates.matrix.path), gates.matrix.sha256);
  assert.equal(sha(gates.author.path), gates.author.sha256);
  assert.equal(matrix.status, "PASS"); assert.equal(matrix.cleanup, "PASS");
  assert.equal(matrix.cases.length, 60); assert.equal(matrix.screenshots.length, 12);
  const combinations = new Map();
  for (const c of matrix.cases) {
    assert.equal(c.status, "PASS");
    const key = [c.width, c.height, c.dpr, c.reduced].join(":");
    combinations.set(key, (combinations.get(key) || 0) + 1);
    for (const measurement of Object.values(c.measurements)) {
      assert(measurement.hit); assert(measurement.pageOverflow <= 1);
      for (const clip of measurement.clips) {
        const r = measurement.rect, b = clip.rect;
        assert(r.left >= b.left - 1 && r.right <= b.right + 1
          && r.top >= b.top - 1 && r.bottom <= b.bottom + 1);
      }
    }
  }
  assert.equal(combinations.size, 12);
  assert([...combinations.values()].every(count => count === 5));
  for (const shot of matrix.screenshots) {
    assert.equal(sha(shot.path), shot.sha256);
    const png = fs.readFileSync(shot.path), a = shot.actual;
    assert.equal(png.readUInt32BE(16), a.width * a.dpr);
    assert.equal(png.readUInt32BE(20), a.height * a.dpr);
  }
  assert.equal(author.status, "PASS"); assert.equal(author.cleanup, "PASS");
  assert.equal(author.cases.length, 2); assert(author.cases.every(c => c.status === "PASS"));
  report.checks.push({ name: "nonempty-matrix-independent-hit-clipping-png-and-related-author",
    status: "PASS", cases: 60, combinations: 12, pngs: 12, authorGroups: 2 });

  for (const source of gates.sources) {
    assert.equal(sha(path.join(root, source.path)), source.sha256);
  }
  // The bundle workspace contains export Runtime/shared sources; Editor source
  // is intentionally not distributed there. Verify its compiled CSS separately.
  const assets = path.join(root, "editor/dist/assets");
  const compiledCss = fs.readdirSync(assets).filter(file => file.endsWith(".css"))
    .map(file => fs.readFileSync(path.join(assets, file), "utf8")).join("\n");
  assert(/\.advanced-tools-panel\.layout-mode \.runtime-layout-designer\[data-renpy-editor\]\{grid-template-rows:auto minmax\(0,1fr\) auto\}/.test(compiledCss));
  for (const file of ["GameCli_framework/src/utils/storage.ts", "shared/cartridge/uiLayoutProfiles.ts"])
    assert.equal(sha(path.join(root, file)), sha(path.join(root, "editor/src-tauri/bundle-workspace", file)));
  assert.equal(sha(gates.devAfter.path), gates.devAfter.sha256);
  assert.equal(sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")), gates.devAfter.sha256);
  assert.equal(sha(path.join(qa, "gates-01/AgentVN Dev-before.exe")), gates.devBefore.sha256);
  assert(!fs.existsSync(path.join(root, "AgentVN Dev.pending.exe")));
  for (const protectedFile of gates.protected) assert.equal(sha(protectedFile.path), protectedFile.sha256);
  assert.equal(gates.steps.length, 5); assert(gates.steps.every(s => s.status === "PASS" && s.exitCode === 0));
  report.checks.push({ name: "source-bundled-dev-debug-backup-frozen-installer-and-default-db",
    status: "PASS", dev: gates.devAfter });

  const pids = new Set(), urls = new Set(), finishTimes = [gates.finishedAt, author.finishedAt];
  const collect = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (["pid", "backendPid", "ProcessId", "OwningProcess"].includes(key) && Number.isInteger(item)) pids.add(item);
      if (["url", "backendUrl"].includes(key) && typeof item === "string"
        && /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(item)) urls.add(item);
      if (typeof item === "object") collect(item);
    }
  };
  if (process.argv.includes("--author-roundtrip")) {
    const base = "F:/AgentVN/QA/Renpy-Redesign-20261021-01";
    const authored = read(path.join(base, "controls-green-17/report.json"));
    const roundtrip = read(path.join(base, "controls-green-20/report.json"));
    const runtime = read(path.join(base, "runtime-green-22/report.json"));
    assert.equal(authored.status, "PASS"); assert.equal(authored.cases.length, 7);
    assert.equal(roundtrip.status, "PASS"); assert.equal(roundtrip.cases.length, 2);
    assert.equal(runtime.status, "PASS"); assert.equal(runtime.cases.length, 2);
    assert.equal(authored.sourceSHA256, roundtrip.sourceSHA256);
    assert.equal(authored.runtimePreviewSHA256, roundtrip.runtimePreviewSHA256);
    assert.equal(sha(roundtrip.priorAuthor.path), roundtrip.priorAuthor.sha256);
    assert.equal(roundtrip.priorAuthor.sourceUnchanged, true);
    for (const [data, folder] of [[authored, "controls-green-17"], [roundtrip, "controls-green-20"], [runtime, "runtime-green-22"]]) {
      assert.equal(data.cleanup, "PASS"); assert.equal(data.modelRequests, 0);
      assert(data.cases.every(c => c.status === "PASS")); finishTimes.push(data.finishedAt);
      collect(data.owner); collect(data.runtimeOwner);
      for (const c of data.cases) {
        if (c.portable) assert.equal(sha(c.portable), c.sha256);
        if (c.cartridge) assert.equal(sha(c.cartridge), c.sha256);
        if (c.screenshot) {
          const png = fs.readFileSync(path.join(base, folder, c.screenshot));
          assert.equal(png.readUInt32BE(16), c.width * c.dpr);
          assert.equal(png.readUInt32BE(20), c.height * c.dpr);
        }
      }
    }
    for (const artifact of runtime.artifacts) {
      const file = path.join(base, "runtime-green-22", `${artifact.enabled ? "enabled" : "disabled"}.vncart`);
      assert.equal(sha(file), artifact.cartridgeSHA256);
    }
    report.authorSupplement = ["controls-green-17", "controls-green-20", "runtime-green-22"]
      .map(folder => ({ path: path.join(base, folder, "report.json"), sha256: sha(path.join(base, folder, "report.json")) }));
    report.checks.push({ name: "current-author-portable-roundtrip-same-ui-cartridge-player-and-enabled-disabled-runtime",
      status: "PASS", authorGroups: 7, roundtripGroups: 2, runtimeVariants: 2, fullMatrixClaimed: false });
  }
  for (const folder of ["red-01", "green-01", "matrix-01", "gates-01"]) {
    const data = read(path.join(qa, folder, "report.json"));
    collect(data); finishTimes.push(data.finishedAt);
  }
  collect(author.owner);
  report.installationAttempts = [];
  for (const attempt of ["32", "33", "34", "35", "36"]) {
    const dir = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${attempt}`;
    const data = read(path.join(dir, "report.json")); collect(data); finishTimes.push(data.finishedAt);
    assert(data.cleanups.every(c => c.status === "PASS"));
    const restorationFile = path.join(dir, attempt === "32"
      ? "native-cache-recovery.json" : "native-cache-restoration.json");
    assert.equal(read(restorationFile).status, "PASS");
    report.installationAttempts.push({ attempt, status: data.status, reportSHA256: sha(path.join(dir, "report.json")) });
  }
  assert.equal(report.installationAttempts.find(r => r.attempt === "33").status, "PASS");
  assert.equal(report.installationAttempts.find(r => r.attempt === "36").status, "FAILED");
  const active = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,@{Name='created';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}})"],
  { encoding: "utf8", windowsHide: true }));
  const latestEnd = Math.max(...finishTimes.map(value => {
    const time = Date.parse(value); assert(Number.isFinite(time)); return time;
  }));
  const reusedPids = active.filter(p => pids.has(p.ProcessId));
  for (const process of reusedPids) assert(Date.parse(process.created) > latestEnd,
    `A recorded process may remain: ${JSON.stringify(process)}`);
  await Promise.all([...urls].map(async url => {
    let answered = false;
    try { await fetch(url, { signal: AbortSignal.timeout(800) }); answered = true; } catch {}
    assert(!answered, `Service still responds: ${url}`);
  }));
  const restored = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-36/native-cache-restoration.json");
  const stat = fs.lstatSync(restored.originalDirectory); assert(stat.isDirectory() && !stat.isSymbolicLink());
  const identity = execFileSync("fsutil.exe", ["file", "queryfileid", restored.originalDirectory],
    { encoding: "utf8", windowsHide: true });
  assert(identity.toLowerCase().includes(restored.originalDirectoryId.toLowerCase()));
  for (const file of restored.originalFiles)
    assert.equal(sha(path.join(restored.originalDirectory, file.relative)), file.sha256);
  const log = fs.readFileSync(path.join(qa, "gates-01/complete-dev/command.log"), "utf8");
  const configs = [...log.matchAll(/--config ([A-Z]:[^\r\n]+?\.json)/g)].map(m => m[1]);
  assert(configs.length > 0); for (const file of configs) assert(!fs.existsSync(file));
  report.checks.push({ name: "owned-pids-ports-cache-identity-five-shas-and-build-config-clean",
    status: "PASS", pids: [...pids], reusedPids, urls: [...urls], configs, cache: restored.originalDirectory });
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, output, error: report.error }));
});
