"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let JSZip;
try { JSZip = require('../GameCli_framework/node_modules/jszip'); }
catch { JSZip = require('../editor/node_modules/jszip'); }
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fileEvidence(file) {
  const stat = fs.statSync(file);
  return { path: path.resolve(file), sha256: hash(fs.readFileSync(file)), bytes: stat.size,
    generatedAt: stat.mtime.toISOString(), timestampSource: 'filesystem-last-write', cleaned: false };
}
function buildVersionEvidence(input, manifest) {
  // Older callers/reports did not distinguish Tauri game identity from engine
  // or protocol versions. Keep reading them, but do not invent their meaning.
  if (input.runtimeCargoToml === undefined && input.runtimeProtocolConstants === undefined) return {};
  function source(file) {
    if (typeof file !== 'string' || !file.trim() || !fs.existsSync(file)) {
      throw new Error(`APK_VERSION_SOURCE_MISSING: ${file || '(unspecified)'}`);
    }
    const bytes = fs.readFileSync(file), stat = fs.statSync(file);
    return { text: bytes.toString('utf8').replace(/^\uFEFF/, ''), evidence: {
      path: path.resolve(file), sha256: hash(bytes), bytes: bytes.length,
      recordedAt: new Date().toISOString(), lastModifiedAt: stat.mtime.toISOString(),
    } };
  }
  const cargo = source(input.runtimeCargoToml), constants = source(input.runtimeProtocolConstants);
  let section = '', packageCount = 0;
  const packageVersions = [];
  for (const line of cargo.text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (header) { section = header[1].trim(); if (section === 'package') packageCount++; continue; }
    if (section === 'package' && /^\s*version\s*(?:=|\.)/.test(line)) {
      packageVersions.push(line.match(/^\s*version\s*=\s*["']([^"']*)["']\s*(?:#.*)?$/)?.[1]);
    }
  }
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (packageCount !== 1 || packageVersions.length !== 1 || !semver.test(packageVersions[0] || '')) {
    throw new Error(`APK_ENGINE_VERSION_INVALID: ${input.runtimeCargoToml}`);
  }
  const declarations = constants.text.match(/^\s*export\s+const\s+SUPPORTED_RUNTIME_VERSION\b/gm) || [];
  const protocols = [...constants.text.matchAll(/^\s*export\s+const\s+SUPPORTED_RUNTIME_VERSION\s*=\s*["']([^"']*)["'][ \t]*;?[ \t]*(?:\/\/[^\r\n]*)?$/gm)];
  if (declarations.length !== 1 || protocols.length !== 1 || !semver.test(protocols[0]?.[1] || '')) {
    throw new Error(`APK_PROTOCOL_VERSION_INVALID: ${input.runtimeProtocolConstants}`);
  }
  if (typeof input.gameVersion !== 'string' || !input.gameVersion.trim() || input.gameVersion !== manifest.version) {
    throw new Error('APK_GAME_VERSION_MISMATCH: release identity must match the embedded cartridge version');
  }
  if (typeof manifest.runtime_version !== 'string' || !semver.test(manifest.runtime_version)) {
    throw new Error('APK_MINIMUM_RUNTIME_VERSION_INVALID: embedded cartridge runtime_version');
  }
  return {
    runtimeVersion: packageVersions[0], engineVersion: packageVersions[0],
    gameVersion: input.gameVersion, runtimeProtocolVersion: protocols[0][1],
    minimumRuntimeVersion: manifest.runtime_version,
    versionEvidence: {
      schemaVersion: 1, runtimeVersionMeaning: 'engine-cargo-package',
      gameVersionMeaning: 'release-identity-and-embedded-cartridge',
      runtimeProtocolVersionMeaning: 'supported-runtime-capability',
      minimumRuntimeVersionMeaning: 'embedded-cartridge-minimum-runtime',
      sources: { engine: cargo.evidence, protocol: constants.evidence },
    },
  };
}
async function createBuildEvidence(input) {
  if (input.symlinkProbe?.isElevated !== true || input.symlinkProbe?.success !== true) throw new Error('ANDROID_ADMIN_SYMLINK_REQUIRED');
  const archive = await JSZip.loadAsync(fs.readFileSync(input.apk));
  const manifestEntries = Object.values(archive.files).filter(entry => !entry.dir && entry.name.endsWith('embedded-cartridge/manifest.json'));
  if (manifestEntries.length !== 1) throw new Error('APK_PROVENANCE_AMBIGUOUS: manifest.json');
  const manifest = JSON.parse(await manifestEntries[0].async('string'));
  async function entryEvidence(suffix, optional = false) {
    const entries = Object.values(archive.files).filter(entry => !entry.dir && entry.name.endsWith(`embedded-cartridge/${suffix}`));
    if (!entries.length && optional) return { path: `${path.resolve(input.apk)}!/assets/embedded-cartridge/${suffix}`,
      present: false, sha256: null, generatedAt: null, cleaned: false, reason: 'RUNTIME_DEFAULT_LAYOUT' };
    if (entries.length !== 1) throw new Error(`APK_PROVENANCE_AMBIGUOUS: ${suffix}: ${entries.length}`);
    const entry = entries[0];
    const bytes = await entry.async('nodebuffer');
    return { path: `${path.resolve(input.apk)}!/${entry.name}`, present: true, sha256: hash(bytes), bytes: bytes.length,
      generatedAt: null, zipEntryTimestamp: entry.date.toISOString(), timestampSource: 'zip-entry-not-source-generation', cleaned: false };
  }
  const layoutExists = fs.existsSync(input.layout);
  const embeddedLayout = await entryEvidence('ui/layout.json', true);
  if (manifest.ui_skin?.path && !embeddedLayout.present) throw new Error('APK_DECLARED_LAYOUT_MISSING');
  if (layoutExists !== embeddedLayout.present) throw new Error('APK_LAYOUT_HASH_MISMATCH');
  const evidence = {
    schemaVersion: 1, runId: input.runId, recordedAt: new Date().toISOString(),
    editorVersion: input.editorVersion, runtimeVersion: input.runtimeVersion, packageName: input.packageName,
    buildStatus: 'PASS', isElevated: true, symlinkProbe: input.symlinkProbe,
    apk: fileEvidence(input.apk), sourceCartridge: fileEvidence(input.source),
    layoutMode: layoutExists ? 'cartridge' : 'runtime-default',
    prepackageLayout: layoutExists ? { ...fileEvidence(input.layout), present: true }
      : { path: path.resolve(input.layout), present: false, sha256: null, generatedAt: null, cleaned: false, reason: 'RUNTIME_DEFAULT_LAYOUT' },
    embeddedLayout, embeddedManifest: await entryEvidence('manifest.json'),
    ...buildVersionEvidence(input, manifest),
  };
  if (evidence.prepackageLayout.sha256 !== evidence.embeddedLayout.sha256) throw new Error('APK_LAYOUT_HASH_MISMATCH');
  return evidence;
}
function verifyProvenance(apk, evidence) {
  if (!evidence) return { status: 'BLOCKED', reason: 'APK_METADATA_MISSING' };
  if (evidence.apk?.sha256 !== fileEvidence(apk).sha256) return { status: 'FAILED', reason: 'APK_HASH_MISMATCH' };
  const defaultLayout = evidence.layoutMode === 'runtime-default' && evidence.prepackageLayout?.present === false
    && evidence.embeddedLayout?.present === false && evidence.prepackageLayout.sha256 === null && evidence.embeddedLayout.sha256 === null;
  if (!evidence.runId || !evidence.sourceCartridge?.sha256 || (!defaultLayout && (!evidence.prepackageLayout?.sha256 || !evidence.embeddedLayout?.sha256))
    || evidence.isElevated !== true || evidence.symlinkProbe?.success !== true || evidence.symlinkProbe?.isElevated !== true) {
    return { status: 'BLOCKED', reason: 'APK_METADATA_INCOMPLETE' };
  }
  if (evidence.prepackageLayout.sha256 !== evidence.embeddedLayout.sha256) return { status: 'FAILED', reason: 'APK_LAYOUT_HASH_MISMATCH' };
  const hasNewVersions = ['engineVersion', 'runtimeProtocolVersion', 'minimumRuntimeVersion', 'versionEvidence']
    .some(key => evidence[key] !== undefined);
  if (hasNewVersions && (
    evidence.versionEvidence?.schemaVersion !== 1
    || evidence.versionEvidence.runtimeVersionMeaning !== 'engine-cargo-package'
    || evidence.engineVersion !== evidence.runtimeVersion
    || ['engineVersion', 'gameVersion', 'runtimeProtocolVersion', 'minimumRuntimeVersion']
      .some(key => typeof evidence[key] !== 'string' || !evidence[key].trim())
    || ['engine', 'protocol'].some(key => {
      const source = evidence.versionEvidence.sources?.[key];
      return !source?.path || !/^[a-f0-9]{64}$/.test(source.sha256 || '');
    })
  )) return { status: 'BLOCKED', reason: 'APK_VERSION_METADATA_INCOMPLETE_OR_INCONSISTENT' };
  return { status: 'PASS', versionStatus: hasNewVersions ? 'RECORDED' : 'LEGACY_UNVERIFIED', evidence };
}
function acceptanceStatus(stages) {
  const values = ['build', 'runtime', 'audio', 'provenance', 'cleanup'].map(key => stages[key]);
  if (values.some(value => value === 'FAILED' || value === 'FAIL')) return 'FAILED';
  return values.every(value => value === 'PASS') ? 'RUNTIME_PASS' : 'BLOCKED';
}
function verifyColdBoot(boot, observedBootId, runStartedAt) {
  const args = boot?.arguments || [];
  const ready = Date.parse(boot?.readyAt);
  const started = Date.parse(runStartedAt);
  const valid = boot?.status === 'PASS' && boot.isElevated === true && boot.coldBoot === true
    && boot.audioEnabled === true && boot.deviceState === 'device' && boot.avd === 'AgentVN_API35'
    && boot.bootId === String(observedBootId).trim() && Boolean(boot.bootId)
    && args.includes('-no-snapshot') && !args.includes('-no-audio')
    && Number.isFinite(ready) && Number.isFinite(started) && ready <= started;
  return { status: valid ? 'PASS' : 'BLOCKED', reason: valid ? 'LIVE_BOOT_ID_MATCHED' : 'COLD_BOOT_EVIDENCE_MISSING_OR_MISMATCHED',
    observedBootId: String(observedBootId).trim(), evidence: boot || null };
}
module.exports = { fileEvidence, createBuildEvidence, verifyProvenance, acceptanceStatus, verifyColdBoot };
if (require.main === module) {
  const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
  createBuildEvidence(input).then(evidence => {
    const output = `${input.apk}.acceptance.json`;
    fs.writeFileSync(`${output}.tmp`, JSON.stringify(evidence, null, 2), 'utf8');
    fs.renameSync(`${output}.tmp`, output);
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
