"use strict";
// One focused confirmation, not another matrix: archive the actual invalid
// source before navigation and the field values after returning.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const assert = require("node:assert/strict"), vm = require("node:vm");
const { qa } = require("./current-role-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const file = path.join(__dirname, "current-role-reopen-invalid.cjs");
const prep = path.join(qa, "draft-loss-confirm-binding");
assert(!fs.existsSync(prep)); fs.mkdirSync(prep);
let source = fs.readFileSync(file, "utf8"); const edits = [];
function change(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); edits.push({ before, after });
}
change('fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
  'fs.copyFileSync(module.qaExecutedFile, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);');
change('for (const display of displays) {', 'for (const display of displays.slice(0, 1)) {');
change('const publication = await publishing();',
  'row.before = { html: await htmlField().inputValue(), css: await cssField().inputValue(),\n' +
  '        saveDisabled: await page.locator(\'[data-help-key="layout.save"]:visible\').isDisabled() }; save();\n' +
  '      await page.evaluate(() => {\n' +
  '        window.__qaDraftDialogs = [];\n' +
  '        window.__qaDraftObserver = new MutationObserver(() => {\n' +
  '          for (const n of document.querySelectorAll(\'[role="dialog"]\')) {\n' +
  '            if (n.closest("[inert]") || !n.getBoundingClientRect().width) continue;\n' +
  '            const text = n.textContent.trim();\n' +
  '            if (!window.__qaDraftDialogs.includes(text)) window.__qaDraftDialogs.push(text);\n' +
  '          }\n' +
  '        });\n' +
  '        window.__qaDraftObserver.observe(document.body, { childList: true, subtree: true });\n' +
  '      });\n' +
  '      const publication = await publishing();');
change('row.draftPreserved = await htmlField().inputValue() === badHTML && await cssField().inputValue() === badCSS;',
  'row.after = { html: await htmlField().inputValue(), css: await cssField().inputValue(),\n' +
  '        saveDisabled: await page.locator(\'[data-help-key="layout.save"]:visible\').isDisabled() };\n' +
  '      row.dialogs = await page.evaluate(() => { window.__qaDraftObserver.disconnect(); return window.__qaDraftDialogs; });\n' +
  '      await host.shot("returned-code-fields");\n' +
  '      row.draftPreserved = row.after.html === badHTML && row.after.css === badCSS;');
change('assert.equal(report.matrix.length, 12);', 'assert.equal(report.matrix.length, 1);');
change('realPublicationAttempts: 12', 'realPublicationAttempts: 1');
new vm.Script(Module.wrap(source));
const executed = path.join(prep, "executed.cjs");
fs.writeFileSync(executed, source, { flag: "wx" });
fs.copyFileSync(__filename, path.join(prep, "adapter.cjs"), fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(prep, "binding.json"), JSON.stringify({
  original: { path: file, sha256: sha(file) }, executed: { path: executed, sha256: sha(executed) },
  edits, scope: "ONE_1080P_CONFIRMATION_EXACT_BEFORE_AFTER_FIELDS_AND_VISIBLE_DIALOG_OBSERVER",
  productChanges: 0, builds: 0, modelRequests: 0,
}, null, 2), { flag: "wx" });
const worker = new Module(file, module);
Object.assign(worker, { filename: file, paths: Module._nodeModulePaths(path.dirname(file)), qaExecutedFile: executed });
process.argv = [process.execPath, file, "run", "15"];
worker._compile(source, file);
