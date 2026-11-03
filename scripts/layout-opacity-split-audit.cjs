"use strict";
// Evidence audit only. Never launches the product, changes user data or promotes
// source/browser/native-player evidence to an installed Release conclusion.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const net = require("node:net"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { processIdentity } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Layout-Opacity-Split-20261020-01";
const native = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const attempt = process.argv[2] || "01"; assert(/^\d{2}$/.test(attempt));
const out = path.join(qa, `audit-${attempt}`); assert(!fs.existsSync(out));
fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], reports: [],
  verifiedFiles: [], modelRequests: 0, scope: "OPACITY_02_SOURCE_DEV_NATIVE_PLAYER_NOT_INSTALLED_RELEASE",
  notProven: ["New Dev native Editor UI", "New installed Release and installer resource delivery",
    "Windows/Android export, installation and upgrades", "Physical 4K monitor", "Full motion acceptance",
    "Normal native window close", "Full feature ledger or final user-project acceptance"] };
const files = new Map();
function check(name, body) { body(); report.checks.push({ name, status: "PASS" }); }
function verify(file, expected) {
  const actual = describe(file); assert.equal(actual.sha256, expected, `Changed bytes: ${file}`);
  files.set(actual.path, actual); return actual;
}
function evidence(file) {
  const r = read(file); assert.equal(r.status, "PASS", file); assert.equal(r.modelRequests, 0);
  report.reports.push(describe(file));
  if (r.testSha256) verify(path.join(path.dirname(file), "executed-test.cjs"), r.testSha256);
  if (r.sources) for (const s of r.sources) verify(path.join(root, s.file), s.sha256);
  return r;
}
function artifacts(value) {
  if (!value || typeof value !== "object") return;
  if (typeof value.path === "string" && typeof value.sha256 === "string") verify(value.path, value.sha256);
  if (value.before && value.after && value.path?.endsWith(".png")) {
    assert.deepEqual(value.before, value.after, "Screenshot changed actual display parameters");
    const p = fs.readFileSync(value.path);
    assert.equal(p.readUInt32BE(16), value.before.width * value.before.dpr);
    assert.equal(p.readUInt32BE(20), value.before.height * value.before.dpr);
  }
  for (const child of Object.values(value)) artifacts(child);
}
function validateMatrix(cells) {
  assert.equal(cells.length, 12);
  assert.equal(new Set(cells.map(c => `${c.width}/${c.height}/${c.dpr}/${c.motion ?? c.reduced}`)).size, 12);
  for (const c of cells) {
    assert.equal(c.status, "PASS");
    assert([[1920, 1080], [2560, 1440], [3840, 2160]].some(([w, h]) => c.width === w && c.height === h));
    assert([1, 2].includes(c.dpr));
  }
}
async function closed(port) {
  return new Promise(resolve => {
    const s = net.createConnection({ host: "127.0.0.1", port: Number(port) });
    s.setTimeout(1500);
    s.once("connect", () => { s.destroy(); resolve(false); });
    s.once("error", e => resolve(e.code === "ECONNREFUSED"));
    s.once("timeout", () => { s.destroy(); resolve(false); });
  });
}
(async () => {
  const author = evidence(path.join(qa, "browser-matrix-06/report.json"));
  const runtime = evidence(path.join(qa, "runtime-green-07/report.json"));
  const inheritance = evidence(path.join(qa, "source-roundtrip-02/report.json"));
  const portable = evidence(process.env.AGENTVN_OPACITY_PORTABLE_SPLIT_REPORT
    || path.join(qa, "portable-split-03/report.json"));
  const gates = evidence(path.join(qa, "check-01/report.json"));
  const dev = evidence(path.join(qa, "dev-01/report.json"));
  const old = evidence(path.join(native, "opacity-old-03/report.json"));
  const current = evidence(path.join(native, "opacity-current-02/report.json"));
  check("Non-empty author, two-layout Runtime and portable workflows", () => {
    assert.equal(author.cases.length, 1); validateMatrix(author.matrix);
    assert(author.cases[0].persistedAndReopened && author.cases[0].independentReset && author.cases[0].agentvn);
    assert.equal(author.cases[0].pages.length, 7);
    assert.equal(runtime.cases.length, 14);
    assert.equal(new Set(runtime.cases.map(c => `${c.type}/${c.screenId}`)).size, 14);
    for (const c of runtime.cases) { assert.equal(c.status, "PASS"); validateMatrix(c.matrix); }
    assert.equal(inheritance.cases.length, 1);
    assert.equal(inheritance.cases[0].checks.length, 17);
    assert(inheritance.cases[0].checks.every(c => c.status === "PASS"));
    assert.equal(portable.cases.length, 1);
    const roundtrip = portable.cases[0].portableRoundtrip;
    assert.equal(roundtrip.status, "PASS");
    assert(roundtrip.bothProfilesPreserved && roundtrip.backendPreserved && roundtrip.graphPreserved);
    assert.deepEqual(roundtrip.types, ["agentvn", "renpy"]);
  });
  check("19 source gates, complete Dev replacement and bundled source hashes", () => {
    assert.equal(gates.commands.length, 19); assert.equal(dev.commands.length, 1);
    for (const c of [...gates.commands, ...dev.commands]) {
      assert.equal(c.status, "PASS"); assert.equal(c.exitCode, 0); verify(c.log.path, c.log.sha256);
    }
    assert.deepEqual(gates.sources, author.sources); assert.deepEqual(dev.sources, author.sources);
    for (const p of dev.products) verify(p.path, p.sha256);
    assert.equal(dev.products[0].sha256, dev.products[1].sha256);
    assert.equal(dev.products[2].sha256, dev.products[3].sha256);
    assert(Date.parse(dev.products[0].generatedAt) >= Date.parse(dev.commands[0].startedAt));
    assert.notEqual(dev.products[0].sha256, dev.before.sha256);
    assert.equal(dev.bundled.length, 14);
    for (const p of dev.bundled) verify(p.path, p.sha256);
    assert.equal(current.executable.sha256, dev.products[2].sha256);
    report.products = dev.products;
  });
  check("Actual old binary refusal and new native category terminal state", () => {
    assert.equal(old.cases.length, 3); assert.equal(current.cases.length, 2);
    assert(old.cases.every(c => c.status === "PASS")); assert(old.cases.find(c => c.type === "control").controlPlayed);
    for (const c of old.cases.filter(c => c.type !== "control")) {
      assert(c.refusedBeforePlay); assert.equal(c.refusalStage, "LEGACY_STYLE_VALIDATION_BEFORE_VERSION_PROMPT");
      assert.equal(c.minimumVersionPrompt, "NOT_REACHED_NOT_PASS");
    }
    for (const c of current.cases) {
      assert.equal(c.status, "PASS"); assert.deepEqual(c.title, { background: .4, navigation: .7 });
      assert.deepEqual(c.settings, { background: .4, content: .7, tabs: 5 });
      assert(c.realCategoryClick);
      assert.deepEqual(c.categoryFinal, { transition: "idle", activeCategories: 1, snapshots: 0, opacity: 1 });
    }
  });
  for (const r of [author, runtime, inheritance, portable, old, current]) artifacts(r);
  const ports = new Set();
  for (const r of [author, runtime, inheritance, portable]) {
    assert.equal(r.cleanup.status, "PASS");
    for (const url of [r.service.url, r.service.backendUrl].filter(Boolean)) ports.add(new URL(url).port);
  }
  for (const [r, folder] of [[old, "opacity-old-03"], [current, "opacity-current-02"]]) {
    assert.equal(r.cleanupError, null);
    const restored = evidenceRestore(path.join(native, folder, "profile-restoration.json"));
    assert.equal(restored.deletedUserFiles, 0);
    for (const l of r.launches) { assert.equal(l.cleanup, "PASS"); assert.equal(processIdentity(l.pid), null); ports.add(l.port); }
  }
  for (const port of ports) assert(await closed(port), `Unexpected listener on QA port ${port}`);
  report.checks.push({ name: "QA ports closed, owned native processes gone and user directories restored", status: "PASS" });
  check("Unchanged motion stylesheet, safety instructions, publishing rules and frozen Release", () => {
    const cp = read("F:/AgentVN/Checkpoints/Layout-Opacity-Split-20261020-01/manifest.json");
    for (const name of ["AGENTS.md", "GameCli_framework/src/styles/shell.css", ".gitignore", "scripts/push-agentvn-editor.ps1"]) {
      const original = cp.files.find(f => f.file === name); assert(original);
      verify(path.join(root, name), original.sha256);
    }
    const frozen = "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor";
    verify(path.join(frozen, "agentvn-editor.exe"), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    verify(path.join(frozen, "agentvn-player.exe"), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
  });
  check("Publishing preflight does not stage, commit, fetch or push the real workspace", () => {
    const git = (...args) => {
      const r = spawnSync("git", args, { cwd: root, windowsHide: true, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
    };
    const before = { head: git("rev-parse", "HEAD"), index: sha(path.join(root, ".git/index")) };
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/push-agentvn-editor.ps1"), "-CheckOnly"],
    { cwd: root, windowsHide: true, encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /CHECK_ONLY_PASS/);
    const after = { head: git("rev-parse", "HEAD"), index: sha(path.join(root, ".git/index")) };
    assert.deepEqual(after, before);
    report.publishing = { status: "PASS", before, after, output: r.stdout, networkPush: false };
    for (const name of ["output/layout-opacity-split-20261021-01/REPORT.md", "AgentVN Dev.exe"]) {
      const ignored = spawnSync("git", ["check-ignore", "-q", "--", name], { cwd: root, windowsHide: true });
      assert.equal(ignored.status, 0, `Generated output must remain ignored: ${name}`);
    }
    const test = spawnSync("git", ["check-ignore", "-q", "--", "scripts/layout-opacity-split-audit.cjs"],
      { cwd: root, windowsHide: true });
    assert.equal(test.status, 1, "Do not ignore the new regression source");
  });
  report.verifiedFiles = [...files.values()];
  report.behavior = { authorDisplayCombinations: 12, runtimeBusinessCases: 14, runtimeDisplayCombinations: 168,
    portableSplitRoundtrips: 1, nativeBusinessCases: 2, oldBinaryCases: 3,
    nativeCategoryTerminalState: true, physical4K: false };
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    verifiedFiles: report.verifiedFiles.length, out, error: report.error }));
});
function evidenceRestore(file) {
  const r = read(file); assert.equal(r.status, "PASS"); report.reports.push(describe(file)); return r;
}
