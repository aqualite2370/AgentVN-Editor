"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { assertAssistantExportLayout } = require("./lib/assistant-export-layout.cjs");
const currentCandidate = process.argv.includes("--candidate=1.9.22"), expectedVersion = currentCandidate ? "1.9.22" : "1.9.14";
const qa = currentCandidate ? "F:/AgentVN/QA/Installed-Assistant-Export-1922-20261022-01" :
  "F:/AgentVN/QA/Installed-Assistant-Export-20261021-01";
const ea = process.argv[2] || "01", pa = process.argv[3] || "01", aa = process.argv[4] || "01";
for (const a of [ea, pa, aa]) assert.match(a, /^\d{2}$/);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const eroot = path.join(qa, `editor-${ea}`), proot = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-assistant-export-${currentCandidate ? "1922-" : ""}${pa}`;
const out = path.join(qa, `audit-${aa}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const efile = path.join(eroot, "report.json"), pfile = path.join(proot, "report.json"), e = read(efile), p = read(pfile);
const evidenceRoot = e.priorEvidence ? path.dirname(e.priorEvidence.path) : eroot;
const report = { status: "RUNNING", startedAt: new Date().toISOString(), editor: desc(efile), player: desc(pfile),
  groups: [], scope: "ACTUAL_INSTALLED_REIMPORT_UI_EXPORT_PLAYER_CONSUMPTION_NOT_STANDALONE_OR_ANDROID" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function check(label, fn) {
  const g = { label, status: "RUNNING" }; report.groups.push(g); save();
  try { g.result = await fn(); g.status = "PASS"; console.log(`PASS ${label}`); }
  catch (err) { g.status = "FAILED"; g.error = String(err.stack || err); throw err; } finally { save(); }
}
function matrix(r, player) {
  assert.equal(r.cases.length, 12); const seen = new Set();
  for (const c of r.cases) {
    assert([1920, 2560, 3840].includes(c.width) && [1, 2].includes(c.dpr) && typeof c.reduced === "boolean");
    assert.equal(c.height, c.width * 9 / 16); assert.equal(c.status, "PASS");
    const k = `${c.width}/${c.dpr}/${c.reduced}`; assert(!seen.has(k)); seen.add(k);
    if (player) {
      assert.equal(c.components.length, 2); assert.equal(c.actions.length, 2);
      for (const component of c.components) {
        validateNativeViewport(component.viewport, c);
        assert(component.hit && component.overflow <= 1 && component.box.left >= 0 && component.box.top >= 0
          && component.box.right <= c.width + 1 && component.box.bottom <= c.height + 1);
        assert.equal(component.title, e.cartridge.manifest.title);
        assert.equal(component.images.length, 1);
        assert(component.images[0].width === 1 && component.images[0].height === 1 && component.images[0].sha256 === e.image.sha256);
        assert(component.button.left >= component.box.left && component.button.top >= component.box.top &&
          component.button.right <= component.box.right + 1 && component.button.bottom <= component.box.bottom + 1);
      }
      assert.deepEqual(c.actions.map(a => a.target), ["about", "help"]);
      assert(c.actions.every(a => a.status === "PASS" && a.returned));
      const [a, b] = c.components.map(v => v.box);
      assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    } else {
      validateNativeViewport(c.viewport, c); assert(c.focus && c.geometry.hit && c.geometry.overflow <= 1);
      const b = c.geometry.rect;
      assert(b.width > 0 && b.height > 0 && b.left >= 0 && b.top >= 0 && b.right <= c.width + 1 && b.bottom <= c.height + 1);
    }
  }
  return seen.size;
}
async function main() {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  await check("Nonempty installed Editor flow, Player source and exact installed identities/tools", () => {
    if (e.priorEvidence) {
      assert(currentCandidate); assert.equal(sha(e.priorEvidence.path), e.priorEvidence.sha256);
      const prior = read(e.priorEvidence.path);
      assert.equal(prior.status, "FAILED"); assert.equal(prior.finishedAt !== undefined, true);
      assert.match(prior.error, /style: \{/); assert.equal(prior.steps[2].status, "FAILED");
      assert.equal(e.priorEvidence.newExportRequests, 0); assert.equal(e.priorEvidence.newLaunches, 0);
      for (const k of ["launches", "cleanups", "screenshots", "cases", "knownProcesses", "persisted", "reimportedAssets"])
        assert.deepEqual(e[k], prior[k]);
      assert.equal(e.steps[2].result.rejectedInvalidLayoutVariants, 4);
      assert.equal(e.steps[2].result.canonicalizedIgnoredTitleStyles.length, 6);
      assert.equal(path.dirname(e.cartridge.path), path.join(evidenceRoot, "cartridge"));
    }
    for (const r of [e, p]) {
      assert.equal(r.status, "PASS"); assert.equal(r.version, expectedVersion); assert(r.finishedAt);
      assert.equal(r.cleanupError, undefined); assert.deepEqual(r.errors, []); assert.equal(r.modelRequests, 0);
      for (const f of [...r.tools, ...r.products, r.source, r.input]) assert.equal(sha(f.path), f.sha256);
    }
    assert.equal(e.steps.length, 3); assert(e.steps.every(s => s.status === "PASS")); assert.equal(e.launches.length, 1);
    assert(!e.launches[0].sourceServer && !e.launches[0].manualBackendSpawn);
    assert.equal(p.source.sha256, sha(efile)); assert.equal(p.executable.sha256, sha(p.executable.path));
    assert.equal(p.launches.length, 1); assert.equal(path.dirname(p.executable.path), path.dirname(e.launches[0].executable.path));
    const install = read(p.installation.path); assert.equal(e.launches[0].executable.sha256, install.executable.sha256);
    assert.equal(path.resolve(e.launches[0].backend.ExecutablePath), path.resolve(install.installRoot, "creator-backend.exe"));
    assert.equal(p.launches[0].args[3], e.cartridge.path); assert.equal(p.launches[0].args[1], "preview");
    assert.equal(p.launches[0].isolation.AGENTVN_TEST_PROJECT, e.input.path);
    for (const [r, directory] of [[e, eroot], [p, proot]])
      for (const f of r.tools) assert.equal(sha(path.join(directory, path.basename(f.path))), f.sha256);
    return { actualVersion: e.version, editorStages: 3, sourceServer: false, realModelRequests: 0 };
  });
  await check("Native portable reimport, active layout and only two byte-exact component dependencies", async () => {
    assert.equal(sha(e.cartridge.path), e.cartridge.sha256); const zip = await JSZip.loadAsync(fs.readFileSync(e.cartridge.path), { checkCRC32: true });
    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(layoutBytes);
    assert.equal(hash(layoutBytes), e.cartridge.layoutSha256);
    if (currentCandidate) assertAssistantExportLayout(layout, e.persisted.editor_settings.runtimeUILayout);
    else assert.deepEqual(layout, e.persisted.editor_settings.runtimeUILayout);
    const portable = await JSZip.loadAsync(fs.readFileSync(e.input.path), { checkCRC32: true });
    const project = JSON.parse(await portable.file("project.json").async("string"));
    assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, e.persisted.editor_settings.runtimeUILayoutProfiles);
    const components = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
    assert.equal(components.length, 2); assert(!JSON.stringify(layout).includes("排除候选"));
    const assets = JSON.parse(await zip.file("manifest.json").async("string")).assets; assert.equal(assets.length, 2);
    assert.deepEqual(assets.map(a => a.asset_id).sort(), components.map(c => c.customComponent.root.children.find(n => n.tag === "img").assetId).sort());
    for (const a of assets) assert.equal(hash(await zip.file(a.path).async("nodebuffer")), e.image.sha256);
    assert(!assets.some(a => ["private-project", "project-asset-1"].includes(a.asset_id))); assert(!zip.file("project.json"));
    assert.equal(e.reimportedAssets.length, 4); assert(e.reimportedAssets.every(a => a.sha256 === e.image.sha256));
    const script = await zip.file("script.json").async("nodebuffer"); assert.equal(hash(script), e.cartridge.scriptSha256);
    return { portableLibraryAssets: 4, exportedAssets: 2, excludedCandidateAbsent: true };
  });
  await check("Two twelve-display matrices and twenty-four actual component menu actions", () => {
    const editorCases = matrix(e, false), playerCases = matrix(p, true);
    assert(p.story.advancedIntoActualStory); assert.match(p.story.text, /本轮独立 UI 验收/);
    assert.equal(p.checks.length, 1); assert(p.checks.every(c => c.status === "PASS"));
    const invalid = [
      r => { r.cases = []; }, r => { r.cases.pop(); }, r => { r.cases[0] = r.cases[1]; },
      r => { r.cases[0].components[0].hit = false; }, r => { r.cases[0].components[0].viewport.dpr = 1.5; },
      r => { r.cases[0].actions = []; }, r => { r.cases[0].components[0].images[0].sha256 = "wrong"; },
      r => { r.cases[0].components[0].box.left = -10; },
    ];
    for (const mutate of invalid) { const bad = structuredClone(p); mutate(bad); assert.throws(() => matrix(bad, true)); }
    return { editorCases, playerCases, actualMenuActions: 24, actualStoryEntry: true, rejectedInvalidMatrixVariants: invalid.length };
  });
  await check("Six captures preserve raw DPR/media before/after and physical PNG size", () => {
    assert.equal(e.screenshots.length, 4); assert.equal(p.screenshots.length, 2);
    for (const s of [...e.screenshots, ...p.screenshots]) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after); const bytes = fs.readFileSync(s.path);
      validateNativeViewport(s.before, s.after);
      const declared = [e, p].flatMap(r => r.cases).find(c => c.width === s.before.width &&
        c.height === s.before.height && c.reduced === s.before.reduced && Math.abs(c.dpr - s.before.dpr) <= 1e-6);
      assert(declared, "Capture lacks a validated display combination"); validateNativeViewport(s.before, declared);
      assert.equal(bytes.readUInt32BE(16), declared.width * declared.dpr); assert.equal(bytes.readUInt32BE(20), declared.height * declared.dpr);
    } return { pngCount: 6, physical4kDisplayClaimed: false };
  });
  await check("Real SQLite copy persists imported project and all four materialized library files", () => {
    const original = path.join(e.launches[0].data, "backend"), target = path.join(out, "sqlite"); fs.mkdirSync(target);
    for (const name of ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]) {
      const f = path.join(original, name); if (!fs.existsSync(f)) continue;
      const copy = path.join(target, name); fs.copyFileSync(f, copy, fs.constants.COPYFILE_EXCL); assert.equal(sha(copy), sha(f));
    }
    const db = new DatabaseSync(path.join(target, "vn_engine.db"), { readOnly: true });
    try {
      const record = db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(e.persisted.project_id); assert(record);
      const project = JSON.parse(record.project_json);
      assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, e.persisted.editor_settings.runtimeUILayoutProfiles);
      assert.deepEqual(project.nodes, e.persisted.nodes); assert.deepEqual(project.edges, e.persisted.edges);
      assert.equal(project.asset_manifest.length, 4);
      for (const a of project.asset_manifest) {
        const rel = path.relative(path.join(original, "project_assets"), a.metadata.filePath);
        assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel)); assert.equal(sha(a.metadata.filePath), e.image.sha256);
      }
      return { projectId: project.project_id, assets: 4, database: desc(path.join(target, "vn_engine.db")) };
    } finally { db.close(); }
  });
  await check("Original native environment cache and Player directories restored without losing user bytes", () => {
    const cache = read(path.join(evidenceRoot, "native-cache-protection.json")), restored = read(e.cacheRestoration.path);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0); assert(!fs.existsSync(cache.held));
    assert.equal(sha(e.cacheRestoration.path), e.cacheRestoration.sha256);
    if (cache.existed) for (const f of cache.files) assert.equal(sha(path.join(cache.original, f.relative)), f.sha256);
    const journal = read(path.join(proot, "profile-protection.json")), pr = read(p.profileRestoration.path);
    assert.equal(journal.records.length, 2); assert.equal(pr.restored.length, 2); assert.equal(pr.status, "PASS"); assert.equal(pr.deletedUserFiles, 0);
    assert.equal(sha(p.profileRestoration.path), p.profileRestoration.sha256);
    for (const r of journal.records) {
      assert(!fs.existsSync(r.held)); const rr = pr.restored.find(v => v.original === r.original); assert(rr);
      assert.deepEqual(rr.files, r.files); assert.equal(rr.directoryId, r.directoryId);
      if (r.directoryId) {
        const currentId = ps(`$s=(& fsutil.exe file queryfileid '${r.original}'|Out-String);` +
          `if($LASTEXITCODE -ne 0 -or $s -notmatch '0x[0-9a-fA-F]+'){throw 'Missing ID'};$Matches[0].ToLowerInvariant()`);
        assert.equal(currentId, r.directoryId);
      }
      for (const f of r.files) assert.equal(sha(path.join(r.original, f.relative)), f.sha256);
    }
    return { originalPlayerDirectories: 2, originalWindowsCache: true, deletedUserFiles: 0,
      incidentalWindowsEnvironmentPhase: e.incidentalEnvironment?.phase ?? "NO_DIALOG",
      normalWindowsPackageEnvironmentClaimed: false };
  });
  await check("Attributed host/Player identities and all three ports are absent; protected binaries and user DB unchanged", () => {
    const now = rows(), known = new Set([...e.knownProcesses, ...p.knownProcesses].map(p => `${p.ProcessId}:${p.Created}`));
    assert(known.size > 0); assert(!now.some(p => known.has(`${p.ProcessId}:${p.Created}`)));
    const ports = [...e.launches.flatMap(l => l.ports), ...p.launches.map(l => l.port)]; assert.equal(listeners(ports).length, 0);
    assert.equal(e.cleanups.length, 1); assert.equal(p.cleanups.length, 1);
    assert(e.cleanups[0].status === "PASS" && !e.cleanups[0].normalCloseClaimed);
    assert(p.cleanups[0].status === "PASS" && !p.cleanups[0].normalCloseClaimed);
    for (const f of e.products) assert.equal(sha(f.path), f.sha256);
    return { processIdentitiesAbsent: known.size, portsAbsent: ports, uniqueProtectedPaths: new Set(e.products.map(f => path.resolve(f.path))).size,
      normalCloseClaimed: false };
  });
  assert.equal(report.groups.length, 7); report.status = "PASS";
}
main().catch(err => { report.status = "FAILED"; report.error = String(err.stack || err); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); });
