"use strict";
// Independent current-author byte/cache audit, after the native refusal run.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const Zip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const [configFile, authorAttempt, nativeAttempt, auditAttempt] = process.argv.slice(2);
for (const n of [authorAttempt, nativeAttempt, auditAttempt]) assert.match(n || "", /^\d{2}$/);
const c = require("./candidate-layout-consumption.cjs").validateCandidateConfig(read(configFile));
const source = path.join(c.qa, `author-export-${authorAttempt}/report.json`), r = read(source);
const out = path.join(c.qa, `title-author-review-${auditAttempt}.json`);
assert(!fs.existsSync(out));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(source),
  tool: desc(__filename), scope: "INDEPENDENT_CURRENT_INSTALL_AUTHOR_ZIP_CACHE_AND_TITLE_VERSION_BOUNDARY_REVIEW",
  checks: [], modelRequests: 0, productChanges: 0, builds: 0, normalCloseClaimed: false };
async function check(name, fn) {
  report.checks.push({ name, status: "PASS", detail: await fn() });
}
(async () => {
  await check("Five real current-installed UI flows and unchanged installation/tools", () => {
    assert.equal(r.status, "PASS"); assert.equal(r.nativeCacheRestoration, "PASS");
    assert(r.finishedAt && !r.error && !r.cleanupError && !r.cacheCleanupError);
    assert.equal(r.steps.length, 5); assert(r.steps.every(s => s.status === "PASS" && s.finishedAt));
    const installed = read(path.join(c.qa, "derived-installed-01.json"));
    assert.equal(installed.executable.version, c.version);
    assert.equal(r.installation.sha256, sha(path.join(c.qa, "derived-installed-01.json")));
    for (const f of [...r.tools, installed.executable, ...installed.resources, ...installed.protectedFiles])
      assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.builds, 0);
    return { steps: 5, installation: r.installation };
  });
  await check("Native UI exports preserve script and isolate title capability by layout", async () => {
    assert.equal(r.cartridges.length, 2);
    const archives = [];
    for (const cartridge of r.cartridges) {
      assert.equal(sha(cartridge.path), cartridge.sha256);
      const z = await Zip.loadAsync(fs.readFileSync(cartridge.path), { checkCRC32: true });
      const m = JSON.parse(await z.file("manifest.json").async("string"));
      const l = JSON.parse(await z.file("ui/layout.json").async("string"));
      if (cartridge.layout === "renpy") {
        assert.equal(m.runtime_version, "0.26.0");
        assert.deepEqual(l.renpyTitleText, r.steps.find(s => s.detail?.expectedTitle).detail.expectedTitle);
      } else {
        assert.equal(cartridge.layout, "agentvn");
        assert.equal(l.renpyTitleText, undefined); assert.equal(m.runtime_version, "0.25.0");
      }
      archives.push({ layout: cartridge.layout, runtime: m.runtime_version, artifact: desc(cartridge.path) });
    }
    assert.equal(r.cartridges[0].scriptSha256, r.cartridges[1].scriptSha256);
    return archives;
  });
  await check("Explicit requested screenshot matrix, raw DPR preserved, exact PNG pixels", () => {
    assert.equal(r.screenshots.length, 3);
    for (const image of r.screenshots) {
      assert.equal(sha(image.path), image.sha256); assert.deepEqual(image.before, image.after);
      const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
      validateNativeViewport(image.before, expected);
      const bytes = fs.readFileSync(image.path);
      assert.equal(bytes.readUInt32BE(16), expected.width * expected.dpr);
      assert.equal(bytes.readUInt32BE(20), expected.height * expected.dpr);
    }
    return { screenshots: 3, dprTailTolerance: 1e-6, matrixSource: "installedReleaseSession default request" };
  });
  await check("Original native cache identity/bytes restored and exact Editor processes gone", () => {
    const guard = read(path.join(r.cacheDirectory, "native-cache-protection.json"));
    const restored = read(path.join(r.cacheDirectory, "native-cache-restoration.json"));
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    assert.equal(guard.directoryId, restored.originalDirectoryId);
    const id = execFileSync("fsutil.exe", ["file", "queryfileid", guard.original], { encoding: "utf8" });
    assert(id.includes(guard.directoryId));
    for (const file of guard.files) assert.equal(sha(path.join(guard.original, file.relative)), file.sha256);
    assert.equal(r.cleanups.length, r.launches.length); assert(r.cleanups.every(x => x.status === "PASS"));
    assert.equal(listeners(r.launches.flatMap(l => l.ports)).length, 0);
    const now = rows();
    assert(!now.some(p => r.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
    return { restored: desc(path.join(r.cacheDirectory, "native-cache-restoration.json")), originalDirectoryId: guard.directoryId };
  });
  await check("Independent complete old-native audit belongs to these current author bytes", () => {
    const f = path.join(c.qa, `title-old-audit-${nativeAttempt}/report.json`), audit = read(f);
    assert.equal(audit.status, "PASS"); assert.equal(audit.checks.length, 4);
    const native = read(audit.source.path);
    assert.equal(sha(audit.source.path), audit.source.sha256);
    assert.deepEqual(native.author, desc(source));
    return desc(f);
  });
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, out, error: report.error }));
});
