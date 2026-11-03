"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");

function sourceEntries(receipt) {
  // These are explicit source declarations, not arbitrary recursively nested
  // historical artifacts. Empty top-level arrays must not hide resource forms.
  const forms = [receipt.sources, receipt.source, receipt.changedProduct,
    receipt.resources?.bundled, receipt.resources?.frontendSources, receipt.resources?.backendSources];
  return forms.flatMap(entries => entries == null ? [] : Array.isArray(entries) ? entries : [entries]).filter(entry =>
    entry && (entry.path || entry.file) && /^[a-f0-9]{64}$/i.test(entry.sha256 || ""));
}

function latestSourceMap(root, receipts) {
  assert(receipts.length > 0, "No repair receipts");
  const result = new Map();
  for (const { id, data } of receipts) {
    assert(id && data, "Unidentified receipt");
    const declared = new Map();
    for (const entry of sourceEntries(data)) {
      const file = path.resolve(root, entry.path || entry.file);
      const key = file.toLowerCase();
      const digest = entry.sha256.toLowerCase();
      if (declared.has(key)) {
        assert.equal(declared.get(key), digest, `Conflicting source declarations in ${id}: ${file}`);
        continue;
      }
      declared.set(key, digest);
      const previous = result.get(key);
      result.set(key, { path: file, sha256: digest, receiptId: id,
        previous: previous ? [...previous.previous, {
          receiptId: previous.receiptId, sha256: previous.sha256,
        }] : [] });
    }
  }
  assert(result.size > 0, "No source evidence");
  return [...result.values()];
}

function verifyLatestSource(entry, actualSha256) {
  assert.equal(actualSha256, entry.sha256,
    `Unaccounted current source change: ${entry.path} (latest receipt ${entry.receiptId})`);
  return { ...entry, status: "PASS", actualSha256 };
}

function latestQaSourceMap(root, historicalSources, receipts) {
  return latestSourceMap(root, [
    { id: "HISTORICAL-QA-TOOL", data: { sources: historicalSources } },
    ...receipts.map(({ id, data }) => ({ id, data: { sources: data.qaSources || [] } })),
  ]);
}

function checkHistoricalGroups(groups) {
  assert.equal(groups.length, 18, "Incomplete historical ledger");
  for (let i = 1; i <= 18; i++)
    assert.equal(groups.filter(g => g.id === `G${String(i).padStart(2, "0")}`).length, 1);
  const counts = {};
  for (const g of groups) {
    assert(["PASS", "FAILED", "BLOCKED"].includes(g.status), "Unknown historical status");
    counts[g.status] = (counts[g.status] || 0) + 1;
  }
  assert.deepEqual(counts, { FAILED: 9, BLOCKED: 6, PASS: 3 });
  return counts;
}

module.exports = { sourceEntries, latestSourceMap, verifyLatestSource, latestQaSourceMap, checkHistoricalGroups };
