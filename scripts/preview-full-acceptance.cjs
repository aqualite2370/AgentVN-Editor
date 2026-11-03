const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'output', 'automated', 'preview-full');
const logsDir = path.join(outDir, 'logs');
const screenshotsDir = path.join(outDir, 'screenshots');
const resultPath = path.join(outDir, 'result.json');
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const cargoCmd = isWindows ? 'cargo.exe' : 'cargo';

function nowIso() { return new Date().toISOString(); }
function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }
function sanitize(value) { return String(value).replace(/[^a-z0-9_.-]+/gi, '_').replace(/^_+|_+$/g, '') || 'step'; }
function listFilesIfExists(dir) {
  if (!fs.existsSync(dir)) return [];
  const output = [];
  const walk = (current, base = dir) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, base);
      else output.push(path.relative(base, full).replace(/\\/g, '/'));
    }
  };
  walk(dir);
  return output;
}
function readJsonIfExists(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}
function copyIfExists(source, destination) {
  if (!fs.existsSync(source)) return false;
  mkdirp(path.dirname(destination));
  fs.copyFileSync(source, destination);
  return true;
}
function copyTreeFiles(sourceDir, destinationDir, filter = () => true) {
  if (!fs.existsSync(sourceDir)) return [];
  const copied = [];
  for (const rel of listFilesIfExists(sourceDir)) {
    if (!filter(rel)) continue;
    const source = path.join(sourceDir, rel);
    const destination = path.join(destinationDir, rel);
    mkdirp(path.dirname(destination));
    fs.copyFileSync(source, destination);
    copied.push(destination);
  }
  return copied;
}
function quoteWindowsShellArg(value) {
  const text = String(value);
  if (text.length === 0) return '""';
  if (!/[\s"]/u.test(text)) return text;
  let result = '"';
  let backslashes = 0;
  for (const char of text) {
    if (char === '\\') backslashes += 1;
    else if (char === '"') {
      result += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      result += '\\'.repeat(backslashes) + char;
      backslashes = 0;
    }
  }
  return result + '\\'.repeat(backslashes * 2) + '"';
}
function spawnSpec(command, args) {
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', [command].concat(args || []).map(quoteWindowsShellArg).join(' ')],
    };
  }
  return { command, args: args || [] };
}
async function runStep(step, report) {
  const id = step.id;
  const logFile = path.join(logsDir, `${sanitize(id)}.log`);
  const startedAt = Date.now();
  const item = {
    id,
    title: step.title,
    command: [step.command, ...(step.args || [])].join(' '),
    cwd: step.cwd || root,
    startedAt: nowIso(),
    status: 'running',
    logFile,
  };
  report.steps.push(item);
  fs.writeFileSync(resultPath, JSON.stringify(report, null, 2), 'utf8');
  await new Promise((resolve) => {
    const commandSpec = spawnSpec(step.command, step.args || []);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: step.cwd || root,
      env: { ...process.env, ...(step.env || {}) },
      shell: false,
      windowsHide: true,
    });
    const log = fs.createWriteStream(logFile, { flags: 'w' });
    log.write(`[preview-full] ${item.command}\n[preview-full] cwd=${item.cwd}\n\n`);
    child.stdout.on('data', (chunk) => log.write(chunk));
    child.stderr.on('data', (chunk) => log.write(chunk));
    child.on('error', (error) => {
      item.status = 'failed';
      item.error = error.message;
      item.exitCode = null;
      log.write(`\n[preview-full] ERROR ${error.stack || error}\n`);
      log.end();
      resolve();
    });
    child.on('close', (code, signal) => {
      item.status = code === 0 ? 'passed' : 'failed';
      item.exitCode = code;
      item.signal = signal;
      item.durationMs = Date.now() - startedAt;
      item.finishedAt = nowIso();
      log.write(`\n[preview-full] exit=${code} signal=${signal || ''} durationMs=${item.durationMs}\n`);
      log.end();
      resolve();
    });
  });
  fs.writeFileSync(resultPath, JSON.stringify(report, null, 2), 'utf8');
  if (item.status !== 'passed' && !step.continueOnFailure) {
    throw new Error(`${id} failed; see ${logFile}`);
  }
  return item;
}
function collectDirectoryPreviewArtifacts(report) {
  const directoryResultPath = path.join(root, 'output', 'automated', 'gamecli-preview-directory', 'result.json');
  const directoryResult = readJsonIfExists(directoryResultPath);
  report.directoryPreview = directoryResult || { missing: true, path: directoryResultPath };
  if (directoryResult) {
    const currentDir = directoryResult.currentDir;
    const previewBase = directoryResult.previewBase;
    const files = currentDir ? listFilesIfExists(currentDir) : [];
    const vncartFiles = previewBase ? listFilesIfExists(previewBase).filter((file) => file.endsWith('.vncart')) : [];
    const largeRun = (directoryResult.runs || []).find((run, index) => index === 1 || /445|large/i.test(JSON.stringify(run)));
    report.metrics.directoryPreview = {
      currentDir,
      previewBase,
      currentFileCount: files.length,
      currentContainsRequiredFiles: ['manifest.json', 'script.json', 'checksum.json'].every((file) => files.includes(file)),
      vncartFileCount: vncartFiles.length,
      entries: directoryResult.entries,
      largeRunPid: largeRun && largeRun.pid,
      largeRunArgs: largeRun && largeRun.args,
      largeRunAliveMs: largeRun && largeRun.aliveMs,
      largeRunRequiredAliveMs: largeRun && largeRun.requiredAliveMs,
      largeRunPreviewStats: largeRun && largeRun.previewStats,
      editorButtonFlow: directoryResult.editorButtonFlow,
    };
  }
  copyIfExists(directoryResultPath, path.join(outDir, 'gamecli-preview-directory-result.json'));
  copyTreeFiles(path.join(root, 'output', 'automated', 'gamecli-preview-directory', 'results'), screenshotsDir, (rel) => /\.png$/i.test(rel));
  copyTreeFiles(path.join(root, 'output', 'automated', 'dialog-layout-preview', 'results'), screenshotsDir, (rel) => /\.png$/i.test(rel));
  copyTreeFiles(path.join(root, 'output', 'automated', 'sprite-exit-preview', 'results'), screenshotsDir, (rel) => /\.png$/i.test(rel));
  copyIfExists(path.join(root, 'output', 'automated', 'dialog-layout-preview', 'results', 'result.json'), path.join(outDir, 'dialog-layout-result.json'));
  copyIfExists(path.join(root, 'output', 'automated', 'sprite-exit-preview', 'results', 'result.json'), path.join(outDir, 'sprite-exit-result.json'));
}
function collectDesktopHostLog() {
  const local = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  const candidates = [
    path.join(root, 'error_log', 'editor-desktop.log'),
    path.join(root, 'editor', 'src-tauri', 'target', 'debug', 'error_log', 'editor-desktop.log'),
    path.join(root, 'editor', 'src-tauri', 'target', 'release', 'error_log', 'editor-desktop.log'),
    path.join(local, 'com.agentvn.editor', 'desktop-host.log'),
    path.join(process.env.APPDATA || '', 'com.agentvn.editor', 'desktop-host.log'),
  ];
  for (const candidate of candidates) {
    if (copyIfExists(candidate, path.join(logsDir, 'desktop-host.log'))) return candidate;
  }
  return undefined;
}
async function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  mkdirp(logsDir); mkdirp(screenshotsDir);
  const report = {
    ok: false,
    startedAt: nowIso(),
    root,
    steps: [],
    metrics: {},
    artifacts: { resultPath, logsDir, screenshotsDir },
  };
  fs.writeFileSync(resultPath, JSON.stringify(report, null, 2), 'utf8');
  const steps = [
    { id: 'contract:directory-preview', title: 'Directory preview contract', command: npmCmd, args: ['run', 'test:gamecli-preview-directory'] },
    { id: 'contract:preview-protocol', title: 'GameCLI preview protocol contract', command: npmCmd, args: ['run', 'test:gamecli-preview-protocol'] },
    { id: 'contract:preview-progress-ui', title: 'Preview progress UI contract', command: npmCmd, args: ['run', 'test:gamecli-preview-progress-ui'] },
    { id: 'contract:asset-file-fallback', title: 'Preview asset file fallback contract', command: npmCmd, args: ['run', 'test:gamecli-preview-asset-file-fallback'] },
    { id: 'contract:display-mode', title: 'GameCLI display mode contract', command: npmCmd, args: ['run', 'test:gamecli-display-mode'] },
    { id: 'build:editor', title: 'Editor build', command: npmCmd, args: ['run', 'build'], cwd: path.join(root, 'editor') },
    { id: 'build:gamecli', title: 'GameCLI build', command: npmCmd, args: ['run', 'build'], cwd: path.join(root, 'GameCli_framework') },
    { id: 'cargo:editor', title: 'Editor Tauri cargo check', command: cargoCmd, args: ['check', '--manifest-path', path.join(root, 'editor', 'src-tauri', 'Cargo.toml')] },
    { id: 'cargo:gamecli', title: 'GameCLI Tauri cargo check', command: cargoCmd, args: ['check', '--manifest-path', path.join(root, 'GameCli_framework', 'src-tauri', 'Cargo.toml')] },
    { id: 'acceptance:dialog-layout-real', title: 'Real GameCLI dialog layout acceptance', command: npmCmd, args: ['run', 'test:gamecli-dialog-layout-real'] },
    { id: 'acceptance:sprite-exit-real', title: 'Real GameCLI sprite exit acceptance', command: npmCmd, args: ['run', 'test:gamecli-sprite-exit-real'] },
    { id: 'acceptance:directory-preview-real', title: 'Real GameCLI directory preview acceptance', command: npmCmd, args: ['run', 'acceptance:gamecli-preview-directory-real'] },
  ];
  try {
    for (const step of steps) await runStep(step, report);
    collectDirectoryPreviewArtifacts(report);
    report.artifacts.desktopHostLogSource = collectDesktopHostLog();
    const failed = report.steps.filter((step) => step.status !== 'passed');
    report.ok = failed.length === 0 && report.metrics.directoryPreview?.vncartFileCount === 0 && report.metrics.directoryPreview?.currentContainsRequiredFiles !== false;
    report.finishedAt = nowIso();
    fs.writeFileSync(resultPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 2;
  } catch (error) {
    collectDirectoryPreviewArtifacts(report);
    report.artifacts.desktopHostLogSource = collectDesktopHostLog();
    report.ok = false;
    report.error = String(error && error.stack || error);
    report.finishedAt = nowIso();
    fs.writeFileSync(resultPath, JSON.stringify(report, null, 2), 'utf8');
    console.error(report.error);
    process.exit(1);
  }
}
main();
