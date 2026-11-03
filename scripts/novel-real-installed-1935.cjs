"use strict";

// One authorized, non-retryable real DeepSeek novel-import run against the
// frozen 1.9.35 NSIS installation. The product sources and installation are
// read-only; the generated project, DB, WebView profile, relay evidence, and
// screenshots are isolated on F:.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const Module = require("node:module");
const crypto = require("node:crypto");

const root = "D:/AgentVN";
const liveTemplate = "F:/AgentVN/QA/Editor-1.9.34-20261029-01/novel-live-01/live.cjs";
const candidate = "F:/AgentVN/QA/Editor-1.9.35-20261030-01";
const attemptArg = process.argv.find(value => value.startsWith("--attempt="));
const attempt = attemptArg ? attemptArg.slice("--attempt=".length) : "01";
assert.match(attempt, /^\d{2}$/);
const qaRoot = `F:/AgentVN/QA/Novel-Real-1935-20261031-${attempt}`;
const harnessDir = path.join(qaRoot, "harness");
const qa = path.join(qaRoot, "run");
const checkpoint = `F:/AgentVN/Checkpoints/Novel-Real-1935-20261031-${attempt}`;
const installationFile = path.join(candidate, "installation.json");
const installExe = path.join(candidate, "installed-editor", "agentvn-editor.exe");
const expectedEditorSha = "881377138f2bd2832a58b2ebc3da16fd9d250f8d4253f38cf53e936bd8c3dfb1";
const novel = [
  "第一章 灯塔来信",
  "傍晚，林遥在即将打烊的旧书店发现一封没有寄出的信。信里写着：“如果你还记得河边那盏灯，请在今晚回来。”",
  "店主陈叔说，写信的人三年前离开了小镇，没人知道她是否还会回来。",
  "林遥看见窗外的河堤亮起那盏旧灯，决定带着信赶去。",
  "在河边，她遇见正在修灯的女孩阿禾。阿禾承认信是自己写的，担心父亲已经忘了小时候的约定。",
  "林遥建议先把信交给阿禾的父亲。两人一起走向灯火通明的码头，远处传来熟悉的口琴声。"
].join("\n");

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function replaceOnce(text, before, after, label) {
  assert.equal(text.split(before).length - 1, 1, `Expected one ${label} anchor`);
  return text.replace(before, after);
}

function setup(mode) {
  if (mode === "self-test") {
    assert(!fs.existsSync(qaRoot), `Refusing to reuse QA directory: ${qaRoot}`);
  } else {
    assert(fs.existsSync(qaRoot), "No-charge self-test must create the QA root first");
    assert(fs.existsSync(harnessDir), "No-charge harness directory is missing");
    assert(!fs.existsSync(qa), `Refusing to reuse a prior run: ${qa}`);
    if (mode === "prepare") assert(!fs.existsSync(checkpoint), `Refusing to reuse checkpoint: ${checkpoint}`);
    if (mode === "run") {
      assert(fs.existsSync(checkpoint), "Paid run requires the prepared immutable checkpoint");
      assert(fs.existsSync(path.join(checkpoint, "checkpoint.json")), "Checkpoint manifest is missing");
    }
  }
  assert.equal(hashFile(installExe), expectedEditorSha, "Frozen installed Editor changed");
  const receipt = JSON.parse(fs.readFileSync(installationFile, "utf8"));
  assert.equal(receipt.status, "PASS");
  assert.equal(receipt.executable.version, "1.9.35");
  assert.equal(receipt.executable.sha256, expectedEditorSha);
  fs.mkdirSync(harnessDir, { recursive: true });
  return receipt;
}

