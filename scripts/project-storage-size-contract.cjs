#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const service = fs.readFileSync(path.join(root, "backend", "app", "services", "project_state_service.py"), "utf8");
const routes = fs.readFileSync(path.join(root, "backend", "app", "api", "routes_project.py"), "utf8");
const types = fs.readFileSync(path.join(root, "editor", "src", "api", "types.ts"), "utf8");
const home = fs.readFileSync(path.join(root, "editor", "src", "components", "project", "ProjectHome.tsx"), "utf8");

assert.match(service, /_normalized_project_data_size_bytes/, "storage calculation must normalize project JSON");
assert.match(service, /ensure_ascii=False/, "storage calculation must count UTF-8 JSON bytes");
assert.match(service, /_project_asset_size_bytes/, "storage calculation must include external asset bytes");
assert.match(service, /size_source.*storage/, "persisted summaries must expose storage source");
assert.match(service, /container_size_bytes/, "container size must remain diagnostic only");
assert.match(service, /_refresh_storage_summaries/, "legacy summaries must be recomputed");
assert.match(service, /rglob\("\*"\)/, "nested external asset directories must be included");
assert.match(routes, /size_source="container"/, "container source must remain available for diagnostics");
assert.match(types, /"storage"\s*\|\s*"container"\s*\|\s*"unknown"/, "frontend summary type must include storage");
assert.match(home, /source === "unknown"/, "homepage must show unknown as unsaved instead of fake zero");

console.log("project-storage-size-contract: PASS");
