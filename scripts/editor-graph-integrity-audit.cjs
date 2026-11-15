"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const base = "F:/testavn/Editor-Delete-Integrity-20261116-01", output = path.join(base, "terminal-audit-01.json");
assert(!fs.existsSync(output));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const input = (name, expected) => {
  const file = path.join(base, name, "report.json"), result = read(file);
  assert.equal(result.status, expected); return { path: file, sha256: sha(file), result };
};
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], cleanup: [],
  scope: "SOURCE_GRAPH_INTEGRITY_REAL_BROWSER_BACKEND_NOT_NEW_DEV_INSTALLATION_OR_PHYSICAL_PHONE",
  models: 0, deviceStarts: 0, productBuilds: 0 };
const check = (name, fn) => {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
};
try {
  check("original deletion and route failures retained", () => {
    const deletion = input("before-01", "FAILED"), route = input("route-before-01", "FAILED");
    assert.equal(deletion.result.cases.filter(c => c.status === "FAILED").length, 8);
    assert.equal(route.result.cases.length, 10);
    assert.equal(route.result.cases.filter(c => c.status === "FAILED").length, 8);
    const qa = input("route-browser-after-01", "FAILED"); assert.equal(qa.result.cases.length, 1);
    return { deletion: deletion.sha256, route: route.sha256, invalidFixtureQaFailure: qa.sha256 };
  });
  check("33 nonempty direct regressions and 10 actual source-browser behaviors", () => {
    let direct = 0, browser = 0;
    for (const [name, count, kind] of [["after-complete-01", 8, "direct"], ["route-after-01", 10, "direct"],
      ["persistence-complete-01", 15, "direct"], ["browser-complete-01", 4, "browser"],
      ["route-browser-after-02", 6, "browser"]]) {
      const r = input(name, "PASS").result;
      assert.equal(r.cases.length, count); assert(r.cases.every(c => c.status === "PASS"));
      if (kind === "direct") direct += count;
      else {
        browser += count; assert.equal(r.errors.length, 0);
        assert.equal(r.cleanup, "OWNED_BROWSER_AND_SERVICES_STOPPED");
        for (const source of r.sources) assert.equal(sha(source.source), source.sha256);
        const capture = r.cases.at(-1).capture; assert.equal(sha(capture.path), capture.sha256);
        const viewport = capture.dimensions ?? capture.viewport, png = fs.readFileSync(capture.path);
        assert.equal(png.readUInt32BE(16), viewport.width * viewport.dpr);
        assert.equal(png.readUInt32BE(20), viewport.height * viewport.dpr);
      }
    }
    return { direct, browser, originalNaturalNodeLoss: "NOT_REPRODUCED" };
  });
  check("reviewed source pushed without moving real HEAD or index", () => {
    const delivery = read(path.join(base, "source-delivery-01.json"));
    assert.equal(delivery.status, "PASS"); assert.equal(delivery.files.length, 10);
    assert(delivery.files.every(f => f.remotelyVerified));
    assert.deepEqual(delivery.before, delivery.after);
    const head = cp.execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
    const index = cp.execFileSync("git", ["rev-parse", "--git-path", "index"], { encoding: "utf8", windowsHide: true }).trim();
    assert.equal(head, delivery.before.head); assert.equal(sha(index), delivery.before.indexSha256);
    for (const file of delivery.files) assert.equal(sha(file.relative), file.sha256);
    return { commit: delivery.commit, files: delivery.files.length, realHeadIndexUnchanged: true };
  });
  check("frozen 1.9.77 and D daily remain unchanged; no live owned browser services", () => {
    const release = "F:/testavn/Editor-Home-Save-Release-1977-20261116-01";
    const build = read(path.join(release, "release/build.json")), before = read(path.join(release, "checkpoint.json"));
    assert.equal(build.version, "1.9.77");
    assert.equal(sha(build.installer.path), build.installer.sha256);
    assert.equal(sha(before.daily.path), before.daily.sha256);
    const services = ["browser-after-01", "browser-complete-01", "route-browser-after-01", "route-browser-after-02"]
      .map(name => read(path.join(base, name, "report.json")).service);
    const pids = [...new Set(services.flatMap(s => [s.backendPid, s.vitePid]))];
    const ports = [...new Set(services.flatMap(s => [new URL(s.url).port, new URL(s.backendUrl).port]).map(Number))];
    const command = `@{processes=@(Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue|Select-Object Id,ProcessName);` +
      `ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In @(${ports.join(",")})` +
      `|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4 -Compress`;
    const state = JSON.parse(cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", command],
      { encoding: "utf8", windowsHide: true, timeout: 20000 }).replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0, "Inspect reused PID before changing any process");
    assert.equal(state.ports.length, 0, "Do not affect unknown port owners");
    return { installer: build.installer.sha256, daily: before.daily.sha256, ownedServicesExited: true };
  });
  check("remove only four new empty temporary directories", () => {
    for (const name of ["browser-after-01", "browser-complete-01", "route-browser-after-01", "route-browser-after-02"]) {
      const target = path.resolve(base, name, "temp");
      assert.equal(path.dirname(target), path.resolve(base, name));
      for (const directory of [base, path.join(base, name), target]) {
        const item = fs.lstatSync(directory); assert(item.isDirectory() && !item.isSymbolicLink());
        assert.equal(fs.realpathSync(directory), path.resolve(directory));
      }
      assert.deepEqual(fs.readdirSync(target), [], "Do not expand cleanup beyond an empty directory");
      fs.rmdirSync(target); assert(!fs.existsSync(target));
      report.cleanup.push({ path: target, removedFiles: 0, logicalBytes: 0, removed: true });
    }
    return { emptyDirectories: 4, filesDeleted: 0, logicalBytes: 0, oldRejectedProfilesTouched: false };
  });
  report.status = "PASS_SOURCE_GRAPH_INTEGRITY_PENDING_NATIVE_DELIVERY";
} catch (error) { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, output, error: report.error }));
}
