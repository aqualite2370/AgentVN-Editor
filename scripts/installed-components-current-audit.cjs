"use strict";
// Independent evidence/filesystem audit only. Does not operate product UI.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { validate } = require("./lib/installed-components-current-evidence.cjs");
const candidate = require("./lib/installed-components-candidate.cjs");
const { validateSolidComponentPreview } = require("./lib/component-preview-style-evidence.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Installed-Components-20261021-01";
const editorAttempt = process.argv[2] || "03", playerAttempt = process.argv[3] || "01", attempt = process.argv[4] || "01";
for (const n of [editorAttempt, playerAttempt, attempt]) assert.match(n, /^\d{2}$/);
const out = path.join(qa, `audit-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const editorFile = path.join(qa, `editor-${editorAttempt}/report.json`);
const playerFile = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-components-current-${playerAttempt}/report.json`;
const e = read(editorFile), r = read(playerFile);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), editor: desc(editorFile), player: desc(playerFile),
  scope: "CURRENT_INSTALLED_COMPONENT_ZIP_EVIDENCE_AUDIT_NOT_FULL_ACCEPTANCE", groups: [],
  productChanges: 0, modelRequests: 0, launches: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function group(name, fn) {
  const g = { name, status: "RUNNING" }; report.groups.push(g); save();
  try { g.detail = await fn(); g.status = "PASS"; console.log(`PASS ${name}`); }
  catch (err) { g.status = "FAILED"; g.error = String(err.stack || err); throw err; } finally { save(); }
}
function playerValid(q) {
  assert.equal(q.status, "PASS"); assert.equal(q.version, candidate.expected.version);
  assert.equal(q.scope, "CURRENT_INSTALLED_PLAYER_COMPONENT_ZIP_UNMODIFIED_UI_CARTRIDGE");
  assert.equal(q.source.sha256, sha(editorFile)); assert.equal(q.cases.length, 12);
  const keys = q.cases.map(c => `${c.width}/${c.height}/${c.dpr}/${c.reduced}`);
  assert.equal(new Set(keys).size, 12);
  for (const w of [1920, 2560, 3840]) for (const d of [1, 2]) for (const b of [false, true])
    assert(keys.includes(`${w}/${w * 9 / 16}/${d}/${b}`));
  for (const c of q.cases) {
    assert.equal(c.status, "PASS"); assert.equal(c.components.length, 3); assert.equal(c.actions.length, 3);
    assert.equal(new Set(c.components.map(x => x.id)).size, 3);
    for (const x of c.components) {
      validateNativeViewport(x.viewport, c); assert(x.hit && x.overflow <= 1); assert.equal(x.images.length, 2);
      assert.equal(x.title, e.cartridge.manifest.title);
      for (const i of x.images) assert(i.width === 48 && i.height === 32
        && e.cartridge.assetEntries.some(a => a.id === i.id && a.sha256 === i.sha256));
    }
    assert(c.actions.every(a => a.status === "PASS" && a.returned));
    assert.deepEqual(c.actions.map(a => a.component).sort(), c.components.map(x => x.id).sort());
  }
  assert(q.story.actualStoryEntered && q.story.text.includes("QA_COMPONENT_ZIP_CURRENT_STORY"));
  assert.equal(q.cleanups.length, 1); assert.equal(q.cleanups[0].status, "PASS");
  assert(q.profileRestored && q.protectedUnchanged); assert.deepEqual(q.errors, []);
  assert.equal(q.modelRequests, 0); assert.equal(q.productChanges, 0);
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  const inherited = e.continuation ? read(e.continuation.source.path) : undefined;
  await group("Exact current installation, precise inherited steps and nonempty installed evidence", () => {
    validate(e, candidate.expected); playerValid(r); assert.equal(sha(r.source.path), r.source.sha256);
    assert.equal(path.resolve(e.installation.path), path.resolve(candidate.installationFile));
    for (const f of [e.installation, e.executable, r.executable, e.archive, e.portable, e.cartridge, e.input, ...e.protectedFiles])
      assert.equal(sha(f.path), f.sha256, f.path);
    const install = read(e.installation.path);
    assert.equal(install.status, "PASS");
    assert.equal(candidate.current ? install.version : install.executable.version, candidate.expected.version);
    assert.equal(install.executable.sha256, candidate.expected.sha256);
    assert.equal(path.resolve(r.executable.path), path.resolve(install.installRoot, "agentvn-player.exe"));
    const runtime = install.resources.find(f => path.resolve(f.path) === path.resolve(r.executable.path));
    assert(runtime); assert.equal(runtime.sha256, r.executable.sha256);
    report.candidateEditorVersion = candidate.expected.version;
    report.actualPlayerVersion = JSON.parse(ps(
      `(Get-Item -LiteralPath '${r.executable.path.replace(/'/g, "''")}').VersionInfo | Select-Object FileVersion,ProductVersion | ConvertTo-Json -Compress`));
    report.playerVersionScope = "Existing sealed preview binary supplied by Editor; report.version identifies the Editor candidate";
    assert.deepEqual(r.cartridge, e.cartridge);
    if (inherited) {
      assert.equal(sha(e.continuation.source.path), e.continuation.source.sha256);
      assert.equal(inherited.status, "FAILED"); assert(inherited.error.includes("hash_sha256"));
      for (let i = 0; i < 7; i++) {
        const { inheritedFrom, ...copied } = e.steps[i];
        assert.equal(inheritedFrom, e.continuation.source.sha256); assert.deepEqual(copied, inherited.steps[i]);
        assert.equal(inherited.steps[i].status, "PASS");
      }
      assert.deepEqual(e.cases, inherited.cases); assert.deepEqual(e.matrix, inherited.matrix);
      for (const key of ["archive", "portable", "restart", "authoredProject", "authoredLibrary", "downloadCleanup"])
        assert.deepEqual(e[key], inherited[key]);
      assert.equal(inherited.launches[0].executable.path, e.executable.path);
      assert.notEqual(inherited.launches[0].pid, inherited.launches[1].pid);
      assert.notEqual(inherited.launches[0].backend.ProcessId, inherited.launches[1].backend.ProcessId);
    }
    const badPlayer = [
      q => { q.cases = []; }, q => { q.cases[1] = q.cases[0]; }, q => { q.cases[0].components.pop(); },
      q => { q.cases[0].components[0].images[0].sha256 = "0".repeat(64); },
      q => { q.cases[0].actions.pop(); }, q => { q.cases[0].actions[0].returned = false; },
      q => { q.profileRestored = false; }, q => { q.modelRequests = 1; }, q => { q.story.actualStoryEntered = false; },
    ];
    for (const mutate of badPlayer) { const q = structuredClone(r); mutate(q); assert.throws(() => playerValid(q)); }
    return { inheritedPassedSteps: inherited ? 7 : 0, currentNewSteps: e.steps.length - (inherited ? 7 : 0),
      playerCounterexamplesRejected: badPlayer.length, oldFailureRetained: inherited?.status };
  });
  await group("ZIP exact allowlisted entry set and dependency bytes; portable and cartridge do not alias personal originals", async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(e.archive.path), { checkCRC32: true });
    const m = JSON.parse(await zip.file("manifest.json").async("string"));
    assert.deepEqual(Object.keys(m).sort(), ["components", "format", "schemaVersion"]);
    assert.equal(m.components.length, 2); const entries = ["manifest.json"];
    for (const c of m.components) {
      assert.equal(c.assets.length, 2);
      for (const a of c.assets) { entries.push(a.path); assert.equal(hash(await zip.file(a.path).async("nodebuffer")), a.sha256); }
      const imported = e.finalLibrary.find(l => l.name === c.name); assert(imported); assert.notEqual(imported.id, c.id);
      assert.equal(imported.html, c.html); assert.equal(imported.css, c.css);
      assert.deepEqual(imported.assets.map(a => a.sha256), c.assets.map(a => a.sha256));
    }
    assert.deepEqual(Object.values(zip.files).filter(f => !f.dir).map(f => f.name).sort(), entries.sort());
    for (const archive of [e.portable, e.cartridge]) {
      const z = await JSZip.loadAsync(fs.readFileSync(archive.path), { checkCRC32: true });
      for (const a of archive.assetEntries) {
        assert.equal(hash(await z.file(a.path).async("nodebuffer")), a.sha256);
        assert(e.images.some(i => i.sha256 === a.sha256));
      }
    }
    const portable = e.portable.project;
    assert.deepEqual(portable.editor_settings.runtimeUILayoutProfiles, e.authoredProject.settings.runtimeUILayoutProfiles);
    assert.deepEqual(e.finalProject.nodes, e.authoredProject.nodes); assert.deepEqual(e.finalProject.edges, e.authoredProject.edges);
    assert.deepEqual(e.finalProject.settings.runtimeUILayoutProfiles.profiles.agentvn,
      e.authoredProject.settings.runtimeUILayoutProfiles.profiles.agentvn);
    const original = e.authoredProject.settings.runtimeUILayout.screens.find(s => s.screen_id === "title").components
      .filter(c => c.component_type === "custom_component");
    const final = e.cartridge.layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
    assert.equal(original.length, 2); assert.equal(final.length, 3);
    for (const c of original) assert.deepEqual(final.find(f => f.component_id === c.component_id), c);
    const z = await JSZip.loadAsync(fs.readFileSync(e.cartridge.path)), checksum = JSON.parse(await z.file("checksum.json").async("string"));
    for (const f of checksum.files) { const bytes = await z.file(f.path).async("nodebuffer");
      assert.equal(bytes.length, f.size_bytes); assert.equal(hash(bytes), f.hash_sha256); }
    return { archiveComponents: 2, archiveDependencies: 4, portableAssets: 4, cartridgeComponents: 3, cartridgeAssets: 6 };
  });
  await group("Independent SQLite copies prove persistent original and imported project graph, layout and exact image bytes", () => {
    const proofs = [];
    for (const [name, launch, expected] of [
      ["author", (inherited || e).launches[0], e.authoredProject],
      ["fresh", e.launches.at(-1), e.finalProject],
    ]) {
      const dbRoot = path.join(launch.data, "backend"), dir = path.join(out, `sqlite-${name}`); fs.mkdirSync(dir);
      for (const file of ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]) {
        const source = path.join(dbRoot, file); if (!fs.existsSync(source)) continue;
        const copy = path.join(dir, file); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL); assert.equal(sha(copy), sha(source));
      }
      const db = new DatabaseSync(path.join(dir, "vn_engine.db"), { readOnly: true });
      try {
        const row = db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(expected.id); assert(row);
        const p = JSON.parse(row.project_json); assert.equal(p.asset_manifest.length, expected.assets.length);
        assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles, expected.settings.runtimeUILayoutProfiles);
        assert.deepEqual(p.editor_settings.runtimeUILayout, expected.settings.runtimeUILayout);
        assert.deepEqual(p.nodes.map(({ selected, measured, dragging, ...n }) => n), expected.nodes);
        assert.deepEqual(p.edges.map(({ selected, ...n }) => n), expected.edges);
        for (const a of p.asset_manifest) {
          let bytes;
          if (a.metadata.data_url?.startsWith("data:")) bytes = Buffer.from(a.metadata.data_url.split(",")[1], "base64");
          else {
            const rel = path.relative(path.join(dbRoot, "project_assets"), a.metadata.filePath);
            assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel)); bytes = fs.readFileSync(a.metadata.filePath);
          }
          assert.equal(hash(bytes), expected.assets.find(x => x.asset_id === a.asset_id).observedContentSha256);
        }
      } finally { db.close(); }
      proofs.push({ name, database: desc(path.join(dir, "vn_engine.db")), assets: expected.assets.length });
    }
    return proofs;
  });
  await group("Hostile archive checks, actual 12-combination input geometry and 36 component menu roundtrips", () => {
    for (const c of e.cases) { assert.equal(sha(c.file.path), c.file.sha256);
      assert(c.message.includes("组件包未通过检查") && c.noPollution); }
    for (const c of e.matrix) {
      assert(c.hit && c.stable && c.overflow <= 1);
      assert(c.rect.left >= c.sidebar.left - 1 && c.rect.right <= c.sidebar.right + 1
        && c.rect.top >= 0 && c.rect.bottom <= c.height + 1);
      assert.equal(c.frames.length, 5);
      assert(c.frames.every(f => Math.abs(f.x - c.frames[0].x) < 1 && Math.abs(f.width - c.frames[0].width) < 1));
    }
    for (const c of r.cases) {
      for (const x of c.components) {
        const b = x.box, a = x.button;
        assert(b.left >= 0 && b.top >= 0 && b.right <= c.width + 1 && b.bottom <= c.height + 1);
        assert(a.left >= b.left && a.top >= b.top && a.right <= b.right + 1 && a.bottom <= b.bottom + 1);
      }
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        const a = c.components[i].box, b = c.components[j].box;
        assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      }
    }
    const shots = [...(inherited?.screenshots || []), ...e.screenshots, ...r.screenshots];
    for (const s of shots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after); validateNativeViewport(s.before, s.after);
      const b = fs.readFileSync(s.path), dpr = Math.round(s.before.dpr);
      assert([1, 2].includes(dpr) && Math.abs(dpr - s.before.dpr) <= 1e-6);
      assert.equal(b.readUInt32BE(16), s.before.width * dpr);
      assert.equal(b.readUInt32BE(20), s.before.height * dpr);
    }
    return { hostileArchives: 11, authorMatrix: e.matrix.length, playerMatrix: r.cases.length,
      componentImages: r.cases.reduce((n, c) => n + c.components.reduce((n, x) => n + x.images.length, 0), 0),
      menuRoundtrips: r.cases.reduce((n, c) => n + c.actions.length, 0), screenshots: shots.length };
  });
  if (candidate.current) await group("Current authored and imported previews preserve declared solid background across all twelve displays", () => {
    assert.equal(e.previewStyles.length, 14);
    for (const preview of e.previewStyles) validateSolidComponentPreview(preview.samples);
    report.previewFeatureStatus = "PASS";
    return { probes: e.previewStyles.length, stableFrames: e.previewStyles.reduce((n, p) => n + p.samples.length, 0),
      backgroundImage: "none", legacyFailuresUnchanged: true };
  });
  else await group("Independent full style check retains the narrower color-only PASS but detects undeclared Editor gradient", () => {
    const file = path.join(qa, "editor-06/report.json"), probe = read(file);
    const wrong = read(path.join(qa, "editor-05/report.json"));
    assert.equal(wrong.status, "FAILED"); assert.equal(wrong.samples.at(-1).label, "待导入组件");
    assert.throws(() => validateSolidComponentPreview(wrong.samples));
    assert.equal(probe.status, "PASS"); assert(probe.styleMatchesDeclared && probe.projectUnchanged);
    assert.equal(probe.samples.length, 24);
    assert(e.archive.manifest.components.every(c => !/background-image\s*:|background\s*:/.test(c.css)));
    const last = probe.samples.slice(-8);
    assert(last.every(s => s.inline.backgroundColor === "rgb(34, 51, 68)" && s.inline.color === "rgb(255, 255, 255)"
      && s.actual.backgroundColor === s.inline.backgroundColor && s.actual.color === s.inline.color
      && s.actual.backgroundImage.startsWith("linear-gradient(") && s.hovered === false && s.label.startsWith("分享组件")));
    assert(last.every(s => JSON.stringify(s.actual) === JSON.stringify(last[0].actual)));
    assert.throws(() => validateSolidComponentPreview(probe.samples), /Undeclared Editor background/);
    const shot = probe.screenshot;
    assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after); validateNativeViewport(shot.before, shot.after);
    const b = fs.readFileSync(shot.path);
    assert.equal(b.readUInt32BE(16), shot.before.width * shot.before.dpr);
    assert.equal(b.readUInt32BE(20), shot.before.height * shot.before.dpr);
    report.previewFeatureStatus = "FAILED"; report.zipFunctionalStatus = "LIMITED_PASS";
    return { source: desc(file), originalColorOnlyProbeStatus: probe.status, solidComponentPreviewStatus: "FAILED",
      samples: probe.samples.length, stableMismatchFrames: last.length, computed: last[0].actual,
      productChanged: false, matrixScope: "1080p DPR1 ordinary installed Editor, not full visual matrix" };
  });
  await group("All attempts restored original cache/profile identities and bytes; exact process/port ownership is now clean", () => {
    const attempts = candidate.current
      ? fs.readdirSync(qa).filter(name => /^editor-\d{2}$/.test(name))
        .filter(name => read(path.join(qa, name, "report.json")).version === candidate.expected.version).map(name => name.slice(7))
      : ["01", "02", "03", editorAttempt, "05", "06"];
    const editors = attempts.filter((n, i, a) => a.indexOf(n) === i)
      .map(n => ({ file: path.join(qa, `editor-${n}/report.json`), value: read(path.join(qa, `editor-${n}/report.json`)) }));
    for (const { file, value } of editors) {
      assert(value.cacheRestored && value.protectedUnchanged); const journal = read(path.join(path.dirname(file), "native-cache-protection.json"));
      assert.equal(read(path.join(path.dirname(file), "native-cache-restoration.json")).status, "PASS"); assert(!fs.existsSync(journal.held));
      if (journal.existed) {
        assert(ps(`fsutil.exe file queryfileid '${journal.original}'`).toLowerCase().includes(journal.directoryId));
        for (const f of journal.files) assert.equal(sha(path.join(journal.original, f.relative)), f.sha256);
      }
    }
    const profile = read(path.join(path.dirname(playerFile), "profile-protection.json"));
    assert.equal(sha(r.profileRestoration.path), r.profileRestoration.sha256);
    assert.equal(read(r.profileRestoration.path).status, "PASS");
    for (const p of profile.records) {
      assert(!fs.existsSync(p.held));
      if (p.existed) {
        assert(ps(`fsutil.exe file queryfileid '${p.original}'`).toLowerCase().includes(p.directoryId));
        if (p.byteInventory) for (const f of p.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
      }
    }
    for (const f of e.protectedFiles) assert.equal(sha(f.path), f.sha256);
    assert(!fs.existsSync(e.downloadCleanup.removed.path));
    assert.equal(sha(e.portable.path), e.downloadCleanup.removed.sha256);
    const all = [...editors.map(e => e.value), r], known = all.flatMap(q => q.knownProcesses);
    const id = p => `${p.ProcessId}:${p.Created}`, active = rows();
    assert(!active.some(p => known.some(k => id(k) === id(p))));
    const dirs = [...editors.map(e => path.dirname(e.file)), path.dirname(playerFile)];
    assert(!active.some(p => p.Name === "msedgewebview2.exe" && dirs.some(d => (p.CommandLine || "").includes(d))));
    const ports = [...editors.flatMap(e => e.value.launches.flatMap(l => l.ports)), ...r.launches.map(l => l.port)];
    assert.deepEqual(listeners(ports), []);
    for (const q of editors.map(e => e.value)) assert.deepEqual(q.gitBefore, q.gitAfter);
    for (const q of all) for (const s of q.snapshots || []) assert.equal(sha(s.copy.path), s.source.sha256);
    return { identities: new Set(known.map(id)).size, ports, protectedPaths: new Set(e.protectedFiles.map(f => f.path)).size,
      sourcePortableRetained: e.portable.path, deletedUserFiles: 0 };
  });
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
  console.log(JSON.stringify({ status: report.status, groups: report.groups.length, error: report.error, out })); });
