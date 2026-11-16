"use strict";
// New candidate only; prior 1981 failures/evidence remain immutable.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),Module=require("node:module");
const source=path.join(__dirname,"renpy-quick-placement-install-stage.cjs");
let text=fs.readFileSync(source,"utf8");
function replace(a,b){assert.equal(text.split(a).length,2,"Exact staging seam: "+a);text=text.replace(a,b);}
text=text.replaceAll("Windows-Isolated-1981-20261116-","Windows-Isolated-1982-20261116-");
text=text.replaceAll("Editor-Quick-Placement-Release-1981-20261116-01","Editor-Arrange-Release-1982-20261116-01");
replace('assert.equal(release.version, "1.9.81");','assert.equal(release.version, "1.9.82");');
replace('for (const name of ["renpy-quick-placement-installed.cjs", "audit-installed-editor-marker.cjs"]) stage(name);',
 'for (const name of ["editor-organize-installed-1982.cjs", "audit-installed-editor-marker.cjs"]) stage(name);');
replace('const entry = path.join(staged, "renpy-quick-placement-installed.cjs");',
 'const entry = path.join(staged, "editor-organize-installed-1982.cjs");');
replace('fixture.project_id = "qa-editor-quick-placement-1981"; fixture.title = "安装版快捷栏位置1981"; fixture.author = "隔离验收";',
 'fixture.project_id = "qa-editor-organize-1982"; fixture.title = "安装版左栏整理1982"; fixture.author = "隔离验收";\n'+
 'fixture.nodes.find(n=>n.id==="scene").position={x:540,y:350};');
replace('scope: "NEW1981_DEFAULT_QA_INSTALL_UI_AUTHOR_RESTART_UI_EXPORT_NATIVE032_AND_REAL031_REFUSAL_NOT_UPGRADE",',
 'scope: "NEW1982_DEFAULT_QA_INSTALL_ARRANGE_IDEMPOTENCE_HISTORY_RESTART_HOVER_NOT_UPGRADE",');
const preparer=new Module(source,module);preparer.filename=source;preparer.paths=Module._nodeModulePaths(path.dirname(source));
preparer._compile(text,source);
