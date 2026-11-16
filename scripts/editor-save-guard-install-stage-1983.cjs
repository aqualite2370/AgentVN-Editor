"use strict";
// Exact current QA scope, reusing the established disposable default-profile lifecycle.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), Module = require("node:module");
const source = path.join(__dirname, "renpy-quick-placement-install-stage.cjs");
let text = fs.readFileSync(source, "utf8");
function replace(a, b) { assert.equal(text.split(a).length, 2, "Exact staging seam: " + a); text = text.replace(a, b); }
text = text.replaceAll("Windows-Isolated-1981-20261116-", "Windows-Isolated-1983-20261116-");
text = text.replaceAll("Editor-Quick-Placement-Release-1981-20261116-01", "Editor-Save-Guard-Release-1983-20261116-01");
replace('assert.equal(release.version, "1.9.81");', 'assert.equal(release.version, "1.9.83");');
replace('for (const name of ["renpy-quick-placement-installed.cjs", "audit-installed-editor-marker.cjs"]) stage(name);',
  'for (const name of ["editor-save-guard-installed-1983.cjs", "audit-installed-editor-marker.cjs"]) stage(name);');
replace('const entry = path.join(staged, "renpy-quick-placement-installed.cjs");',
  'const entry = path.join(staged, "editor-save-guard-installed-1983.cjs");');
replace('} else fixture = read("F:/testavn/Renpy-Quick-Placement-20261116-01/browser03/fixture.vnproj");',
  '} else fixture = read("F:/testavn/Windows-Isolated-1980-20261116-01/fixture.vnproj");');
replace('fixture.project_id = "qa-editor-quick-placement-1981"; fixture.title = "安装版快捷栏位置1981"; fixture.author = "隔离验收";',
  'fixture.project_id = "qa-editor-save-guard-1983"; fixture.title = "安装版保存保护1983"; fixture.author = "隔离验收";');
const priorStart = text.indexOf("if (remaining) {\n  const prior = ");
const priorEnd = text.indexOf('fixture.project_id = "qa-editor-save-guard-1983"', priorStart);
assert(priorStart >= 0 && priorEnd > priorStart);
text = text.slice(0, priorStart) + 'fixture = read("F:/testavn/Windows-Isolated-1980-20261116-01/fixture.vnproj");\n' + text.slice(priorEnd);
const begin = text.indexOf("const active = fixture.editor_settings.runtimeUILayoutProfiles.profiles.renpy;");
const end = text.indexOf("for (const [name, value]", begin);
assert(begin >= 0 && end > begin);
text = text.slice(0, begin) + 'assert.deepEqual(fixture.nodes.find(n => n.id === "scene").data.scene.commands.map(c => c.duration_ms), [100, 200, 300]);\n' + text.slice(end);
replace('scope: "NEW1981_DEFAULT_QA_INSTALL_UI_AUTHOR_RESTART_UI_EXPORT_NATIVE032_AND_REAL031_REFUSAL_NOT_UPGRADE",',
  'scope: "NEW1983_DEFAULT_QA_INSTALL_CONTINUOUS_SAVE_NATIVE_RECOVERY_HISTORY_RESTART_NOT_UPGRADE_OR_ANDROID",');
const preparer = new Module(source, module);
preparer.filename = source; preparer.paths = Module._nodeModulePaths(path.dirname(source));
preparer._compile(text, source);
