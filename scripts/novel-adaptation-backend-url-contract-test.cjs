"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const adaptation = fs.readFileSync(path.join(root, "editor/src/novel-import/adaptationClient.ts"), "utf8");
const backend = fs.readFileSync(path.join(root, "editor/src/api/backendClient.ts"), "utf8");

assert.match(backend, /getBaseUrl\(\)\s*:\s*string/);
assert.match(adaptation, /import\s*\{\s*backendClient\s*\}\s*from\s*"\.\.\/api\/backendClient"/);
assert.match(adaptation, /function\s+getNovelBackendBaseUrl\(\)[^{]*\{\s*return\s+backendClient\.getBaseUrl\(\);\s*\}/s);
assert.doesNotMatch(adaptation, /const\s+backendBaseUrl\s*=/);
assert.doesNotMatch(adaptation, /const\s+websocketBaseUrl\s*=/);
assert.match(adaptation, /baseUrl\s*=\s*getNovelBackendBaseUrl\(\)/g);
assert.match(adaptation, /verifyNovelAiRoutes\(baseUrl\s*=\s*getNovelBackendBaseUrl\(\)\)/);

console.log("PASS: novel adaptation requests resolve the runtime backend URL");
