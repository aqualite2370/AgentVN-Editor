"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict");
const { freshRequest, sendClose, validateClose, CLOSE } = require("./windows-repository-native.cjs");
const { rows, listeners, until } = require("./current-native-editor-session.cjs");
async function normalPlayerClose({ page, launch, out, name, known }) {
  const identity = rows().find(p => p.ProcessId === launch.pid && p.Created === launch.created);
  assert(identity, "Player close must target the recorded live process");
  const request = freshRequest(out, name, identity), requestEvidence = sendClose(request, out);
  const button = page.getByTestId("confirm-exit-game");
  await button.waitFor({ state: "visible", timeout: 15000 });
  assert(await button.isEnabled());
  const confirmation = { testId: "confirm-exit-game", label: await button.innerText(),
    dialogText: await page.getByRole("dialog").filter({ has: button }).innerText() };
  assert(confirmation.dialogText.includes("退出"));
  await button.click();
  await until(() => {
    const live = rows();
    return !known.some(p => live.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created))
      && listeners([launch.port]).length === 0;
  }, "WM_CLOSE followed by actual exit confirmation and natural Player exit", 45000);
  const receipt = { status: "INPUT_COMPLETED", requestId: request.requestId, ownerPid: request.ownerPid,
    created: request.created, interaction: CLOSE, method: "REPOSITORY_WM_CLOSE_NATURAL_EXIT",
    physicalInputVerified: false, requestEvidence, confirmation, naturalExitObserved: true,
    survivingOwned: [], remainingListeners: listeners([launch.port]), finishedAt: new Date().toISOString() };
  validateClose(request, receipt);
  fs.writeFileSync(request.completion, JSON.stringify(receipt, null, 2), { flag: "wx" });
  return { request, receipt };
}
module.exports = { normalPlayerClose };
