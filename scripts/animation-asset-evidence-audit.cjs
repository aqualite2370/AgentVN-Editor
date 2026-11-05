"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, "..");
const directory = path.resolve(process.argv[2] || "");
const target = path.join(directory, "audit-01.json");
assert(process.argv[2] && directory.startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
assert(!fs.existsSync(target), "Preserve original audit results.");
const sha = data => crypto.createHash("sha256").update(data).digest("hex");
const report = { status: "RUNNING", at: new Date().toISOString(), scope: "EVIDENCE_AUDIT_NOT_NEW_PRODUCT_RUN",
  sources: [], groups: [] };
function read(file) {
  const bytes = fs.readFileSync(file); report.sources.push({ file, sha256: sha(bytes) });
  return JSON.parse(bytes.toString().replace(/^\uFEFF/, ""));
}
async function group(id, fn) {
  const row = { id, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
function portOpen(url) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: hostname, port: Number(port) });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", error => error.code === "ECONNREFUSED" ? resolve(false) : reject(error));
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error(`Port probe timeout: ${url}`)); });
  });
}
(async () => {
  try {
    const source = read(path.join(directory, "report.json"));
    await group("COMPLETE_MATRIX_AND_GENUINE_WAAPI", () => {
      assert.equal(source.status, "PASS"); assert.equal(source.cases.length, 30);
      assert(source.cases.every(c => c.status === "PASS")); assert.deepEqual(source.errors, []);
      for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
        for (const dpr of [1, 2]) for (const reduced of [false, true]) {
          const match = c => c.width === w && c.height === h && c.dpr === dpr && c.reduced === reduced;
          const editor = source.cases.filter(c => c.id === "EDITOR_SELECTION_GEOMETRY_AND_FOCUS" && match(c));
          const runtime = source.cases.filter(c => c.id === "RUNTIME_FILE_PLAYBACK_AND_INPUT" && match(c));
          assert.equal(editor.length, 1); assert.equal(runtime.length, 1);
          assert(editor[0].geometry.hit && !editor[0].geometry.inert);
          assert.equal(runtime[0].actual.params.duration, 947);
          assert.equal(runtime[0].actual.params.keyframes[1].x, -83);
          if (reduced) assert(runtime[0].actual.probes.some(p => p.details?.reason === "prefers-reduced-motion"));
          else {
            assert.equal(runtime[0].actual.calls.length, 1);
            assert(runtime[0].actual.calls[0].frames.some(f => f.transform.includes("-83px")));
          }
        }
      return { matrix: 12, authoringAndRuntimeRows: 24, ordinaryWAAPI: 6, reducedFunctional: 6 };
    });
    await group("SCREENSHOT_BYTES_AND_ACTUAL_DPR", () => {
      let images = 0;
      for (const row of source.cases.filter(c => c.screenshot)) {
        const image = row.screenshot, png = fs.readFileSync(image.file);
        assert.equal(sha(png), image.sha256);
        assert.equal(png.readUInt32BE(16), row.width * row.dpr);
        assert.equal(png.readUInt32BE(20), row.height * row.dpr);
        images++;
      }
      assert.equal(images, 24); return { images };
    });
    await group("REAL_PROJECT_AND_CARTRIDGE_REOPEN", async () => {
      const project = await JSZip.loadAsync(fs.readFileSync(path.join(directory, "saved.vnproj")));
      const state = JSON.parse(await project.file("project.json").async("string"));
      const ref = state.nodes.find(n => n.id === "scene").data.scene.commands[1].animation_asset_id;
      const asset = state.asset_manifest.find(a => a.asset_id === ref);
      const original = await project.file(asset.metadata.project_path).async("nodebuffer");
      const bytes = fs.readFileSync(source.cartridge.file); assert.equal(sha(bytes), source.cartridge.sha256);
      const zip = await JSZip.loadAsync(bytes);
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
      const command = script.scenes[0].commands[1];
      assert.equal(manifest.runtime_version, "0.28.0");
      assert.equal(command.animation_asset_id, ref); assert.deepEqual(command.params, {});
      const archived = await zip.file(manifest.assets.find(a => a.asset_id === ref).path).async("nodebuffer");
      assert(original.equals(archived));
      const parsed = JSON.parse(archived.toString());
      assert.equal(parsed.duration_ms, 947); assert.equal(parsed.keyframes[1].x, -83);
      return { assetId: ref, assetSha256: sha(archived), cartridgeSha256: sha(bytes) };
    });
    await group("OWNED_SERVICES_ENDED", async () => {
      assert(source.finishedAt && source.cleanup.browserClosed && source.cleanup.ownedServicesStopped);
      for (const pid of [source.owner.editor.pid, source.owner.runtime.pid, source.owner.backendPid]) {
        assert(Number.isInteger(pid) && pid > 0);
        let live = false;
        try { process.kill(pid, 0); live = true; } catch (error) { assert.equal(error.code, "ESRCH"); }
        assert(!live, `Owned PID still exists: ${pid}`);
      }
      for (const url of [source.owner.editor.url, source.owner.runtime.url]) assert.equal(await portOpen(url), false);
      return { checkedPids: 3, checkedPorts: 2, userDataDeleted: 0 };
    });
    await group("VALIDATED_SOURCE_HASHES_STILL_MATCH", () => {
      const pipeline = read("F:/AgentVN/QA/Animation-Asset-Fix-20261105-03/report.json");
      assert.equal(pipeline.status, "PASS"); assert.equal(pipeline.tests.length, 11);
      assert.equal(pipeline.productSourceBytesUnchanged, true);
      for (const file of pipeline.sourcesAfter)
        assert.equal(sha(fs.readFileSync(path.join(root, file.file))), file.sha256, `Source changed since pass: ${file.file}`);
      return { pipelineTests: 11, sourceFiles: pipeline.sourcesAfter.length };
    });
    report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    fs.writeFileSync(target, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, groups: report.groups.length, target }));
  }
})();
