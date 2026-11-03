#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const result = spawnSync(
  process.execPath,
  [path.join(__dirname, "runtime-menu-motion-playwright.cjs")],
  { cwd: root, env: process.env, encoding: "utf8", stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("runtime-screen-transition-playwright: PASS (Renpy page crossfade and gameplay blackouts)");
