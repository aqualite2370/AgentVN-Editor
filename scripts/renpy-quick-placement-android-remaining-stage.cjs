"use strict";
// Preserve both failed boots; seal a new runner for only the unexecuted tail.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Renpy-Quick-Placement-Android-1981-20261116-01";
const previous = path.join(base, "device-02"), out = path.join(base, "device-03");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
assert.equal(process.argv.length, 2); assert(!fs.existsSync(out), "Preserve frozen evidence");
const before = read(path.join(previous, "report.json"));
assert.equal(before.status, "FAILED"); assert(before.error.includes("android-custom-quick-bar-flow.cjs:92"));
assert.equal(before.cases[0].displayCases.filter(c => c.status === "PASS").length, 3);
assert(before.cases[0].historyReturnAndHiddenTouchRestore); assert.equal(before.cases[0].rotationSamples.length, 0);
for (const name of ["device-01", "device-02"]) {
  assert(read(path.join(base, name, "launcher.json")).finishedAt);
  assert.equal(read(path.join(base, name, "cleanup.json")).status, "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
}
const sealed = read(path.join(previous, "preparation.json"));
for (const file of sealed.copies) assert.equal(sha(file.path), file.sha256);
const scripts = path.join(out, "harness/scripts"); fs.mkdirSync(path.join(scripts, "lib"), { recursive: true });
const inputs = [desc(path.join(previous, "report.json")), desc(path.join(base, "device-01/report.json")),
  desc(path.join(root, "scripts/lib/android-custom-quick-bar-remaining.cjs")), ...sealed.copies];
const copies = [];
function once(s, a, b) { assert.equal(s.split(a).length, 2, a); return s.replace(a, b); }
for (const file of sealed.copies) {
  const relative = path.relative(path.join(previous, "harness/scripts"), file.path);
  let source = fs.readFileSync(file.path, "utf8");
  if (relative === "sprite-count-android-preview.cjs") {
    source = once(source, 'const { exercise, measure, validate } = require("./lib/android-custom-quick-bar-flow.cjs");',
      'const { measure, validate } = require("./lib/android-custom-quick-bar-flow.cjs");\nconst { exercise } = require("./lib/android-custom-quick-bar-remaining.cjs");');
    source = once(source, 'assert.equal(attempt, "02");', 'assert.equal(attempt, "03");');
    source = once(source, 'const out = ' + JSON.stringify(previous.replaceAll("/", "\\")) + ';', 'const out = ' + JSON.stringify(out) + ';');
    source = once(source, 'const save =', `
const secondFile = ${JSON.stringify(path.join(previous, "report.json"))};
const second = read(secondFile);
assert.equal(second.status, "FAILED");
r.inheritedRemainingDisplayCases = { ...desc(secondFile), originalTotalStatus: second.status,
  cases: second.cases[0].displayCases, historyReturnAndHiddenTouchRestore: second.cases[0].historyReturnAndHiddenTouchRestore,
  scope: "THREE_2400_CASES_AND_HISTORY_HIDE_ONLY_DIFFERENT_BOOT_NO_RERUN" };
const save =`);
  } else if (relative.endsWith(".ps1")) {
    source = once(source, "$run='" + previous.replaceAll("/", "\\") + "'", "$run='" + out.replaceAll("/", "\\") + "'");
  }
  const target = path.join(scripts, relative); fs.writeFileSync(target, source, { flag: "wx" }); copies.push(desc(target));
}
const extra = path.join(scripts, "lib/android-custom-quick-bar-remaining.cjs");
fs.copyFileSync(path.join(root, "scripts/lib/android-custom-quick-bar-remaining.cjs"), extra, fs.constants.COPYFILE_EXCL); copies.push(desc(extra));
for (const f of copies.filter(f => f.path.endsWith(".cjs"))) cp.execFileSync(process.execPath, ["--check", f.path], { windowsHide: true });
cp.execFileSync(process.execPath, [extra], { windowsHide: true, stdio: "inherit" });
fs.writeFileSync(path.join(out, "preparation.json"), JSON.stringify({ status: "SEALED1981_NATIVE_REMAINING_ROTATION_NVL_RESTART_NOT_STARTED",
  attempt: "03", at: new Date().toISOString(), inputs, copies, git: sealed.git, editorBuilds: 0, models: 0,
  repeatedDisplayCases: 0, physicalPhoneClaim: false }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "SEALED_DEVICE_NOT_STARTED", scripts, files: copies.length }));
