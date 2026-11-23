// Real temporary Git repositories only: never stage, commit, or push the workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const workspace = path.resolve(__dirname, '..');
const qaRoot = process.env.AGENTVN_QA_ROOT || os.tmpdir();
fs.mkdirSync(qaRoot, { recursive: true });
const runRoot = fs.mkdtempSync(path.join(qaRoot, 'gitpush-'));
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
    'scripts/push-agentvn-editor.bat', 'scripts/publish-gitleaks.toml',
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

function writePinnedSyntheticProject(repo, relative) {
  const original = Buffer.from('synthetic project bytes for the publish guard test\n');
  const digest = crypto.createHash('sha256').update(original).digest('hex');
  const scriptFile = path.join(repo, 'scripts/push-agentvn-editor.ps1');
  const script = fs.readFileSync(scriptFile, 'utf8');
  const prefix = `  "${relative}" = "`;
  const lines = script.split('\n');
  const index = lines.findIndex((line) => line.startsWith(prefix));
  assert.notEqual(index, -1, `Expected a pinned fixture entry: ${relative}`);
  assert.match(lines[index].slice(prefix.length).trim(), /^[a-f0-9]{64}"$/);
  lines[index] = `${prefix}${digest}"`;
  fs.writeFileSync(scriptFile, lines.join('\n'));
  write(repo, relative, original);
  return original;
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
  const syntheticCredential = 'gh' + 'p_' + 'AJ91brnmQ0v6c2MM4gRPX3T5YsDKweN8ukFZ';
  const syntheticThread = 'codex://' + 'threads/' + 'a8359562-6c91-4e5d-9566-1da06c6fbe85';
  test('staged credential stays blocked after working tree cleanup and ignore directives', () => {
    const repo = fixture('staged-credential');
    const relative = 'scripts/config.json';
    write(repo, relative, JSON.stringify({ github_token: syntheticCredential }));
    git(repo, 'add', '--', relative);
    write(repo, relative, '{}\n');
    write(repo, '.gitleaks.toml', 'title = "Disabled"\n');
    write(repo, 'scripts/example.txt', `token = ${syntheticCredential} # gitleaks:allow\n`);
    git(repo, 'add', '--', 'scripts/example.txt');
    const before = snapshot(repo);
    const result = check(repo, '-CheckOnly');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /blocked: staged changes/);
    assert.ok(!(result.stdout + result.stderr).includes(syntheticCredential));
    assert.deepEqual(snapshot(repo), before);
  });
  test('StageAll does not commit a private reference in a previously untracked document', () => {
    const repo = fixture('stageall-private');
    const remote = attachLocalRemote(repo);
    const head = git(remote, 'rev-parse', 'main');
    write(repo, 'docs/notes.md', `${syntheticThread}\n`);
    const result = check(repo, '-StageAll');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /blocked: staged changes before commit/);
    assert.ok(!(result.stdout + result.stderr).includes(syntheticThread));
    assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
    assert.equal(git(remote, 'rev-parse', 'main'), head);
  });
  for (const [kind, relative, body, reason] of [
    ['credential', 'docs/settings.txt', `github_token = "${syntheticCredential}"\n`, /blocked: outgoing commit patches/],
    ['private path', 'plans/session.md', 'Private session notes\n', /contains a blocked path/],
  ]) {
    test(`outgoing ${kind} is blocked even if removed in a later commit`, () => {
      const repo = fixture(`history-${kind.replace(' ', '-')}`);
      const remote = attachLocalRemote(repo);
      const head = git(remote, 'rev-parse', 'main');
      write(repo, relative, body);
      git(repo, 'add', '-f', '--', relative);
      git(repo, 'commit', '-m', 'Add fixture');
      git(repo, 'rm', '--', relative);
      git(repo, 'commit', '-m', 'Remove fixture');
      const before = snapshot(repo);
      const result = check(repo);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, reason);
      assert.ok(!(result.stdout + result.stderr).includes(syntheticCredential));
      assert.equal(git(remote, 'rev-parse', 'main'), head);
      assert.equal(snapshot(repo).head, before.head);
      assert.equal(snapshot(repo).index, before.index);
    });
  }
  test('commit messages are screened before a new commit can be created', () => {
    const repo = fixture('secret-message');
    const remote = attachLocalRemote(repo);
    const head = git(remote, 'rev-parse', 'main');
    write(repo, 'docs/example.txt', 'Public example\n');
    git(repo, 'add', '--', 'docs/example.txt');
    const result = check(repo, '-Message', `Reference ${syntheticThread}`);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /blocked: proposed commit message/);
    assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
    assert.equal(git(remote, 'rev-parse', 'main'), head);
  });
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
  test('feature-branch CheckOnly is read-only while publishing still requires main', () => {
    const repo = fixture('feature-branch-preflight');
    git(repo, 'switch', '-c', 'codex/isolated-preflight');
    write(repo, 'scripts/selected-source.cjs');
    git(repo, 'add', '--', 'scripts/selected-source.cjs');
    write(repo, 'scripts/untracked-source.cjs');
    git(repo, 'remote', 'add', 'origin', path.join(runRoot, 'absent-feature-remote'));
    const before = snapshot(repo);
    const result = check(repo, '-CheckOnly');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /CHECK_ONLY_PASS/);
    assert.deepEqual(snapshot(repo), before);
    const publish = check(repo);
    assert.notEqual(publish.status, 0);
    assert.match(publish.stdout + publish.stderr, /Expected branch 'main'/);
    assert.deepEqual(snapshot(repo), before);
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
      'output/report.json', 'release.avnenv', 'editor/dev-server.log',
      'backend/service.log.1', 'editor/startup.trace.json', 'editor/startup.trace.gz',
      'nested/dev-logs/capture.txt', 'backend/.npmrc', 'editor/credentials.json',
    ];
    const allowed = [
      'start-dev.bat', 'start-dev.ps1', 'scripts/start-backend.ps1',
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
  test('only reviewed small QA projects are publishable and their bytes remain pinned', () => {
    const repo = fixture('approved-project-fixtures');
    const approved = [
      'scripts/fixtures/dialog-presentation-isolated.vnproj',
      'scripts/fixtures/editor-isolated-small.vnproj',
      'scripts/fixtures/installed-preview-isolated.vnproj',
    ];
    for (const relative of approved) {
      writePinnedSyntheticProject(repo, relative);
      assert.equal(command('git', ['check-ignore', '-q', '--', relative], repo).status, 1,
        `Reviewed fixture must be visible to Git: ${relative}`);
    }
    const safe = check(repo, '-CheckOnly');
    assert.equal(safe.status, 0, safe.stdout + safe.stderr);
    assert.match(safe.stdout, /CHECK_ONLY_PASS/);

    write(repo, 'scripts/fixtures/other-project.vnproj', 'unreviewed project\n');
    assert.equal(command('git', ['check-ignore', '-q', '--', 'scripts/fixtures/other-project.vnproj'], repo).status, 0,
      'Unreviewed project archives remain ignored');
    git(repo, 'add', '-f', '--', 'scripts/fixtures/other-project.vnproj');
    const unreviewed = check(repo, '-CheckOnly');
    assert.notEqual(unreviewed.status, 0);
    assert.match(unreviewed.stdout, /BLOCKED scripts\/fixtures\/other-project\.vnproj/);

    git(repo, 'rm', '--cached', '--', 'scripts/fixtures/other-project.vnproj');
    write(repo, approved[1], 'changed reviewed fixture bytes\n');
    const changed = check(repo, '-CheckOnly');
    assert.notEqual(changed.status, 0);
    assert.match(changed.stdout, /BLOCKED scripts\/fixtures\/editor-isolated-small\.vnproj/);
  });
  test('local task history stays ignored and cannot be force-published', () => {
    const repo = fixture('local-task-history');
    const relative = 'plans/ACTIVE_TASKS.md';
    write(repo, relative, 'SYNTHETIC_LOCAL_TASK_HISTORY_NOT_FOR_PUBLICATION\n');
    assert.equal(command('git', ['check-ignore', '-q', '--', relative], repo).status, 0);
    assert.equal(check(repo, '-CheckOnly').status, 0);
    git(repo, 'add', '-f', '--', relative);
    write(repo, '.gitignore', '');
    const before = snapshot(repo);
    const result = check(repo, '-CheckOnly');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /BLOCKED plans\/ACTIVE_TASKS\.md/);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_LOCAL_TASK_HISTORY_NOT_FOR_PUBLICATION/);
    assert.deepEqual(snapshot(repo), before);
  });
  test('local root instructions stay ignored and forced staged copies cannot publish', () => {
    const repo = fixture('local-root-instructions');
    const relative = 'AGENTS.md';
    write(repo, relative, 'SYNTHETIC_LOCAL_INSTRUCTIONS_NOT_FOR_PUBLICATION\n');
    assert.equal(command('git', ['check-ignore', '-q', '--', relative], repo).status, 0);
    assert.equal(check(repo, '-CheckOnly').status, 0);
    git(repo, 'add', '-f', '--', relative);
    write(repo, '.gitignore', '');
    const before = snapshot(repo);
    const result = check(repo, '-CheckOnly');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /BLOCKED AGENTS\.md/);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_LOCAL_INSTRUCTIONS_NOT_FOR_PUBLICATION/);
    assert.deepEqual(snapshot(repo), before);
  });
  test('local literary fixtures and their dependent workflows cannot be published', () => {
    const repo = fixture('local-literary-workflows');
    const paths = [
      'scripts/fixtures/night-king-opening.json',
      'scripts/build-angle-owl-project.ts',
      'scripts/build-angle-owl-assets.ps1',
      'scripts/angle-owl-ch4-preview-smoke.cjs',
      'scripts/polish-angle-owl-chapter4-batch11.cjs',
      'scripts/sync-angle-owl-editor-state-direct.py',
      'scripts/build-night-king-opening-fixture.cjs',
      'scripts/migrate-night-king-opening-visual-entry-v2.cjs',
      'scripts/agentvn-test-matrix.cjs',
      'scripts/agentvn-test-matrix-contract-test.cjs',
      'scripts/editor-horizontal-preview-layout-contract.cjs',
      'scripts/full-real-agentvn-acceptance.cjs',
      'scripts/gamecli-choice-nameplate-layout-acceptance.cjs',
      'scripts/gamecli-preview-tauri-cdp-playwright.cjs',
      'scripts/project-settings-and-opening-contract.cjs',
      'scripts/provider-timeout-contract-test.cjs',
      'scripts/release-asset-optimizer-test.cjs',
      'scripts/runtime-fix-engineering-acceptance.cjs',
      'scripts/sprite-scale-display-name-contract.cjs',
    ];
    for (const relative of paths) {
      write(repo, relative, 'SYNTHETIC_PRIVATE_LITERARY_FIXTURE_DO_NOT_PRINT\n');
      assert.equal(command('git', ['check-ignore', '-q', '--', relative], repo).status, 0,
        `Local literary workflow is visible to Git: ${relative}`);
    }
    assert.equal(check(repo, '-CheckOnly').status, 0);
    git(repo, 'add', '-f', '--', ...paths);
    write(repo, '.gitignore', '');
    const before = snapshot(repo);
    const result = check(repo, '-CheckOnly');
    assert.notEqual(result.status, 0);
    for (const relative of paths) assert(result.stdout.includes(`BLOCKED ${relative} [`), relative);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_LITERARY_FIXTURE_DO_NOT_PRINT/);
    assert.deepEqual(snapshot(repo), before);
  });
  test('approved fixture working bytes cannot conceal different staged project data', () => {
    const repo = fixture('staged-project-substitution');
    const relative = 'scripts/fixtures/editor-isolated-small.vnproj';
    const original = writePinnedSyntheticProject(repo, relative);
    write(repo, relative, 'SYNTHETIC_PRIVATE_PROJECT_NOT_FOR_PUBLICATION\n');
    git(repo, 'add', '--', relative);
    write(repo, relative, original);
    const before = snapshot(repo);
    const blocked = check(repo, '-CheckOnly');
    assert.notEqual(blocked.status, 0, 'The actual indexed project must match its approved SHA-256');
    assert.match(blocked.stdout + blocked.stderr, /indexed regression fixture bytes changed/);
    assert.doesNotMatch(blocked.stdout + blocked.stderr, /SYNTHETIC_PRIVATE_PROJECT_NOT_FOR_PUBLICATION/);
    assert.deepEqual(snapshot(repo), before);
    git(repo, '-c', 'core.autocrlf=false', 'add', '--', relative);
    const safe = check(repo, '-CheckOnly');
    assert.equal(safe.status, 0, safe.stdout + safe.stderr);
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
  test('forced development logs are blocked with or without ignore rules', () => {
    const repo = fixture('forced-dev-logs');
    const paths = ['editor/run.log', 'backend/service.log.1', 'editor/start.trace.json', 'dev-logs/debug.txt'];
    for (const relative of paths) write(repo, relative, 'SYNTHETIC_PRIVATE_DEV_LOG\n');
    git(repo, 'add', '-f', '--', ...paths);
    write(repo, '.gitignore', '');
    const before = snapshot(repo);
    const result = check(repo, '-CheckOnly');
    assert.notEqual(result.status, 0);
    for (const relative of paths) assert.ok(result.stdout.includes(`BLOCKED ${relative} [`), relative);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_DEV_LOG/);
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
    git(repo, 'config', 'push.followTags', 'true');
    git(repo, 'config', 'remote.origin.mirror', 'true');
    git(repo, 'tag', '-a', 'local-only', '-m', 'Local annotated tag');
    git(repo, 'branch', 'local-only-branch');
    write(repo, 'scripts/selected.cjs', 'selected\r\n');
    write(repo, 'scripts/unselected.cjs', 'not selected\n');
    git(repo, 'add', '--', 'scripts/selected.cjs');
    const result = check(repo, '-Message', 'Selected fixture only');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const published = git(remote, 'ls-tree', '-r', '--name-only', 'main');
    assert.match(published, /scripts\/selected\.cjs/);
    assert.doesNotMatch(published, /scripts\/unselected\.cjs/);
    assert.equal(git(remote, 'for-each-ref', '--format=%(refname)'), 'refs/heads/main');
    assert.equal(git(repo, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'));
  });
  test('a CRLF file with real trailing whitespace is still rejected', () => {
    const repo = fixture('whitespace-check');
    const remote = attachLocalRemote(repo);
    write(repo, 'scripts/source.cjs', '// trailing whitespace \r\n');
    git(repo, 'add', '--', 'scripts/source.cjs');
    const before = snapshot(repo);
    const result = check(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /trailing whitespace|diff --cached --check/);
    assert.equal(git(repo, 'rev-parse', 'HEAD'), before.head);
    assert.equal(snapshot(repo).index, before.index);
    assert.equal(git(remote, 'rev-parse', 'main'), before.head);
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
