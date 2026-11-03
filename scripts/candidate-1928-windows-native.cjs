"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const Module = require("node:module");
const vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");

const original = path.join(__dirname, "installed-windows-native-ui-current.cjs");
const originalSha = "14114bdbee4c6373f69c2c0ae934c0a4ee402238fb42a002490dd03ecee75c08";
const installationFile =
  "F:/AgentVN/QA/Editor-1.9.28-20261026-01/install-02/derived-installation-receipt-1928.json";
const attempt = process.argv[2] === "--self-test" ? "00" : process.argv[2];
assert.match(attempt || "", /^\d{2}$/);
const checkpoint =
  `F:/AgentVN/Checkpoints/Windows-Package-1928-20261026-${String(Number(attempt) - 4).padStart(2, "0")}`;
const outputRoot =
  "F:/AgentVN/QA/Windows-Package-20261021-01";

assert.equal(sha(original), originalSha);
assert.equal(JSON.parse(fs.readFileSync(installationFile, "utf8")).version, "1.9.28");

let source = fs.readFileSync(original, "utf8");
const changes = [];
function replace(before, after, count = 1) {
  assert.equal(source.split(before).length - 1, count, before);
  source = source.split(before).join(after);
  changes.push({ before, after, count });
}

replace(
  '"F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json"',
  JSON.stringify(installationFile),
);
replace('assert.equal(sealed.version,"1.9.22")', 'assert.equal(sealed.version,"1.9.28")');
replace(
  'ACTUAL_INSTALLED_1_9_22_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD',
  'ACTUAL_INSTALLED_1_9_28_NORMAL_PUBLISH_UI_NATIVE_PICKER_WINDOWS_BUILD',
);
replace(',"-CodexCacheView"]', "]");
replace(
  '  cache("installed-layout-cache-session.ps1","SelfTest");cache("windows-package-cache-session.ps1","SelfTest");',
  '  cache("windows-package-cache-session.ps1","SelfTest");',
);
replace(
  '  cache("installed-layout-cache-session.ps1","Prepare");cachePrepared=true;',
  '  cachePrepared=false;',
);
replace(
  '    if(cachePrepared){cache("installed-layout-cache-session.ps1","Restore");report.cacheRestoration=read(path.join(out,"native-cache-restoration.json"));}',
  '',
);
replace(
  '      if(await check.count()){await check.click();return false;}',
  '      if(await check.count()){throw new Error("Installed Windows environment check did not pass");}',
);
replace(
  'read("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json").protectedFiles',
  "sealed.protectedFiles",
);
replace('read(f.path).editorVersion==="1.9.22"', 'read(f.path).editorVersion==="1.9.28"');
replace('const out=path.join("F:/AgentVN/QA/Windows-Package-20261021-01",`editor-${attempt}`);',
  `const out=path.join(${JSON.stringify(outputRoot)},\`editor-\${attempt}\`);`);
replace('AVN Native Windows 1922 ${attempt}', 'AVN Native Windows 1928 ${attempt}');

if (process.argv[2] === "--self-test") {
  new vm.Script(Module.wrap(source), { filename: __filename });
  console.log(JSON.stringify({
    status: "PASS",
    transformations: changes.length,
    productLaunches: 0,
    sourceSha256: originalSha,
    installation: installationFile,
  }));
  process.exit(0);
}

assert.match(process.argv[2], /^\d{2}$/);
assert(!fs.existsSync(checkpoint));
fs.mkdirSync(checkpoint, { recursive: true });
for (const file of [
  __filename,
  original,
  "scripts/installed-layout-cache-session.ps1",
  "scripts/windows-package-cache-session.ps1",
  "scripts/lib/installed-release-session.cjs",
  "plans/ACTIVE_TASKS.md",
]) {
  fs.copyFileSync(path.resolve(file), path.join(checkpoint, path.basename(file)), fs.constants.COPYFILE_EXCL);
}
fs.writeFileSync(
  path.join(checkpoint, "manifest.json"),
  JSON.stringify(
    [
      { path: __filename, sha256: sha(__filename), bytes: fs.statSync(__filename).size },
      { path: original, sha256: sha(original), bytes: fs.statSync(original).size },
      { path: installationFile, sha256: sha(installationFile), bytes: fs.statSync(installationFile).size },
      { path: path.join(__dirname, "../plans/ACTIVE_TASKS.md"),
        sha256: sha(path.join(__dirname, "../plans/ACTIVE_TASKS.md")),
        bytes: fs.statSync(path.join(__dirname, "../plans/ACTIVE_TASKS.md")).size },
    ],
    null,
    2,
  ),
  { flag: "wx" },
);
const worker = new Module(__filename, module);
worker.filename = __filename;
worker.paths = module.paths;
worker._compile(source, __filename);