function loadLiveHarness() {
  let source = fs.readFileSync(liveTemplate, "utf8");
  source = replaceOnce(source,
    'const candidate = "F:/AgentVN/QA/Editor-1.9.34-20261029-01";',
    `const candidate = ${JSON.stringify(candidate)};`, "candidate path");
  source = replaceOnce(source,
    'const qa = "F:/AgentVN/QA/Novel-Real-1934-20261030-01";',
    `const qa = ${JSON.stringify(qa)};`, "QA path");
  source = replaceOnce(source,
    'const cp = "F:/AgentVN/Checkpoints/Novel-Real-1934-20261030-01";',
    `const cp = ${JSON.stringify(checkpoint)};`, "checkpoint path");

  const oldNovel = "第一章 雨后窗边\n雨停了，窗外的树叶轻轻摇动。\n远处的灯光逐渐明亮，屋内的时钟缓缓走动。";
  const oldStatement = `fs.writeFileSync(novel, ${JSON.stringify(oldNovel)}, { flag: "wx" });`;
  const newStatement = `fs.writeFileSync(novel, ${JSON.stringify(novel)}, { flag: "wx" });`;
  const sourceAnchor = '  let s = fs.readFileSync(original, "utf8");';
  source = replaceOnce(source, sourceAnchor,
    `${sourceAnchor}
  s = replace(s, ${JSON.stringify(oldStatement)}, ${JSON.stringify(newStatement)});
  s = replace(s, 'const install = read(installationFile); assert.equal(install.version, expectedVersion);',
    'const install = read(installationFile); assert.equal(install.executable.version, expectedVersion);');`,
    "fresh novel input");

  source = source.replaceAll("__dirname", JSON.stringify(harnessDir));
  source = replaceOnce(source,
    'candidate + "/novel-installation-01.json", candidate + "/novel-baseline-01.json",',
    'candidate + "/installation.json",', "installation receipt source");
  source = replaceOnce(source,
    'process.argv = ["node", original, "01", "--candidate=1.9.34", "--qa-root=" + qa, "--checkpoint-root=" + cp,\n      "--installation-file=" + candidate + "/novel-installation-01.json", "--baseline-file=" + candidate + "/novel-baseline-01.json"];',
    `process.argv = ["node", original, "${attempt}", "--candidate=1.9.35", "--qa-root=" + qa, "--checkpoint-root=" + cp,\n      "--installation-file=" + candidate + "/installation.json"];`,
    "frozen 1.9.35 invocation");

  source = replaceOnce(source,
    "  const files = [__filename, generated, original, relayFile,",
    `  const files = [__filename, ${JSON.stringify(__filename)}, generated, original, relayFile,`,
    "adapter provenance");
  source = replaceOnce(source,
    "module.exports = { source, relaySource, approval };",
    "module.exports = { source, relaySource, approval, selfTest, prepare, run };",
    "harness entrypoints");
  new (require("node:vm").Script)(Module.wrap(source));
  const compiled = new Module(liveTemplate, module);
  compiled.filename = liveTemplate;
  compiled.paths = Module._nodeModulePaths(path.dirname(liveTemplate));
  compiled._compile(source, liveTemplate);
  return { source, runner: compiled.exports };
}

async function main() {
  const mode = process.argv[2];
  assert(["self-test", "prepare", "run"].includes(mode), "Use self-test, prepare, or run");
  setup(mode);
  const { source, runner } = loadLiveHarness();
  const adapted = path.join(harnessDir, "adapted-live-runner.cjs");
  if (fs.existsSync(adapted)) {
    assert.equal(hashFile(adapted), crypto.createHash("sha256").update(source).digest("hex"),
      "Refusing to overwrite a different adapted runner");
  } else {
    fs.writeFileSync(adapted, source, { flag: "wx" });
  }

  if (mode === "self-test") {
    await runner.selfTest();
    return;
  }
  if (mode === "prepare") {
    assert(fs.existsSync(path.join(harnessDir, "self-test-01", "result.json")),
      "Run the no-charge harness self-test first");
    runner.prepare();
    const bindingPath = path.join(harnessDir, "binding.json");
    const binding = JSON.parse(fs.readFileSync(bindingPath, "utf8"));
    fs.mkdirSync(checkpoint, { recursive: false });
    const snapshotFiles = [];
    for (const item of binding.sources) {
      const file = path.resolve(item.path);
      assert.equal(hashFile(file), item.sha256, `Changed during checkpoint: ${file}`);
      const drive = path.parse(file).root.replace(/[:\\/]/g, "");
      const relative = file.slice(path.parse(file).root.length);
      const target = path.join(checkpoint, "sources", drive, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
      assert.equal(hashFile(target), item.sha256, `Checkpoint copy mismatch: ${file}`);
      snapshotFiles.push({ ...item, checkpointCopy: target });
    }
    const manifest = {
      status: "CHECKPOINTED_NO_PRODUCT_CHANGES",
      createdAt: new Date().toISOString(),
      scope: "QA_HARNESS_FROZEN_1_9_35_INSTALLATION_AND_REAL_NOVEL_TASK",
      productSourceModified: false,
      candidateEditor: { path: installExe, sha256: hashFile(installExe) },
      installation: { path: installationFile, sha256: hashFile(installationFile) },
      gitIndexSha256: binding.sources.find(item => item.path.endsWith("\\AGENTVN\\.git\\index"))?.sha256 ?? null,
      userDatabaseAccess: "READ_ONLY_SELECTED_PROVIDER_METADATA_AND_CREDENTIAL_HELD_IN_PROCESS_MEMORY",
      qaRoot,
      files: snapshotFiles,
    };
    fs.writeFileSync(path.join(checkpoint, "checkpoint.json"), JSON.stringify(manifest, null, 2),
      { flag: "wx" });
    const checked = JSON.parse(fs.readFileSync(path.join(checkpoint, "checkpoint.json"), "utf8"));
    assert.equal(checked.status, "CHECKPOINTED_NO_PRODUCT_CHANGES");
    for (const item of checked.files) assert.equal(hashFile(item.checkpointCopy), item.sha256);
    console.log(JSON.stringify({ status: checked.status, checkpoint, files: checked.files.length,
      editorSha256: checked.candidateEditor.sha256 }));
    return;
  }
  assert(fs.existsSync(path.join(harnessDir, "binding.json")),
    "Paid run requires the immutable no-charge preparation binding");
  const binding = JSON.parse(fs.readFileSync(path.join(harnessDir, "binding.json"), "utf8"));
  assert.equal(binding.status, "PREPARED_NO_MODEL_CALL");
  assert.equal(binding.model.modelId, "deepseek-v4-flash");
  assert.equal(binding.qa, qa);
  await runner.run();
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
