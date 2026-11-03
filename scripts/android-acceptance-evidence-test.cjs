"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('../editor/node_modules/jszip');
const { createBuildEvidence, acceptanceStatus, verifyProvenance, verifyColdBoot } = require('./android-acceptance-evidence.cjs');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentvn-evidence-'));
  try {
    const layout = Buffer.from('{"name":"中文布局"}');
    const source = path.join(temp, '源工程.vncart');
    const apk = path.join(temp, '游戏.apk');
    const layoutPath = path.join(temp, 'layout.json');
    fs.writeFileSync(source, 'source cartridge bytes');
    fs.writeFileSync(layoutPath, layout);
    const zip = new JSZip();
    zip.file('assets/embedded-cartridge/ui/layout.json', layout, { date: new Date('1980-01-01T00:00:00Z') });
    zip.file('assets/embedded-cartridge/manifest.json', '{}');
    fs.writeFileSync(apk, await zip.generateAsync({ type: 'nodebuffer' }));
    const evidence = await createBuildEvidence({ apk, source, layout: layoutPath, runId: 'test', packageName: 'com.test', editorVersion: '1', runtimeVersion: '2', symlinkProbe: { success: true, isElevated: true } });
    assert.equal(evidence.sourceCartridge.path, source);
    if (process.platform === 'win32') {
      // Evaluate the production input expressions from an isolated installation.
      // Tauri backup/live configs both describe game identity, never the engine.
      const buildScript = fs.readFileSync(path.join(__dirname, 'build-runtime-standalone-android.ps1'), 'utf8');
      const expression = key => {
        const value = buildScript.match(new RegExp(`^\\s*${key} = (.+)$`, 'm'))?.[1];
        assert.ok(value, `production ${key} source expression exists`);
        return value;
      };
      const evaluateVersion = expr => {
        const command = `$ProgressPreference = 'SilentlyContinue'
$Root = $env:AGENTVN_VERSION_TEST_DIR
$RuntimeRoot = Join-Path $Root 'GameCli_framework'
$ReleaseVersionName = '0.4.2'
${expr}`;
        return require('node:child_process').execFileSync('powershell.exe',
          ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
          { encoding: 'utf8', windowsHide: true, env: { ...process.env, AGENTVN_VERSION_TEST_DIR: temp } }).trim();
      };
      assert.equal(evaluateVersion(expression('gameVersion')), '0.4.2');
      assert.equal(evaluateVersion(expression('runtimeCargoToml')), path.join(temp, 'GameCli_framework/src-tauri/Cargo.toml'));
      assert.equal(evaluateVersion(expression('runtimeProtocolConstants')), path.join(temp, 'shared/cartridge/constants.ts'));
    }
    assert.notEqual(evidence.sourceCartridge.sha256, evidence.embeddedManifest.sha256);
    assert.equal(evidence.prepackageLayout.sha256, evidence.embeddedLayout.sha256);
    assert.equal(evidence.embeddedLayout.generatedAt, null);
    assert.ok(evidence.embeddedLayout.zipEntryTimestamp);
    assert.equal(verifyProvenance(apk, evidence).status, 'PASS');
    assert.equal(verifyProvenance(apk, null).status, 'BLOCKED');
    const defaultApk = path.join(temp, '默认布局.apk');
    const defaultZip = new JSZip();
    defaultZip.file('assets/embedded-cartridge/manifest.json', '{}');
    fs.writeFileSync(defaultApk, await defaultZip.generateAsync({ type: 'nodebuffer' }));
    const defaultEvidence = await createBuildEvidence({ apk: defaultApk, source, layout: path.join(temp, 'absent-layout.json'),
      runId: 'default-layout', packageName: 'com.test', editorVersion: '1', runtimeVersion: '2', symlinkProbe: { success: true, isElevated: true } });
    assert.equal(defaultEvidence.layoutMode, 'runtime-default');
    assert.equal(defaultEvidence.prepackageLayout.present, false);
    assert.equal(defaultEvidence.embeddedLayout.present, false);
    assert.equal(verifyProvenance(defaultApk, defaultEvidence).status, 'PASS');
    await assert.rejects(createBuildEvidence({ apk: defaultApk, source, layout: layoutPath,
      symlinkProbe: { success: true, isElevated: true } }), /APK_LAYOUT_HASH_MISMATCH/);
    defaultZip.file('assets/embedded-cartridge/manifest.json', JSON.stringify({ ui_skin: { path: 'ui/layout.json' } }));
    fs.writeFileSync(defaultApk, await defaultZip.generateAsync({ type: 'nodebuffer' }));
    await assert.rejects(createBuildEvidence({ apk: defaultApk, source, layout: path.join(temp, 'absent-layout.json'),
      symlinkProbe: { success: true, isElevated: true } }), /APK_DECLARED_LAYOUT_MISSING/);
    fs.appendFileSync(apk, 'changed');
    assert.equal(verifyProvenance(apk, evidence).status, 'FAILED');
    const base = { build: 'PASS', runtime: 'PASS', audio: 'PASS', provenance: 'PASS', cleanup: 'PASS' };
    assert.equal(acceptanceStatus(base), 'RUNTIME_PASS');
    for (const key of Object.keys(base)) {
      assert.equal(acceptanceStatus({ ...base, [key]: 'BLOCKED' }), 'BLOCKED');
      assert.equal(acceptanceStatus({ ...base, [key]: 'FAILED' }), 'FAILED');
    }
    assert.equal(acceptanceStatus({ ...base, audio: 'PLAYBACK_OBSERVED' }), 'BLOCKED');
    assert.equal(acceptanceStatus({ ...base, audio: 'BLOCKED', cleanup: 'FAILED' }), 'FAILED');
    const boot = { status: 'PASS', isElevated: true, coldBoot: true, audioEnabled: true,
      bootId: 'actual-boot', deviceState: 'device', avd: 'AgentVN_API35',
      arguments: ['-avd', 'AgentVN_API35', '-no-snapshot', '-accel', 'on'],
      readyAt: '2026-09-21T10:00:00Z' };
    assert.equal(verifyColdBoot(boot, 'actual-boot', '2026-09-21T10:01:00Z').status, 'PASS');
    assert.equal(verifyColdBoot(boot, 'other-boot', '2026-09-21T10:01:00Z').status, 'BLOCKED');
    assert.equal(verifyColdBoot({ ...boot, arguments: [...boot.arguments, '-no-audio'] }, 'actual-boot', '2026-09-21T10:01:00Z').status, 'BLOCKED');
    assert.equal(verifyColdBoot(boot, 'actual-boot', '2026-09-21T09:01:00Z').status, 'BLOCKED');
    assert.equal(verifyColdBoot(null, 'actual-boot', '2026-09-21T10:01:00Z').status, 'BLOCKED');
    await assert.rejects(createBuildEvidence({ apk, source, layout: layoutPath, symlinkProbe: { success: true, isElevated: false } }), /ADMIN/);
    console.log('android-acceptance-evidence: PASS');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
