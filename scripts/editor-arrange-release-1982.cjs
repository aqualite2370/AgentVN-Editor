"use strict";
// Reuse the established bounded release workflow; only Editor code changed.
const fs = require("node:fs"),path = require("node:path"),assert = require("node:assert/strict"),Module = require("node:module");
const source = path.join(__dirname,"renpy-quick-placement-release.cjs");
let text=fs.readFileSync(source,"utf8");
function replace(a,b){assert.equal(text.split(a).length,2,"Exact release seam: "+a);text=text.replace(a,b);}
text=text.replaceAll("Editor-Quick-Placement-Release-1981-20261116-01","Editor-Arrange-Release-1982-20261116-01");
text=text.replaceAll("editor-quick-placement-1981","editor-arrange-1982");
replace('stage("package-editor-1981",','stage("package-editor-1982",');
replace('const version = "1.9.81", previous = "1.9.80";','const version = "1.9.82", previous = "1.9.81";');
const begin=text.indexOf('const sources = ['),end=text.indexOf('const git = ',begin);
assert(begin>=0 && end>begin);
text=text.slice(0,begin)+'const sources = ["editor/src/utils/autoArrangeGraph.ts", "editor/src/styles/layout.css",\n'+
  '"editor/src/components/editor/CanvasArrangeButton.tsx"];\n'+text.slice(end);
replace('F:/testavn/Editor-History-Release-1980-20261116-01/release/build.json',
  'F:/testavn/Editor-Quick-Placement-Release-1981-20261116-01/release/build.json');
replace('"-File", path.join(root, "scripts/build-dev-launcher.ps1")]);',
  '"-File", path.join(root, "scripts/build-dev-launcher.ps1"), "-SkipGameCliPlayer"]);');
replace('stages.nativePlayerBuilds = 1; save();','stages.nativePlayerBuilds = 0; save();');
replace('assert.notEqual(sha(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe")), checkpoint.frozen.player.sha256);',
  'assert.equal(sha(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe")), checkpoint.frozen.player.sha256);');
replace('checkpoint: desc(path.join(base, "checkpoint.json")), nativePlayerBuilds: 1,',
  'checkpoint: desc(path.join(base, "checkpoint.json")), nativePlayerBuilds: 0,');
replace('"Actual installed authoring/export/new Player consumption/old binary rejection still NOT_RUN"',
  '"New Editor arrange idempotence, keyboard history and restart still NOT_RUN; no Runtime changes"');
replace('"No new device/upgrade matrix; daily D and frozen 1.9.80 unchanged"',
  '"No new device/upgrade matrix; daily D and frozen 1.9.81 unchanged"');
const runner=new Module(source,module);runner.filename=source;runner.paths=Module._nodeModulePaths(path.dirname(source));
runner._compile(text,source);
