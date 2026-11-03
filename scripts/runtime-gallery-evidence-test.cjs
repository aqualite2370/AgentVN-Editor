"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { validateGallery } = require("./lib/runtime-gallery-evidence.cjs");
const r = JSON.parse(fs.readFileSync("F:/AgentVN/QA/Native-Runtime-State-20261020-01/gallery-04/report.json", "utf8"));
validateGallery(r);
const mutations = [
  r => { r.status = "RUNNING"; }, r => { r.finishedAt = null; }, r => { r.productChanges = 1; },
  r => { r.realModelRequests = 1; }, r => { r.cleanupError = "missing"; },
  r => { r.cases = []; }, r => { r.cases[0].status = "FAILED"; },
  r => { r.cases.find(c => c.name.startsWith("Locked gallery")).detail.unlocks = ["fake"]; },
  r => { r.cases.find(c => c.name.startsWith("Real story progression")).detail.assetSha256 = "wrong"; },
  r => { r.cases.find(c => c.name.startsWith("Replay ends")).detail.destination = "title_menu"; },
  r => { r.cases.find(c => c.name.startsWith("Replay ends")).detail.savesUnchanged = false; },
  r => { r.cases.find(c => c.name.startsWith("Replay ends")).detail.final.index = 0; },
  r => { r.cases.find(c => c.name.startsWith("Invalid image")).detail.originalStoryStillPlayable = false; },
  r => { r.cases.find(c => c.name.startsWith("Invalid image")).detail.retryDiagnostic = ""; },
  r => { r.matrix = []; }, r => { r.matrix[1] = r.matrix[0]; },
  r => { r.matrix[0].geometry.cards[0].hit = false; }, r => { r.matrix[0].geometry.overflow = 100; },
  r => { r.launches.pop(); }, r => { r.launches[0].cleanup.status = "FAILED"; },
  r => { r.brokenCartridges[0].art.deliberatelyInvalidImage = false; },
  r => { r.screenshots.pop(); }, r => { r.screenshots[0].png.width = 1; }, r => { r.pageErrors.push("ignored"); },
];
for (const mutate of mutations) { const copy = structuredClone(r); mutate(copy); assert.throws(() => validateGallery(copy)); }
console.log(`PASS gallery evidence oracle: historical baseline and ${mutations.length} invalid variants rejected; no product launch`);
