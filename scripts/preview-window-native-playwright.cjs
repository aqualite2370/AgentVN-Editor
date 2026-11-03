// Real Tauri/WebView2 host, real export bridge and real agentvn-player process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { chromium } = require('../editor/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'output/playwright/gamecli-native', new Date().toISOString().replace(/[:.]/g, '-'));
const exe = path.join(root, 'AgentVN Dev.exe');
const port = 9477;
const report = { ok: false, scope: 'native editor UI → directory export → real GameCLI window', checks: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function processList() {
  const text = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='agentvn-player.exe' OR Name='AgentVN Dev.exe' OR Name='agentvn-editor.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"], { windowsHide: true, encoding: 'utf8' });
  const value = text.trim() ? JSON.parse(text) : [];
  return Array.isArray(value) ? value : [value];
}
async function portFree(portNumber) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(portNumber, '127.0.0.1', () => server.close(resolve));
  });
}
async function connect(portNumber) {
  for (let i = 0; i < 180; i++) {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${portNumber}`); } catch {}
    await sleep(500);
  }
  throw Error(`Native CDP unavailable: ${portNumber}`);
}
function ownedStop(pid) {
  if (pid) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  let host, backend, browser, playerBrowser, page;
  const playerPids = new Set();
  try {
    assert.equal(processList().length, 0, 'Close existing editor/player sessions before this isolated native test');
    // Refuse reuse of an existing backend: the test must never write user data.
    for (const p of [8278, 6767, port, port + 1]) await portFree(p);
    const dataDir = path.join(out, 'data');
    fs.mkdirSync(path.join(dataDir, 'backend'), { recursive: true });
    // Own the isolated backend before starting the host, so an empty test
    // database cannot trigger an interactive migration of the user's database.
    backend = spawn('python', ['backend_launcher.py'], { cwd: path.join(root, 'backend'), windowsHide: true, stdio: 'ignore', env: {
      ...process.env, AGENTVN_EDITOR_DATA_DIR: dataDir,
      AGENTVN_BACKEND_DATA_DIR: path.join(dataDir, 'backend'),
      DATABASE_PATH: path.join(dataDir, 'backend/vn_engine.db'),
      AGENTVN_LEGACY_DATABASE_PATHS: '',
    }});
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { ready = (await fetch('http://127.0.0.1:8278/api/health')).ok; } catch {}
      if (ready) break;
      await sleep(500);
    }
    assert.ok(ready, 'isolated backend ready');
    report.executable = { path: exe, sha256: crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'), modifiedAt: fs.statSync(exe).mtime.toISOString() };
    host = spawn(exe, [], { cwd: root, windowsHide: true, stdio: 'ignore', env: {
      ...process.env,
      AGENTVN_EDITOR_DATA_DIR: path.join(out, 'data'),
      WEBVIEW2_USER_DATA_FOLDER: path.join(out, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      AGENTVN_GAMECLI_PREVIEW_CDP_PORT: String(port + 1),
    }});
    browser = await connect(port);
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(60000);
    await page.locator('[data-help-key="home.createProject"]').first().click();
    await page.locator('.editor-toolbar').waitFor();
    // Seed only the isolated project's scene; export and all preview UI stay real.
    await page.evaluate(async () => {
      const { useEditorStore } = await import('/src/store/editorStore.ts');
      const state = useEditorStore.getState();
      useEditorStore.setState({ nodes: state.nodes.map(n => n.data.scene ? {
        ...n, data: { ...n.data, scene: { ...n.data.scene, commands: [{ type: 'narration', text: 'Native preview lifecycle acceptance.' }] } },
      } : n) });
    });
    await page.locator('[data-workspace-surface="preview"]').click();
    await page.locator('[data-testid="preview-launch-panel"]').waitFor();
    assert.equal(await page.locator('iframe').count(), 0, 'top preview must not mount node iframe');
    assert.equal(processList().filter(p => p.ParentProcessId === host.pid).length, 0, 'confirmation page must not launch player');
    report.checks.push('confirmation-only, no iframe');
    const launch = page.locator('[data-help-key="preview.open"]');
    const status = page.locator('[data-testid="preview-window-status"]');
    const waitStatus = text => page.waitForFunction(text => document.querySelector('[data-testid="preview-window-status"]')?.textContent.includes(text), text);
    async function launchPlayer() {
      await launch.click();
      await waitStatus('运行中');
      const processes = processList().filter(p => p.ParentProcessId === host.pid && /agentvn-player\.exe$/i.test(p.ExecutablePath || ''));
      assert.equal(processes.length, 1, 'exactly one owned native player');
      const child = processes[0]; playerPids.add(child.ProcessId);
      assert.match(child.CommandLine, /--preview-root/);
      report.players ??= []; report.players.push(child);
      playerBrowser = await connect(port + 1);
      const player = playerBrowser.contexts()[0].pages()[0];
      await player.locator('[data-testid="start-new-game"]').waitFor({ timeout: 60000 });
      await player.locator('.boot-overlay').waitFor({ state: 'detached', timeout: 60000 });
      await player.locator('[data-testid="start-new-game"]').click();
      await player.locator('[data-testid="game-state-playing"]').waitFor();
      await player.getByText('Native preview lifecycle acceptance.', { exact: true }).waitFor();
      await player.getByTestId('quick-menu-toggle').click();
      await player.getByTestId('open-main-menu').click();
      await player.getByTestId('main-menu').waitFor();
      await player.getByTestId('open-settings').click();
      await player.getByTestId('settings-screen').waitFor();
      await player.getByTestId('settings-finish').click();
      await player.getByTestId('continue-game').click();
      await player.getByTestId('game-state-playing').waitFor();
      await player.screenshot({ path: path.join(out, `player-${child.ProcessId}.png`) });
      assert.equal(await page.locator('iframe').count(), 0);
      return player;
    }
    const player = await launchPlayer();
    report.checks.push('real native process, directory export, title click, scene text, quick menu/settings/resume');
    // A native user-close request must confirm and wait for save completion.
    // The editor's explicit preview-close operation remains a separate host command.
    await player.evaluate(() => { void window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }); });
    const exitDialog = player.getByRole('dialog', { name: '退出游戏？', exact: true });
    await exitDialog.waitFor();
    await waitStatus('运行中');
    assert.equal(processList().filter(p => playerPids.has(p.ProcessId)).length, 1,
      'unconfirmed native close must keep the real player running');
    await exitDialog.getByRole('button', { name: '取消', exact: true }).click();
    await exitDialog.waitFor({ state: 'hidden' });
    await waitStatus('运行中');
    await player.evaluate(() => { void window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }); });
    await exitDialog.waitFor();
    await player.screenshot({ path: path.join(out, 'native-close-confirmation.png') });
    await exitDialog.getByTestId('confirm-exit-game').click().catch(error => {
      if (!/closed/i.test(String(error))) throw error;
    });
    await waitStatus('已关闭');
    assert.equal(await page.locator('[data-help-key="preview.close"]').isDisabled(), true);
    report.checks.push('native close confirmed, cancel preserves player, confirmed exit detected');
    await page.locator('[data-workspace-surface="edit"]').click();
    await page.locator('[data-workspace-surface="preview"]').click();
    await waitStatus('已关闭');
    report.checks.push('task remount rechecks status');
    await launchPlayer();
    await page.locator('[data-help-key="preview.close"]').click();
    await waitStatus('已关闭');
    assert.equal(processList().filter(p => playerPids.has(p.ProcessId)).length, 0);
    report.checks.push('relaunch and editor close verified by OS process list');
    report.finalStatus = await status.innerText();
    await page.screenshot({ path: path.join(out, 'editor.png') });
    report.ok = true;
  } catch (error) {
    report.error = String(error.stack || error); process.exitCode = 1;
    if (page) { report.body = await page.locator('body').innerText().catch(() => ''); await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); }
  } finally {
    if (page) await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('close_gamecli_preview')).catch(() => {});
    for (const p of processList()) if (host && p.ParentProcessId === host.pid) playerPids.add(p.ProcessId);
    for (const pid of playerPids) ownedStop(pid);
    ownedStop(host?.pid);
    ownedStop(backend?.pid);
    await playerBrowser?.close().catch(() => {});
    await browser?.close().catch(() => {});
    report.cleanup = processList().filter(p => p.ProcessId === host?.pid || playerPids.has(p.ProcessId));
    if (report.cleanup.length) { report.ok = false; process.exitCode = 1; }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ ...report, output: out }, null, 2));
})();
