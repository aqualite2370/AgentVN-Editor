"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./file-sha256-bounded.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
function recoveryPoints(directory, projectId) {
  if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) return [];
  return fs.readdirSync(directory).filter(n => n.endsWith(".vnproj")).map(name => {
    const file = path.join(directory, name), metaPath = file + ".meta.json";
    assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
    assert(fs.lstatSync(metaPath).isFile() && !fs.lstatSync(metaPath).isSymbolicLink());
    const value = read(file), meta = read(metaPath);
    // Project files are snake_case; native sidecars are serde camelCase.
    assert.equal(meta.backupFormat, "json-timeline"); assert.equal(meta.projectId, value.project_id);
    assert(Array.isArray(value.nodes) && Array.isArray(value.edges));
    assert.equal(meta.nodeCount, value.nodes.length); assert.equal(meta.edgeCount, value.edges.length);
    assert.equal(meta.title, value.title); assert(Number.isSafeInteger(meta.timestampMs));
    return { path: file, name, value, meta, metaPath, sha256: sha(file) };
  }).filter(b => b.value.project_id === projectId).sort((a, b) => b.meta.timestampMs - a.meta.timestampMs);
}
module.exports = { recoveryPoints };
