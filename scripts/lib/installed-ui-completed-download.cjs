"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
async function downloadUIArtifact({ cdp, trigger, directory, report, save, until }) {
  directory = path.resolve(directory);
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory, eventsEnabled: true });
  const record = { directory, events: [] }; (report.downloads ??= []).push(record);
  const begin = event => { record.events.push({ type: "begin", ...event }); save(); };
  const progress = event => { record.events.push({ type: "progress", ...event }); save(); };
  cdp.on("Browser.downloadWillBegin", begin); cdp.on("Browser.downloadProgress", progress);
  try {
    await trigger.click();
    await until(() => record.events.some(e => e.type === "progress" && ["completed", "canceled"].includes(e.state)),
      "actual installed UI download terminal", 60000);
    const starts = record.events.filter(e => e.type === "begin"); assert.equal(starts.length, 1);
    const done = record.events.find(e => e.type === "progress" && e.state === "completed" && e.guid === starts[0].guid);
    assert(done && done.filePath); const file = path.resolve(done.filePath);
    assert.equal(path.dirname(file), directory); assert.equal(path.basename(file), starts[0].suggestedFilename);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, done.receivedBytes); assert.equal(done.receivedBytes, done.totalBytes);
    record.file = { path: file, sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length, generatedAt: fs.statSync(file).mtime.toISOString() };
    save(); return record.file;
  } finally { cdp.off("Browser.downloadWillBegin", begin); cdp.off("Browser.downloadProgress", progress); }
}
module.exports = { downloadUIArtifact };
