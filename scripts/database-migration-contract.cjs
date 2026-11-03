#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const rust = fs.readFileSync(path.join(root, "editor/src-tauri/src/main.rs"), "utf8");
const migration = fs.readFileSync(path.join(root, "backend/app/db/migrate.py"), "utf8");
const launcher = fs.readFileSync(path.join(root, "backend/backend_launcher.py"), "utf8");

assert.match(rust, /database-migration-decision\.json/);
assert.match(rust, /MessageDialogButtons::YesNo/);
assert.match(rust, /AGENTVN_LEGACY_DATABASE_PATHS/);
assert.doesNotMatch(rust, /fn migrate_legacy_backend_database/);
assert.doesNotMatch(rust, /fs::copy\(&legacy_db,\s*&target_db\)/);
assert.match(migration, /BEGIN IMMEDIATE/);
assert.match(migration, /agentvn-backup/);
assert.match(migration, /completedFingerprints/);
assert.match(migration, /conflicts/);
assert.match(migration, /shared database|shared/i);
assert.match(launcher, /migrate_from_environment/);

console.log("database-migration-contract: PASS");
