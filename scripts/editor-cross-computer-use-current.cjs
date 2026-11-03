"use strict";
// QA only: preserve the pinned legacy upgrade flow and use observed native input.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f) });

function validateInput(request, receipt) {
  for (const key of ["pid", "created", "label"]) assert.equal(receipt[key], request[key], key);
  assert.equal(receipt.status, "INPUT_COMPLETED");
  assert.equal(receipt.method, "Computer Use Alt+F4");
  assert.equal(receipt.physicalInput, true);
  assert(Number.isSafeInteger(receipt.windowId) && receipt.windowId > 0);
  assert(Date.parse(receipt.inputAt) >= Date.parse(request.requestedAt));
}

async function closeWithComputerUse({ launch, known, out }) {
  const request = {
    label: launch.label, pid: launch.pid, created: launch.created, exe: launch.exe,
    ports: launch.ports, requestedAt: new Date().toISOString(),
    completion: path.join(out, "native-close-" + launch.label + "-completed.json"),
  };
  const requestFile = path.join(out, "computer-use-close-" + launch.label + "-request.json");
  fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), { flag: "wx" });
  console.log("COMPUTER_USE_CLOSE", JSON.stringify(request));
  await until(() => fs.existsSync(request.completion), "observed Computer Use close input", 600000);
  const input = read(request.completion);
  validateInput(request, input);
  let failure;
  try {
    await until(() => !rows().some(p => known.some(k =>
      p.ProcessId === k.ProcessId && p.Created === k.Created))
      && listeners(launch.ports).length === 0, "native close naturally exits owned processes", 30000);
  } catch (error) { failure = error; }
  const live = rows(), remaining = known.filter(k =>
    live.some(p => p.ProcessId === k.ProcessId && p.Created === k.Created));
  const result = {
    ...input, status: failure ? "FAILED" : "PASS", normalClose: !failure,
    hostExited: !live.some(p => p.ProcessId === launch.pid && p.Created === launch.created),
    remainingBackend: remaining.filter(p => p.Name === "creator-backend.exe"),
    remainingOwned: remaining, remainingPorts: listeners(launch.ports),
    request: describe(requestFile), input: describe(request.completion),
    finishedAt: new Date().toISOString(),
    ...(failure ? { error: String(failure.stack || failure) } : {}),
  };
  fs.writeFileSync(path.join(out, launch.label + "-close-native.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  if (failure) {
    if (launch.label === "old")
      fs.writeFileSync(path.join(out, "physical-old-close-observation.json"), JSON.stringify(result, null, 2), { flag: "wx" });
    throw failure;
  }
  return result;
}

function main() {
  const [action, configFile, auditId] = process.argv.slice(2), c = read(configFile);
  assert.equal(c.version, "1.9.35"); assert.equal(c.oldVersion, "1.7.1");
  assert.equal(c.closeMode, "computer-use");
  require("./editor-candidate-upgrade.cjs").validateConfig(c);
  const auditing = action === "audit";
  const original = path.join(__dirname, auditing ? "editor-cross-candidate-audit.cjs" : "editor-cross-candidate.cjs");
  assert.equal(sha(original), auditing
    ? "a0031356b79acbda46fd2e2a8cc318ae9a0aee126497a76ebd4313941cc19934"
    : "d5a772bd1d6c72b08eb7157202bd3dfc789ed84e1c0a127779d0727805c6ebee");
  let source = fs.readFileSync(original, "utf8").replaceAll("1.9.31", c.version)
    .replaceAll("1_9_31", "1_9_35").replaceAll("Editor跨代1931", "Editor跨代1935");
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, () => after);
  };
  if (!auditing) {
    one('psOne("\'D:\\\\AgentVN\\\\scripts\\\\editor-candidate-upgrade.cjs\'",',
      `psOne(${JSON.stringify("'" + require.resolve("./editor-candidate-upgrade.cjs") + "'")},`);
    one("  return { source, session, changes };", `  const closeBegin=source.indexOf("async function closeNormally(label){");
  const closeEnd=source.indexOf("async function forceCleanup()",closeBegin);
  assert(closeBegin>0 && closeEnd>closeBegin);
  source=source.slice(0,closeBegin)+\`async function closeNormally(label){
    assert.equal(label,current.label);remember();
    const result=await require("./editor-cross-computer-use-current.cjs").closeWithComputerUse({launch:current,known:report.known,out});
    await browser.close().catch(()=>{});browser=null;child=null;
    report.cleanups.push({label,status:"PASS",normalClose:true,method:result.method,killed:[],ports:current.ports});save();
    return result;
  }
  \`+source.slice(closeEnd);
  source=source.replace('"real native migration consent receipt",120000','"real native migration consent receipt",600000');
  session=session.replace("'D:\\\\AgentVN\\\\plans\\\\ACTIVE_TASKS.md'",${JSON.stringify("'" + path.resolve(__dirname, "../plans/ACTIVE_TASKS.md") + "'")});
  new vm.Script(Module.wrap(source));
  return { source, session, changes };`);
    one("files: [__filename, configFile, c.actualInstallation.path, c.oldInstaller.path,",
      `files: [__filename, ${JSON.stringify(original)}, configFile, c.actualInstallation.path, c.oldInstaller.path,`);
    one("if (require.main === module) main();", "main();");
  } else {
    assert.match(auditId || "", /^\d{2}$/);
  }
  new vm.Script(Module.wrap(source));
  process.argv = [process.argv[0], __filename, ...(auditing ? [configFile, auditId] : [action, configFile])];
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths; worker._compile(source, __filename);
}
module.exports = { validateInput, closeWithComputerUse };
if (require.main === module) main();
