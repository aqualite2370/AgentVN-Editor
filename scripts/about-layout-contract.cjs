#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const about = fs.readFileSync(path.join(root, "GameCli_framework/src/components/shell/AboutScreen.tsx"), "utf8");
const shell = fs.readFileSync(path.join(root, "GameCli_framework/src/styles/shell.css"), "utf8");

assert.match(about, /about-screen-shell/, "about page must expose a dedicated layout shell");
assert.match(about, /about-card-content/, "about page must wrap long content inside its card");
assert.match(about, /about-field-list/, "about page must expose a semantic field list");
assert.match(shell, /\.about-screen-shell[\s\S]{0,900}min-width:\s*0/, "about shell must constrain its own width");
assert.match(shell, /\.about-card-content[\s\S]{0,900}overflow-y:\s*auto/, "desktop about content must scroll inside the card");
assert.match(shell, /\.about-field-list[\s\S]{0,700}overflow-wrap:\s*anywhere/, "about fields must wrap long values");
assert.match(shell, /data-ui-form-factor="handheld"[\s\S]{0,2200}about-screen-shell/, "handheld about page must use a lightweight rail/list layout");
assert.match(shell, /about-screen-shell[\s\S]{0,2200}scrollbar/, "about layout must provide an explicit scroll policy");

console.log("about-layout-contract: PASS");
