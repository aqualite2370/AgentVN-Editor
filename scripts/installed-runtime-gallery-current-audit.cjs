"use strict";
// Independent evidence-only audit. Does not launch a product, model or device.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { validate } = require("./installed-runtime-gallery-current.cjs");
const { auditReturnTrace } = require("./lib/gallery-return-trace-audit.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const digest = b => crypto.createHash("sha256").update(b).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
const attempt = process.argv[2] || "01", audit = process.argv[3] || "01";
assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
const source = path.join(base, `installed-gallery-current-${attempt}`);
const out = path.join(base, `installed-gallery-current-${attempt}-audit-${audit}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), groups: [],
  scope: "ACTUAL_INSTALLED_LIBRARY_GALLERY_EVIDENCE_NOT_NEW_EDITOR_EXPORT_OR_STANDALONE",
  productChanges: 0, modelRequests: 0, launches: 0 };
async function group(name, fn) {
  const c = { name, status: "RUNNING" }; report.groups.push(c);
  try { c.detail = await fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
}
(async () => {
  const s = read(path.join(source, "installed-session.json")), r = read(path.join(source, "report.json"));
  validate(s, r); report.session = desc(path.join(source, "installed-session.json")); report.raw = desc(path.join(source, "report.json"));
  await group("Actual installation, exact source snapshots and nonempty complete business/fault matrix evidence", () => {
    for (const f of [s.installation, s.executable, ...s.protectedFiles, ...r.products, ...r.tools, ...r.sources,
      ...r.cartridges, ...r.brokenCartridges, r.profileRestoration]) assert.equal(sha(f.path), f.sha256, f.path);
    for (const f of s.snapshots) {
      assert.equal(sha(f.copy.path), f.copy.sha256); assert.equal(f.source.sha256, f.copy.sha256);
      if (/\.(cjs|ps1)$/.test(f.source.path)) assert.equal(sha(f.source.path), f.source.sha256);
    }
    const invalid = [
      a => { a[0].status = "RUNNING"; }, a => { a[0].version = "1.9.13"; },
      a => { a[0].executable.sha256 = "wrong"; }, a => { a[0].commands.pop(); },
      a => { a[0].commands[0].exitCode = 1; }, a => { a[0].gitAfter.index = "changed"; },
      a => { a[0].modelRequests = 1; }, a => { a[0].builds = 1; },
      a => { a[1].cases = []; }, a => { a[1].pageErrors.push("ignored"); },
      a => { a[1].cases.find(c => c.name.startsWith("Manual replay")).detail.previous.index = 2; },
      a => { a[1].cases.find(c => c.name.startsWith("Title-origin")).detail.outcomes[0].final.scene = "qa_gallery"; },
      a => { a[1].cases.find(c => c.name.startsWith("Replay ends")).detail.rollbackRoundTrip.restored.index = 0; },
      a => { a[1].matrix = []; }, a => { a[1].faultMatrix = []; },
      a => { a[1].faultMatrix[1] = a[1].faultMatrix[0]; },
      a => { a[1].faultMatrix[0].diagnostic = ""; },
      a => { a[1].faultMatrix[0].geometry.controls[0].clipped = true; },
      a => { a[1].faultMatrix[0].geometry.overflow = 100; },
      a => { a[1].matrix[0].geometry.controlsRoot = "content-only"; },
      a => { a[1].returnTraces = []; },
      a => { a[1].returnTraces[0].final.screen = "gallery"; },
      a => { a[1].interactions[0].inputs[0].trusted = false; },
      a => { a[1].launches[0].identity.ExecutablePath = "D:\\AgentVN\\agentvn-player.exe"; },
      a => { a[1].launches[0].cleanup.status = "FAILED"; },
      a => { a[1].screenshots.pop(); },
      a => { a[1].notRun = a[1].notRun.filter(n => n !== "Android"); },
    ];
    for (const mutate of invalid) { const a = structuredClone([s, r]); mutate(a); assert.throws(() => validate(...a)); }
    return { version: s.version, businessCases: 16, displayCases: 24, faultyImageDisplayCases: 24,
      rejectedVariants: invalid.length, snapshots: s.snapshots.length,
      protectedDistinctPaths: new Set(s.protectedFiles.map(f => path.resolve(f.path))).size };
  });
  await group("Four controlled ZIP derivatives have complete checksum, image and script/layout byte provenance", async () => {
    for (const c of [...r.cartridges, ...r.brokenCartridges]) {
      const zip = await JSZip.loadAsync(fs.readFileSync(c.path));
      const checksum = JSON.parse(await zip.file("checksum.json").async("string"));
      const listed = checksum.files.map(f => f.path).toSorted();
      const actual = Object.values(zip.files).filter(f => !f.dir && f.name !== "checksum.json").map(f => f.name).toSorted();
      assert.deepEqual(listed, actual); assert.equal(new Set(listed).size, listed.length);
      for (const entry of checksum.files) {
        const b = await zip.file(entry.path).async("nodebuffer"); assert.equal(b.length, entry.size_bytes);
        assert.equal(digest(b), entry.hash_sha256);
      }
      const b = await zip.file(c.art.path).async("nodebuffer");
      assert.equal(digest(b), c.art.sha256); assert.equal(b.length, c.art.bytes);
      assert.equal(digest(await zip.file("script.json").async("nodebuffer")), c.scriptSha256);
      assert.equal(digest(await zip.file("ui/layout.json").async("nodebuffer")), c.layoutSha256);
      assert.equal(sha(c.original.path), c.original.sha256);
    }
    for (const layout of ["agentvn", "renpy"]) {
      const a = r.cartridges.find(c => c.layout === layout), b = r.brokenCartridges.find(c => c.layout === layout);
      assert.equal(a.layoutSha256, b.layoutSha256); assert.equal(a.scriptSha256, b.scriptSha256);
    }
    return { cartridges: 4, deliberateInvalidImage: 2, checksumFaultNotFaked: true,
      newEditorGalleryExportClaim: false, source: "CONTROLLED_DERIVATIVE_OF_HISTORICAL_REAL_UI_EXPORT" };
  });
  await group("Native gallery JSON and exact loaded resources survive restart; no forbidden scene or save mutation claim hidden", () => {
    for (const layout of ["agentvn", "renpy"]) {
      const c = r.cases.find(c => c.layout === layout && c.name.startsWith("Real story progression")).detail;
      const archived = path.join(source, "player-roaming/gallery", path.basename(path.dirname(c.physical.path)), path.basename(c.physical.path));
      assert.equal(sha(archived), c.physical.sha256); assert.deepEqual(read(archived), c.record);
      assert.equal(c.assetSha256, r.cartridges.find(c => c.layout === layout).art.sha256);
    }
    const inputs = r.interactions.flatMap(i => i.inputs);
    const warnings = r.console.filter(c => c.type === "warning"), errors = r.console.filter(c => c.type === "error");
    assert.equal(errors.length, 0, "Unclassified renderer error");
    for (const w of warnings) assert(w.injectedBrokenImage === true
      && /^\[AgentVN Player\] Asset prewarm skipped: qa_gallery_art Error: image failed to load: blob:http:\/\/tauri\.localhost\//.test(w.text),
    "A warning outside this exact installed binary's controlled broken-image scenario needs review");
    return { nativeGalleryRecords: 2, serializedFormat: "CURRENT_NOT_TRUSTED_LEGACY_SAMPLE",
      trustedInputs: inputs.length, pageUp: inputs.filter(i => i.key === "PageUp").length,
      pageDown: inputs.filter(i => i.key === "PageDown").length,
      browserConsoleWarnings: warnings, browserConsoleErrors: errors,
      newAudioListeningClaim: false, recordedVoiceFixture: false };
  });
  await group("Actual target ownership and return trace frames complete without fixed-delay sampling", () => {
    assert.equal(r.returnTraces.length, 12);
    const immediateSource = r.returnTraces.filter(t => t.immediate.screen === "gallery");
    const executedSampler = s.snapshots.find(f => /native-runtime-gallery\.cjs$/.test(f.source.path));
    assert(executedSampler);
    const sampler = fs.readFileSync(executedSampler.copy.path, "utf8");
    assert(sampler.includes("sample(performance.now());") && sampler.includes("requestAnimationFrame(sample);"));
    const timings = r.returnTraces.map(auditReturnTrace);
    for (const layout of ["agentvn", "renpy"]) {
      const traces = r.returnTraces.filter(t => t.layout === layout);
      assert.equal(traces.length, 6);
      assert.equal(traces.filter(t => t.expected === "title_menu").length, 3);
      assert.equal(traces.filter(t => t.expected === "main_menu").length, 3);
    }
    return { returns: 12, actualFrames: timings.reduce((n, t) => n + t.renderedFrames, 0),
      synchronousSeedsNotCountedAsFrames: timings.length,
      firstFrameTimestampsBeforeSeed: timings.filter(t => t.firstFrameTimestampBeforeSeed).length,
      timingBoundary: "Synchronous performance.now seed kept separate; all rAF timestamps strictly audited in original array order",
      immediateSourcePageReadings: immediateSource.length, finalDestinationAlwaysVerified: true,
      fullMotionOrVisualAuditClaim: false };
  });
  await group("All12 PNGs retain actual WebView parameters, raw DPR and exact device pixel sizes", () => {
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const b = fs.readFileSync(s.path), d = Math.round(s.before.dpr);
      assert([1, 2].includes(d) && Math.abs(d - s.before.dpr) < 1e-6);
      assert.equal(b.readUInt32BE(16), s.before.width * d); assert.equal(b.readUInt32BE(20), s.before.height * d);
      assert.equal(s.png.width, b.readUInt32BE(16)); assert.equal(s.png.height, b.readUInt32BE(20));
    }
    return { screenshots: 12, actualWebViewMetricsNotPhysical4K: true };
  });
  await group("User profile directory identity and recorded bytes restored; six native roots/ports and owned WebViews absent", () => {
    const journal = read(path.join(source, "profile-protection.json")), restored = read(r.profileRestoration.path);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const old of journal.records) {
      const now = restored.restored.find(p => p.original === old.original); assert(now);
      assert.equal(now.directoryId, old.directoryId); assert.deepEqual(now.files, old.files);
      assert(!fs.existsSync(old.held)); if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
      for (const f of old.files) assert.equal(sha(path.join(old.original, f.relative)), f.sha256);
      if (old.existed) {
        const p = spawnSync("fsutil.exe", ["file", "queryfileid", old.original], { encoding: "utf8", windowsHide: true });
        assert.equal(p.status, 0); assert(p.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
      }
    }
    const active = rows();
    for (const l of r.launches) {
      const ms = Number(l.identity.CreationDate.match(/\d+/)[0]);
      assert(!active.some(p => p.ProcessId === l.pid && Date.parse(p.Created) === ms));
    }
    assert(!active.some(p => p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
    const ports = r.launches.map(l => l.port); assert.deepEqual(listeners(ports), []);
    return { rootProcesses: 6, ports, userFilesDeleted: 0, normalNativeWindowCloseClaim: false,
      limitation: "Recorded root identities, not every historical descendant process identity; Local bytes not fully inventoried." };
  });
  if (attempt !== "01") await group("Original first-attempt failures, executed QA sources and cleanup remain independently preserved", () => {
    const original = path.join(base, "installed-gallery-current-01");
    const first = read(path.join(original, "installed-session.json")), raw = read(path.join(original, "report.json"));
    assert.equal(first.status, "FAILED"); assert.equal(raw.status, "FAILED");
    assert.equal(raw.cleanupError, null); assert.equal(raw.error, null); assert.deepEqual(raw.pageErrors, []);
    const failed = raw.cases.filter(c => c.status === "FAILED"); assert.equal(failed.length, 3);
    assert.equal(failed.filter(c => c.name.startsWith("Replay ends") && c.error.includes("'gallery'")).length, 2);
    assert.equal(failed.filter(c => c.name.startsWith("Gallery-only") && c.error.includes("g.controls.length > 1")).length, 1);
    assert.equal(read(raw.profileRestoration.path).status, "PASS");
    for (const f of [...first.protectedFiles, ...raw.products, ...raw.tools, raw.profileRestoration])
      assert.equal(sha(f.path), f.sha256, f.path);
    for (const snapshot of first.snapshots) {
      assert.equal(sha(snapshot.copy.path), snapshot.copy.sha256); assert.equal(snapshot.copy.sha256, snapshot.source.sha256);
    }
    const originalFrames = raw.returnTraces || [];
    assert.equal(originalFrames.length, 0, "Do not invent first-attempt transition frames");
    const active = rows();
    for (const l of raw.launches) {
      const ms = Number(l.identity.CreationDate.match(/\d+/)[0]);
      assert(!active.some(p => p.ProcessId === l.pid && Date.parse(p.Created) === ms));
    }
    assert(!active.some(p => p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(original)));
    assert.deepEqual(listeners(raw.launches.map(l => l.port)), []);
    return { session: desc(path.join(original, "installed-session.json")), raw: desc(path.join(original, "report.json")),
      originalFailures: 3, originalReturnFrames: 0, originalRootProcessesAbsent: raw.launches.length,
      originalPortsAbsent: raw.launches.map(l => l.port), originalFailureNotRewritten: true,
      attribution: "QA target-completion and shared-frame scan defects; original missing frames not retroactively fabricated." };
  });
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  const timingTool = path.join(__dirname, "lib/gallery-return-trace-audit.cjs");
  report.timingTool = desc(timingTool);
  fs.copyFileSync(timingTool, path.join(out, "executed-gallery-return-trace-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, groups: report.groups.map(g => ({ name: g.name, status: g.status })),
    error: report.error }, null, 2));
});
