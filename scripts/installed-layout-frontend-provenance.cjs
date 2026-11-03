"use strict";
// Read static assets served by an actual installed Editor. No author edits,
// model calls, source injection, native pickers or package-cache replacement.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const [installationFile, out] = process.argv.slice(2);
assert(installationFile && out && !fs.existsSync(out));
assert(path.resolve(out).startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(__dirname, "..");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_INSTALLED_STATIC_FRONTEND_PROVENANCE_NOT_FUNCTIONAL_ACCEPTANCE",
  installation: describe(installationFile), launches: [], cleanups: [], errors: [],
  screenshots: [], modelRequests: 0, assets: [], productEdits: 0 };
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({ installationFile, out, report, save,
  input: path.join(root, "scripts/fixtures/editor-isolated-small.vnproj") });
(async () => {
  save(); const page = await host.start();
  const queue = await page.evaluate(() => Array.from(document.scripts).map(s => s.src).filter(Boolean));
  assert(queue.length > 0);
  const visited = new Set();
  while (queue.length) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    assert(visited.size < 150, "Bounded static asset inventory");
    visited.add(url);
    const data = await page.evaluate(async url => {
      const u = new URL(url, location.href);
      if (u.origin !== location.origin || !/^\/assets\/[\w.-]+\.js$/.test(u.pathname))
        throw Error("Refuse non-static or cross-origin resource: " + url);
      const response = await fetch(u.href);
      if (!response.ok) throw Error("Static resource HTTP " + response.status);
      const text = await response.text();
      if (/^\s*</.test(text)) throw Error("Expected JavaScript, received HTML");
      return { url: u.href, name: u.pathname.split("/").at(-1), text };
    }, url);
    const file = path.join(out, data.name);
    fs.writeFileSync(file, data.text, { flag: "wx" });
    report.assets.push({ ...describe(file), url: data.url }); save();
    for (const match of data.text.matchAll(/["']((?:\.\/)?(?:assets\/)?[\w-]+\.js)["']/g)) {
      const name = match[1].split("/").at(-1);
      queue.push(new URL("/assets/" + name, data.url).href);
    }
  }
  const installed = report.assets.filter(a => /^RuntimeLayoutDesigner-[\w-]+\.js$/.test(path.basename(a.path)));
  assert.equal(installed.length, 1, "Must inspect the real installed layout designer chunk");
  const localFolder = path.join(root, "editor/dist/assets");
  const current = fs.readdirSync(localFolder).filter(n => /^RuntimeLayoutDesigner-[\w-]+\.js$/.test(n));
  assert.equal(current.length, 1);
  const currentFile = path.join(localFolder, current[0]);
  const retained = path.join(out, "current-" + current[0]);
  fs.copyFileSync(currentFile, retained, fs.constants.COPYFILE_EXCL);
  report.comparison = { installed: installed[0], localBuiltFrontend: describe(retained),
    identical: installed[0].sha256 === sha(retained),
    interpretation: "Different bytes require current-build installation testing; this alone is not a product failure." };
  assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  try { await host.stop("Read-only installed frontend provenance; not a natural-close test"); }
  catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, assets: report.assets.length,
    identical: report.comparison?.identical, error: report.error, cleanupError: report.cleanupError }));
});
