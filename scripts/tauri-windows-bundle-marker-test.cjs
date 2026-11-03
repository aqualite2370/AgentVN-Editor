"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { compareBundleMarker } = require("./lib/tauri-windows-bundle-marker.cjs");
const base = "F:/AgentVN/QA/Windows-Package-20261021-01";
const portable = fs.readFileSync(base + "/editor-01/中文 Windows 输出/portable/AVN Windows QA 20261021.exe");
const nsis = fs.readFileSync(base + "/setup-payload-01/agentvn-player.exe");
const result = compareBundleMarker(portable, nsis);
assert(result.allOtherBytesIdentical && result.differentBytes === 3);
assert.equal(result.markerOffset, 12424128);
const variants = [
  b => { b[1024] ^= 1; }, b => { b[b.length - 1] ^= 1; }, b => { b[0] ^= 1; },
  b => { b[result.markerOffset] = 88; }, b => { b[result.markerOffset - 1] = 88; },
  b => { Buffer.from("__TAURI_BUNDLE_TYPE_VAR_").copy(b, 100); }
];
for (const mutate of variants) { const copy = Buffer.from(nsis); mutate(copy); assert.throws(() => compareBundleMarker(portable, copy)); }
assert.throws(() => compareBundleMarker(portable, nsis.subarray(1)));
assert.throws(() => compareBundleMarker(nsis, portable));
console.log("PASS: real package binaries differ only in expected UNK/NSS marker; eight other changes rejected");
