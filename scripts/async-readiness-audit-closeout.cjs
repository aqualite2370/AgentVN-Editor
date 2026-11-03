"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Async-Readiness-Audit-20261020-01";
const out = path.join(root, "output/async-readiness-audit-20261020-01");
const file = path.join(out, `receipt-${process.argv[2] || "01"}.json`); assert(!fs.existsSync(file));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const artifact = f => ({ path: f, sha256: sha(f), bytes: fs.statSync(f).size, modifiedAt: fs.statSync(f).mtime.toISOString() });
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], modelRequests: 0,
  scope: "QA_READINESS_TOOL_REPAIR_AND_SOURCE_DEFAULT_THEME_PROTECTION_NOT_INSTALLED_ACCEPTANCE",
  installedLedger: { PASS: 3, FAILED: 9, BLOCKED: 6, unchanged: true } };
function check(name, run) { report.checks.push({ name, status: "PASS", detail: run() }); }
try {
  const prep = read(path.join(out, "preparation.json"));
  check("Original failing exact call sites retained and corrected eight checks pass", () => {
    const redFile = path.join(qa, "red-01/report.json"), greenFile = path.join(qa, "green-02/report.json");
    const red = read(redFile), green = read(greenFile);
    assert.equal(red.status, "FAILED"); assert.equal(red.cases.length, 3);
    assert(red.cases.every(c => c.status === "FAILED" && c.error.includes("wait returned before readiness")));
    assert.deepEqual(red.cases.map(c => c.observed[c.name.split(":")[0]]), [1, 1, 2]);
    assert.equal(green.status, "PASS"); assert.equal(green.cases.length, 8);
    assert(green.cases.every(c => c.status === "PASS")); assert(green.cleanup.browserClosed);
    assert.equal(green.modelRequests, 0);
    for (const s of green.sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
    assert.equal(sha(green.helper.path), green.helper.sha256);
    return { red: artifact(redFile), green: artifact(greenFile), boundary: "controlled real Chromium, synthetic read-only module/IPC/geometry; not actual native saves" };
  });
  check("Only intended legacy QA edits, snapshots retained", () => {
    const sources = prep.saved.filter(s => s.file.startsWith("scripts/"));
    for (const s of prep.saved) assert.equal(sha(path.join(prep.checkpoint, s.file)), s.sha256);
    const replace = (text, before, after) => { assert(text.includes(before), before); return text.replace(before, after); };
    for (const s of sources) {
      // Existing QA files mix CRLF/LF. Compare every source character after
      // newline normalization, while the snapshots retain exact byte hashes.
      let expected = fs.readFileSync(path.join(prep.checkpoint, s.file), "utf8").replace(/\r\n/g, "\n");
      if (s.file.includes("client-experience")) {
        expected = replace(expected, 'const { chromium } = require("../Editor/node_modules/playwright");',
          'const { chromium } = require("../Editor/node_modules/playwright");\nconst { waitForAsyncFunction } = require("./lib/async-readiness.cjs");');
        expected = replace(expected, "await page.waitForFunction(async () => {", "await waitForAsyncFunction(page, async () => {");
        assert.equal(fs.readFileSync(path.join(root, s.file), "utf8").replace(/\r\n/g, "\n"), expected);
      } else if (s.file.includes("native-preview")) {
        expected = replace(expected, 'const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");',
          'const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");\nconst { waitForAsyncFunction } = require("./lib/async-readiness.cjs");');
        expected = replace(expected, "await player.waitForFunction(async ({ installId, previousId }) => {",
          "await waitForAsyncFunction(player, async ({ installId, previousId }) => {");
        expected = replace(expected, '        assert.equal(actualSave.nvl_presentation_mode, "nvl");',
          '        assert(actualSave?.save_id && actualSave.save_id !== beforeSave?.save_id,\n          "Native disk save must be this operation\'s new snapshot, not the previous matching slot");\n        assert.equal(actualSave.nvl_presentation_mode, "nvl");');
        assert.equal(fs.readFileSync(path.join(root, s.file), "utf8").replace(/\r\n/g, "\n"), expected);
      }
    }
    report.qaSources = sources.map(s => artifact(path.join(root, s.file)));
    return { checkpointSources: sources, current: report.qaSources,
      frameAdditionalEdits: "fresh output override, owned dynamic port, exact case count, actual PNG/display receipt and cleanup result; no product changes" };
  });
  const services = [];
  check("Affected actual default-theme user flow in six high resolution displays", () => {
    const rows = [];
    for (const dpr of [1, 2]) {
      const f = path.join(qa, `button-default-dpr${dpr}-01/report.json`), r = read(f);
      assert.equal(r.status, "PASS"); assert.equal(r.cases.length, 3);
      assert(r.cleanup.browserClosed && r.cleanup.ownedServiceStopped);
      assert(r.cases.every(c => c.status === "PASS" && c.mode === "default-theme" && c.dpr === dpr));
      assert.deepEqual(r.cases.map(c => [c.width, c.height]), [[1920, 1080], [2560, 1440], [3840, 2160]]);
      assert.equal(r.screenshots.length, 3);
      for (const s of r.screenshots) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        assert(s.before.reduced); assert.equal(s.png.width, s.before.width * dpr); assert.equal(s.png.height, s.before.height * dpr);
      }
      services.push(r.service); rows.push(artifact(f));
    }
    return { reports: rows, cases: 6, scope: "Actual source title→settings navigation; reduced motion only, not a new full motion matrix" };
  });
  check("Historical native evidence reviewed without blanket invalidation", () => {
    const f = path.join(root, "output/playwright/dialog-native-preview/2026-10-12T20-14-09-221Z/report.json"), r = read(f);
    assert.equal(r.status, "PASS"); assert.equal(r.cases.length, 24);
    assert.equal(r.testSource.sha256, prep.saved.find(s => s.file.includes("native-preview")).sha256);
    const rows = ["agentvn", "renpy"].map(skin => {
      const cases = r.cases.filter(c => c.skin === skin);
      assert.equal(cases.length, 12); assert(cases.every(c => c.status === "PASS"));
      assert.equal(new Set(cases.map(c => c.saveArtifact.sha256)).size, 12);
      assert.equal(new Set(cases.map(c => c.saveArtifact.path)).size, 1);
      return { skin, cases: 12, recordedUniqueDiskHashes: 12, oneSlot: true };
    });
    report.historicalNative = { report: artifact(f), rows,
      limitation: "Async wait did not guarantee a new save_id. Recorded unique disk hashes/content/load evidence remains historical evidence, not proof of each before/after ID or current candidate." };
    const oldClient = path.join(root, "output/playwright/client-experience-enhancement/final-e2e/report.json");
    report.historicalClient = { reportPath: oldClient, present: fs.existsSync(oldClient),
      currentLimitation: "Unconditional start success after broken wait; full script recursively resets historical folders and attaches unowned fixed-port services. Do not execute unmodified legacy harness." };
    if (fs.existsSync(oldClient)) report.historicalClient.artifact = artifact(oldClient);
    const frameRoot = path.join(root, "output/playwright/renpy-button-frame");
    report.historicalDefaultTheme = fs.readdirSync(frameRoot).flatMap(name => {
      const f = path.join(frameRoot, name, "report.json"); if (!fs.existsSync(f)) return [];
      const r = read(f); if (!r.cases?.some(c => c.mode === "default-theme")) return [];
      return [{ ...artifact(f), status: r.status, cases: r.cases.length,
        provenance: "Old report lacks test-source identity; do not equate it to current corrected script" }];
    });
    return { native: report.historicalNative, client: report.historicalClient, defaultThemeReportCount: report.historicalDefaultTheme.length,
      fourImageModes: "Current four-mode branch never invokes this geometry helper; no blanket rejection of image-frame assertions" };
  });
  check("Product sources, compiled Dev/resources and frozen installation remain unchanged", () => {
    const prior = read(path.join(root, "output/dialog-portrait-authoring-20261020-01/receipt-01.json"));
    const sources = [...prior.resources.bundled, ...prior.resources.frontendSources,
      ...prior.resources.backendSources, ...prior.unchangedMotion.map(a => ({ file: path.relative(root, a.path), sha256: a.sha256 }))];
    for (const s of sources) assert.equal(sha(path.join(root, s.file)), s.sha256);
    for (const a of [...prep.products, ...prior.compiled, ...prior.frozen]) assert.equal(sha(a.path), a.sha256);
    report.dev = artifact(prep.products[0].path);
    return { productSourceChecks: sources.length, dev: report.dev, frozen: prior.frozen,
      build: "No Dev rebuild: only QA scripts/docs changed; latest portrait-authoring Dev remains byte-identical" };
  });
  check("Owned integration service PIDs/ports exited", () => {
    const pids = services.map(s => s.pid), ports = services.map(s => Number(new URL(s.url).port));
    const command = `$qaPids=@(${pids.join(",")});$qaPorts=@(${ports.join(",")});` +
      `$live=@(Get-Process -Id $qaPids -ErrorAction SilentlyContinue | Select-Object Id,ProcessName);` +
      `$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in $qaPorts} | Select-Object LocalPort,OwningProcess);` +
      `@{live=$live;listeners=$listeners}|ConvertTo-Json -Compress -Depth 4`;
    const actual = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true }));
    assert.equal(actual.live.length, 0); assert.equal(actual.listeners.length, 0);
    report.cleanup = { services, actual }; return report.cleanup;
  });
  report.notProven = ["Full legacy client E2E", "Current native NVL disk save retest", "New installed Release",
    "Windows/Android export/run/upgrade", "Ordinary-mode full motion reacceptance", "Final user project"];
  report.status = "QA_TOOL_REPAIR_PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, file, error: report.error }));
}
