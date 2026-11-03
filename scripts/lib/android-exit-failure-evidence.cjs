"use strict";
// Read-only failure collection before package uninstall. Never counts as UI acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { fileEvidence } = require("../android-acceptance-evidence.cjs");
async function captureExitFailure({ outputDir, packageName, label, evaluate, getTargets, command }) {
  assert.match(packageName || "", /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}$/);
  assert.match(label || "", /^[a-z0-9_-]+$/);
  const out = path.resolve(outputDir);
  assert(out.toLowerCase().startsWith("f:\\agentvn\\qa\\") && fs.statSync(out).isDirectory());
  assert.equal(typeof command, "function");
  const reportFile = path.join(out, label + "-failure-evidence.json"); assert(!fs.existsSync(reportFile));
  const r = { scope: "FAILURE_DIAGNOSTIC_NOT_ACCEPTANCE", status: "COLLECTING",
    startedAt: new Date().toISOString(), packageName, nativeLogs: [], errors: [] };
  const write = (name, data) => {
    const file = path.join(out, label + "-failure-" + name);
    fs.writeFileSync(file, data, { flag: "wx" }); return fileEvidence(file);
  };
  async function collect(name, fn) {
    try { await fn(); } catch (error) { r.errors.push({ name, error: String(error.stack || error) }); }
  }
  async function bounded(read) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(read),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Read-only CDP diagnostic timeout")), 3000); })]); }
    finally { clearTimeout(timer); }
  }
  const checked = (args, binary) => {
    const v = command(args, binary);
    assert.equal(v.status, 0, String(v.error || v.stderr || "Diagnostic command failed"));
    return v.stdout;
  };
  await collect("dom", async () => {
    assert.equal(typeof evaluate, "function", "No live CDP client at failure");
    const value = await bounded(() => evaluate(`(() => {
      const html=document.documentElement?.outerHTML||"",text=document.body?.innerText||"";
      return {href:location.href,readyState:document.readyState,title:document.title,
        text:text.slice(0,20000),textLength:text.length,html:html.slice(0,100000),htmlLength:html.length,
        viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
        tauriAvailable:Boolean(window.__TAURI_INTERNALS__),bootstrap:document.querySelector("#root")?.innerHTML.slice(0,20000)};
    })()`));
    r.dom = write("dom.json", JSON.stringify(value, null, 2));
  });
  await collect("targets", async () => {
    assert.equal(typeof getTargets, "function");
    r.targets = write("targets.json", JSON.stringify(await bounded(getTargets), null, 2));
  });
  await collect("screenshot", async () => {
    const bytes = checked(["exec-out", "screencap", "-p"], true);
    assert(Buffer.isBuffer(bytes) && bytes.length > 24 && bytes.subarray(1, 4).toString() === "PNG");
    r.screenshot = { ...write("page.png", bytes), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
      scope: "FAILURE_FRAME_ONLY_NOT_DISPLAY_MATRIX_PASS" };
  });
  await collect("activity", async () => {
    r.activity = write("activity.txt", checked(["shell", "dumpsys", "activity", "activities"], false));
  });
  await collect("native-logs", async () => {
    const prefix = `/data/user/0/${packageName}/`;
    const listing = checked(["shell", "find", prefix.slice(0, -1), "-maxdepth", "5", "-type", "f"], false);
    const candidates = String(listing).split(/\r?\n/).filter(f => /\/error_log\/[^/]+\.log$/.test(f));
    for (const [index, remote] of candidates.slice(0, 4).entries()) {
      await collect("native-log-" + index, async () => {
        assert(remote.startsWith(prefix) && !remote.split("/").some(v => v === "." || v === "..")
          && !remote.includes("\0"), "Refuse a native log outside this test package");
        const bytes = checked(["exec-out", "cat", remote], true);
        assert(Buffer.byteLength(bytes) <= 10 * 1024 * 1024, "Native log exceeds diagnostic size budget");
        r.nativeLogs.push({ ...write(`native-${index}.log`, bytes), remote });
      });
    }
    assert(candidates.length > 0, "No native player log retained in package data");
    if (candidates.length > 4) r.errors.push({ name: "native-logs", error: "Only first four log files retained" });
  });
  r.status = r.errors.length ? "COLLECTED_WITH_ERRORS" : "COLLECTED";
  r.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportFile, JSON.stringify(r, null, 2), { flag: "wx" });
  return { ...r, report: fileEvidence(reportFile) };
}
module.exports = { captureExitFailure };
