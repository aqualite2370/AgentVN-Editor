"use strict";
// Read actual optimized release bytes; never builds or touches a device.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const base = "F:/AgentVN/QA/Android-Exit-20261024-01";
const signatures = [
  ["finishConfirmedRuntime", "()V", false],
  ["enableRuntimeRestoration", "()V", false],
  ["showRuntimeRestoreError", "(Ljava/lang/String;)V", false],
  ["runtimeActivityCreated", "(I)Z", true],
  ["runtimeActivityDestroyed", "(IZ)V", true],
];
function inspectPluginBridge(text, packageName) {
  const prefix = `L${packageName.replaceAll(".", "/")}/`;
  const classes = text.split(/(?=^Class #\d+)/m);
  const find = descriptor => {
    const matches = classes.filter(c => c.match(/Class descriptor\s*:\s*'([^']+)'/)?.[1] === descriptor);
    assert.equal(matches.length, 1, "Exactly one JNI bridge class: " + descriptor);
    return matches[0];
  };
  const activity = find(prefix + "MainActivity;");
  assert.equal(activity.match(/Superclass\s*:\s*'([^']+)'/)?.[1], prefix + "TauriActivity;");
  const owner = find(prefix + "TauriActivity;");
  find("Lapp/tauri/plugin/PluginManager;");
  const blocks = owner.split(/(?=^ {4}#\d+\s*:)/m).filter(m =>
    m.match(/^\s+name\s*:\s*'([^']+)'/m)?.[1] === "getPluginManager");
  assert.equal(blocks.length, 1, "Required inherited JNI getter: getPluginManager");
  const block = blocks[0], signature = block.match(/^\s+type\s*:\s*'([^']+)'/m)?.[1];
  const flags = parseInt(block.match(/^\s+access\s*:\s*0x([0-9a-f]+)/mi)?.[1], 16);
  const instructions = Number(block.match(/^\s+insns size\s*:\s*(\d+)/m)?.[1] || 0);
  assert.equal(signature, "()Lapp/tauri/plugin/PluginManager;");
  assert(Number.isFinite(flags) && (flags & 1) && !(flags & (8 | 0x400 | 0x100)));
  assert(instructions > 0);
  return { owner: prefix + "TauriActivity;", method: "getPluginManager", signature, flags, instructions };
}
function inspectLifecycle(text, packageName) {
  const descriptor = `L${packageName.replaceAll(".", "/")}/MainActivity;`;
  const classes = text.split(/(?=^Class #\d+)/m).filter(c =>
    c.match(/Class descriptor\s*:\s*'([^']+)'/)?.[1] === descriptor);
  assert(classes.length <= 1, "Duplicate Activity definition");
  if (!classes.length) return { classCount: 0, methods: [] };
  const blocks = classes[0].split(/(?=^ {4}#\d+\s*:)/m);
  const methods = signatures.map(([name, expectedSignature, native]) => {
    const candidates = blocks.filter(m => m.match(/^\s+name\s*:\s*'([^']+)'/m)?.[1] === name);
    assert.equal(candidates.length, 1, "Exactly one required JNI method: " + name);
    const block = candidates[0], signature = block.match(/^\s+type\s*:\s*'([^']+)'/m)?.[1];
    const flags = parseInt(block.match(/^\s+access\s*:\s*0x([0-9a-f]+)/mi)?.[1], 16);
    const instructions = Number(block.match(/^\s+insns size\s*:\s*(\d+)/m)?.[1] || 0);
    assert.equal(signature, expectedSignature, name);
    assert(Number.isFinite(flags));
    assert.equal(flags & (8 | 0x400), 0, "Instance, non-abstract method: " + name);
    assert.equal(Boolean(flags & 0x100), native, name);
    assert(flags & (native ? 2 : 1), "Expected visibility: " + name);
    if (!native) assert(instructions > 0, "Executable code: " + name);
    return { name, signature, native, flags, instructions };
  });
  return { classCount: 1, methods };
}
async function main() {
  const [mode, attempt, run = "01"] = process.argv.slice(2);
  assert(["self-test", "audit"].includes(mode)); assert.match(attempt || "", /^\d{2}$/); assert.match(run, /^\d{2}$/);
  const out = path.join(base, `lifecycle-dex-${mode}-${attempt}-${run}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const r = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "RELEASE_DEX_JNI_REACHABILITY_NOT_DEVICE_ACCEPTANCE", mode, cells: [] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  try {
    save();
    if (mode === "self-test") {
      const pkg = "com.agentvn.qa.lifecycle";
      const valid = `Class #0 -\n Class descriptor : 'L${pkg.replaceAll(".", "/")}/MainActivity;'\n` +
        signatures.map(([name, type, native], i) =>
          `    #${i} :\n      name : '${name}'\n      type : '${type}'\n      access : 0x${native ? "0112" : "0011"}\n` +
          (native ? "" : "      insns size : 3 16-bit code units\n")).join("");
      assert.equal(inspectLifecycle(valid, pkg).methods.length, 5);
      const mutations = [
        text => text.replace("name : 'enableRuntimeRestoration'", "name : 'deletedMethod'"),
        text => text.replace("type : '(I)Z'", "type : '(I)V'"),
        text => text.replace("access : 0x0011", "access : 0x0019"),
        text => text.replace("access : 0x0011", "access : 0x0411"),
        text => text.replace("access : 0x0112", "access : 0x0012"),
        text => text.replace("access : 0x0112", "access : 0x0111"),
        text => text.replace("insns size : 3", "insns size : 0"),
        text => text + "\n" + text.replace("Class #0", "Class #1"),
      ];
      for (const mutate of mutations) assert.throws(() => inspectLifecycle(mutate(valid), pkg));
      // A real prior APK retained finish(), but lacked restoration entrypoints.
      const old = path.join(base, "final-dex-04-positive-01/agentvn-classes.dex.txt");
      assert.throws(() => inspectLifecycle(fs.readFileSync(old, "utf8"), "com.agentvn.qa.exitagentvn20261024"),
        /required JNI method: enableRuntimeRestoration/);
      r.fixture = fileEvidence(old); r.rejectedBadEvidence = mutations.length + 1;
    } else {
      const buildFile = path.join(base, `apk-build-${attempt}/build-report.json`);
      const build = JSON.parse(fs.readFileSync(buildFile, "utf8"));
      assert.equal(build.status, "SOURCE_APKS_BUILT_DEVICE_NOT_RUN");
      assert.equal(build.sourceAndCloneRestoration, "PASS");
      assert(build.finishedAt && build.cells.length === 2 && build.cells.every(c => c.status === "PASS"));
      r.build = fileEvidence(buildFile);
      const tool = "C:/Users/1/AppData/Local/AgentVN/AndroidToolchain/Sdk/build-tools/36.0.0/dexdump.exe";
      r.tools = [__filename, tool].map(fileEvidence);
      for (const cell of build.cells) {
        assert.equal(fileEvidence(cell.apk.path).sha256, cell.apk.sha256);
        const zip = await JSZip.loadAsync(fs.readFileSync(cell.apk.path), { checkCRC32: true });
        const entries = Object.values(zip.files).filter(f => /^classes(?:\d+)?\.dex$/.test(f.name));
        assert(entries.length);
        const c = { layout: cell.layout, apk: fileEvidence(cell.apk.path), classCount: 0, methods: [], dex: [] };
        r.cells.push(c); save();
        for (const entry of entries) {
          const dest = path.join(out, cell.layout + "-" + entry.name), dump = dest + ".txt";
          fs.writeFileSync(dest, await entry.async("nodebuffer"), { flag: "wx" });
          const fd = fs.openSync(dump, "wx");
          let result;
          try { result = spawnSync(tool, [dest], { windowsHide: true, encoding: "utf8", stdio: ["ignore", fd, "pipe"], timeout: 90000 }); }
          finally { fs.closeSync(fd); }
          assert.equal(result.status, 0, result.stderr);
          const inspected = inspectLifecycle(fs.readFileSync(dump, "utf8"), cell.releaseIdentity.androidApplicationId);
          c.classCount += inspected.classCount; c.methods.push(...inspected.methods);
          c.dex.push({ entry: entry.name, bytes: fileEvidence(dest), dump: fileEvidence(dump) }); save();
        }
        assert.equal(c.classCount, 1); assert.equal(c.methods.length, 5);
        c.pluginBridge = inspectPluginBridge(c.dex.map(d => fs.readFileSync(d.dump.path, "utf8")).join("\n"),
          cell.releaseIdentity.androidApplicationId);
        c.status = "PASS"; save();
      }
      assert.equal(fileEvidence(buildFile).sha256, r.build.sha256);
    }
    r.status = "PASS";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, error: r.error })); }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { inspectLifecycle, inspectPluginBridge };
