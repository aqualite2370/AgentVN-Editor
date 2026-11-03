"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module"), vm = require("node:vm");
assert.equal(process.argv[2], "04");
const original = path.join(__dirname, "candidate-1924-abilities-audit.cjs");
let source = fs.readFileSync(original, "utf8");
assert.equal(crypto.createHash("sha256").update(source).digest("hex"),
  "622c810a835f78951181f32a4c39a1ab3f46ec459101f371e4c5712d127b6688");
const count = "assert.equal(adapted.adaptations.length, 6);";
assert.equal(source.split(count).length - 1, 1);
source = source.replace(count, "assert.equal(adapted.adaptations.length, 11);");
const end = '  report.status = "PASS";';
assert.equal(source.split(end).length - 1, 1);
source = source.replace(end, `
  check("Every actual grid remains unique with six live slots and inert retained presentation", () => {
    let probes = 0, retainedWithSaves = 0;
    for (const cell of session.cells) {
      const raw = read(cell.raw.path);
      assert.equal(raw.saveGridProbes.length, 2);
      for (const p of raw.saveGridProbes) {
        probes++;
        assert.equal(p.liveGrids, 1); assert.equal(p.liveSlots, 6); assert.equal(p.liveSaved, 6);
        assert.equal(p.allSaved, p.liveSaved + p.retained.reduce((n, g) => n + g.saved, 0));
        if (p.allSaved > p.liveSaved) retainedWithSaves++;
        for (const g of p.retained) {
          assert(g.inert); assert.equal(g.hidden, "true"); assert.equal(g.pointerEvents, "none");
          assert.equal(g.functionalMarkers, 0); assert.equal(g.hasFocus, false);
        }
      }
      const expectedLogs = ["agentvn-player-1.log", "agentvn-player-3.log", "renpy-player-2.log"];
      const logs = fs.readdirSync(cell.out).filter(name => expectedLogs.includes(name));
      assert.deepEqual(logs.sort(), expectedLogs);
    }
    assert.equal(probes, 24); assert(retainedWithSaves > 0);
    return { probes, retainedWithSaves, exclusiveLaunchLogs: 36 };
  });
` + end);
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  assert(source.includes("assert.equal(raw.checks.length, 16)"));
  assert(source.includes("assert.equal(adapted.adaptations.length, 11)"));
  console.log("PASS exact original audit, eleven replayable source changes, full assertions and additional grid/log evidence");
} else {
  const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
  adapted._compile(source, __filename);
}
