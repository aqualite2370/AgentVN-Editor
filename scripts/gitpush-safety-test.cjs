// Real temporary Git repositories only: never stage, commit, or push the workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const workspace = path.resolve(__dirname, '..');
const qaRoot = 'F:\\AgentVN\\QA\\Gitpush-Ignore-20261020-01';
fs.mkdirSync(qaRoot, { recursive: true });
const runRoot = fs.mkdtempSync(path.join(qaRoot, 'run-'));
const results = [];

function command(exe, args, cwd) {
  const result = spawnSync(exe, args, {
    cwd, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.ifError(result.error);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(repo, ...args) {
  const result = command('git', args, repo);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(name) {
  const repo = path.join(runRoot, name);
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  for (const relative of [
    '.gitignore', 'scripts/push-agentvn-editor.ps1',
    'scripts/push-agentvn-editor.bat',
  ]) {
    const source = path.join(workspace, relative);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(repo, relative));
  }
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Isolated QA');
  git(repo, 'config', 'user.email', 'qa@example.invalid');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', path.join(runRoot, 'no-hooks'));
  git(repo, 'add', '.gitignore');
  git(repo, 'commit', '-m', 'Isolated baseline');
  return repo;
}

function write(repo, relative, content = 'fixture\n') {
  const target = path.join(repo, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function snapshot(repo) {
  const index = fs.readFileSync(path.join(repo, '.git/index'));
  return {
    head: git(repo, 'rev-parse', 'HEAD'),
    index: crypto.createHash('sha256').update(index).digest('hex'),
    fetchHead: fs.existsSync(path.join(repo, '.git/FETCH_HEAD')),
    config: fs.readFileSync(path.join(repo, '.git/config'), 'utf8'),
  };
}

function check(repo, ...args) {
  return command('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(repo, 'scripts/push-agentvn-editor.ps1'), ...args,
  ], repo);
}

function attachLocalRemote(repo) {
  const remote = `${repo}-remote.git`;
  git(runRoot, 'init', '--bare', remote);
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main');
  return remote;
}

function test(name, body) {
  try {
    body();
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAILED', error: error.message });
    throw error;
  }
}

try {
  test('CheckOnly works offline and leaves HEAD, index and remote state untouched', () => {
    const repo = fixture('readonly');
    write(repo, 'scripts/发布脚本.cjs');
    write(repo, 'scripts/pending.cjs');
    git(repo, 'add', 'scripts/pending.cjs');
    git(repo, 'remote', 'add', 'origin', path.join(runRoot, 'absent-remote'));
    const before = snapshot(repo);
    const result = check(repo, '-CheckOnly');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(snapshot(repo), before);
    assert.match(result.stdout, /CHECK_ONLY_PASS/);
  });
  test('generated payloads and signing secrets are ignored without hiding source or offline NSIS', () => {
    const repo = fixture('ignore-matrix');
    const ignored = [
      '$out/libapp.so', '--help/resources/large.dat', '--help.inspection.json',
      '--apk.inspection.json', 'artifacts/payload.dat', 'backend/build/cache.dat',
      'backend/creator-backend.spec', 'GameCli_framework/public/release-package.json',
      'GameCli_framework/src-tauri/resources/embedded-cartridge/cartridge.v1.json',
      '.env', '.env.local', 'release.jks', 'release.keystore', 'private.p12',
      'private.pfx', 'private.key', 'private.pem', 'payload.dll', 'payload.so',
      'output/report.json', 'release.avnenv',
    ];
    const allowed = [
      'scripts/build-release.ps1', 'scripts/中文测试.cjs', 'backend/source.py',
      'editor/.env.example', 'GameCli_framework/src-tauri/.cargo/config.toml',
      'GameCli_framework/src-tauri/resources/embedded-cartridge/.gitkeep',
      'windows-offline-tools/NSIS/makensis.exe',
      'windows-offline-tools/NSIS/Plugins/x86-unicode/System.dll',
      'windows-offline-tools/NSIS/COPYING',
    ];
    for (const relative of [...ignored, ...allowed]) write(repo, relative);
    for (const relative of ignored) {
      const result = command('git', ['check-ignore', '-q', '--', relative], repo);
      assert.equal(result.status, 0, `Not ignored: ${relative}`);
    }
    for (const relative of allowed) {
      const result = command('git', ['check-ignore', '-q', '--', relative], repo);
      assert.equal(result.status, 1, `Unexpectedly ignored: ${relative}`);
    }
    assert.equal(check(repo, '-CheckOnly').status, 0);
  });
  test('forced signing files stay blocked even after ignore rules are removed', () => {
    const repo = fixture('forced-secret');
    write(repo, 'release.keystore', 'FAKE_SIGNING_BYTES_DO_NOT_PRINT');
    git(repo, 'add', '-f', '--', 'release.keystore');
    write(repo, '.gitignore', '');
    const before = snapshot(repo);
    const result = check(repo, '-CheckOnly');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /BLOCKED release\.keystore/);
    assert.doesNotMatch(result.stdout + result.stderr, /FAKE_SIGNING_BYTES_DO_NOT_PRINT/);
    assert.deepEqual(snapshot(repo), before);
  });
  test('oversize staged bytes cannot be hidden by replacing or deleting the working file', () => {
    const repo = fixture('staged-size');
    write(repo, 'scripts/oversize.txt', Buffer.alloc(2 * 1024 * 1024, 65));
    git(repo, 'add', '--', 'scripts/oversize.txt');
    write(repo, 'scripts/oversize.txt', 'small now\n');
    const before = snapshot(repo);
    const result = check(repo, '-CheckOnly', '-MaxFileMiB', '1');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /BLOCKED scripts\/oversize\.txt/);
    assert.deepEqual(snapshot(repo), before);
    fs.unlinkSync(path.join(repo, 'scripts/oversize.txt'));
    const deletedBefore = snapshot(repo);
    assert.notEqual(check(repo, '-CheckOnly', '-MaxFileMiB', '1').status, 0);
    assert.deepEqual(snapshot(repo), deletedBefore);
  });
  test('forced generated files are rejected, but their staged removal is allowed', () => {
    const repo = fixture('forced-generated');
    write(repo, 'output/report.json');
    git(repo, 'add', '-f', '--', 'output/report.json');
    assert.notEqual(check(repo, '-CheckOnly').status, 0);
    git(repo, 'rm', '--cached', '--', 'output/report.json');
    assert.equal(check(repo, '-CheckOnly').status, 0);
  });
  test('working-tree oversize candidates and indexed symlinks are rejected', () => {
    const repo = fixture('working-size');
    write(repo, 'large.dat', Buffer.alloc(2 * 1024 * 1024, 65));
    assert.notEqual(check(repo, '-CheckOnly', '-MaxFileMiB', '1').status, 0);
    fs.unlinkSync(path.join(repo, 'large.dat'));
    write(repo, 'link-target.txt', '/not/an/authorized/file\n');
    const blob = git(repo, 'hash-object', '-w', '--', 'link-target.txt');
    git(repo, 'update-index', '--add', '--cacheinfo', `120000,${blob},external-link`);
    assert.notEqual(check(repo, '-CheckOnly').status, 0);
  });
  test('default publishing sends only selected staged changes to an isolated local remote', () => {
    const repo = fixture('selected');
    const remote = attachLocalRemote(repo);
    write(repo, 'scripts/selected.cjs', 'selected\n');
    write(repo, 'scripts/unselected.cjs', 'not selected\n');
    git(repo, 'add', '--', 'scripts/selected.cjs');
    const result = check(repo, '-Message', 'Selected fixture only');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const published = git(remote, 'ls-tree', '-r', '--name-only', 'main');
    assert.match(published, /scripts\/selected\.cjs/);
    assert.doesNotMatch(published, /scripts\/unselected\.cjs/);
    assert.equal(git(repo, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'));
  });
  test('explicit StageAll includes ordinary scripts and NSIS tools but not ignored payloads', () => {
    const repo = fixture('explicit-all');
    const remote = attachLocalRemote(repo);
    write(repo, 'scripts/发布构建.cjs');
    write(repo, 'windows-offline-tools/NSIS/makensis.exe', 'TEST_TOOL');
    write(repo, 'windows-offline-tools/NSIS/Plugins/x86-unicode/System.dll', 'TEST_DLL');
    write(repo, 'output/large.zip', 'TEST_PAYLOAD');
    write(repo, 'release.keystore', 'TEST_SECRET');
    const readonlyBefore = snapshot(repo);
    assert.equal(check(repo, '-CheckOnly', '-StageAll').status, 0);
    assert.deepEqual(snapshot(repo), readonlyBefore);
    const result = check(repo, '-StageAll', '-Message', 'Explicit fixture');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const published = git(remote, 'ls-tree', '-r', '--name-only', 'main');
    assert.match(published, /makensis\.exe/);
    assert.match(published, /System\.dll/);
    assert.match(published, /scripts\//);
    assert.doesNotMatch(published, /output\/|release\.keystore/);
  });
  test('remote advancement blocks publishing before staging or committing', () => {
    const repo = fixture('remote-ahead');
    const remote = attachLocalRemote(repo);
    const peer = `${repo}-peer`;
    git(runRoot, 'clone', '--branch', 'main', remote, peer);
    git(peer, 'config', 'user.name', 'Isolated peer');
    git(peer, 'config', 'user.email', 'peer@example.invalid');
    git(peer, 'config', 'commit.gpgsign', 'false');
    write(peer, 'new-source.txt');
    git(peer, 'add', '--', 'new-source.txt');
    git(peer, 'commit', '-m', 'Remote advanced');
    git(peer, 'push', 'origin', 'main');
    write(repo, 'scripts/not-staged.cjs');
    const before = snapshot(repo);
    const remoteHead = git(remote, 'rev-parse', 'main');
    const result = check(repo, '-StageAll');
    assert.notEqual(result.status, 0);
    assert.equal(snapshot(repo).head, before.head);
    assert.equal(snapshot(repo).index, before.index);
    assert.equal(git(remote, 'rev-parse', 'main'), remoteHead);
  });
  test('the BAT launcher forwards CheckOnly instead of silently publishing', () => {
    const repo = fixture('bat-launcher');
    assert.equal(fs.existsSync(path.join(repo, 'gitpush')), false,
      'The published source must not depend on ignored machine-local launchers');
    const before = snapshot(repo);
    const result = command('cmd.exe', [
      '/d', '/c', path.join(repo, 'scripts/push-agentvn-editor.bat'), '-CheckOnly',
    ], repo);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /CHECK_ONLY_PASS/);
    assert.deepEqual(snapshot(repo), before);
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  const report = path.join(runRoot, 'report.json');
  fs.writeFileSync(report, JSON.stringify({
    status: process.exitCode ? 'FAILED' : 'PASS',
    createdAt: new Date().toISOString(), results,
    boundary: 'Temporary repositories only; no workspace staging or remote writes.',
  }, null, 2));
  console.log(`Report: ${report}`);
}
