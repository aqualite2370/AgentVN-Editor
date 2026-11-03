const assert = require("node:assert/strict");

async function main() {
  const module = await import("../editor/src/utils/runtimeLayoutSession.mjs");
  const clone = (value) => ({ ...value });
  const equals = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const initial = { value: "initial" };
  let session = module.createRuntimeLayoutSession(initial, "project-a", clone, equals);

  session = module.editRuntimeLayoutSession(session, (draft) => ({ value: `${draft.value}-first` }));
  const historyBeforeSave = session.history;
  const savedWithoutFurtherEdit = module.beginRuntimeLayoutSave(session);
  const savedWithoutFurtherEditResult = module.receiveRuntimeLayoutSnapshot(
    savedWithoutFurtherEdit.session,
    { value: "canonical-first" },
    {
      projectKey: "project-a",
      requestId: savedWithoutFurtherEdit.request.requestId,
      version: savedWithoutFurtherEdit.request.version,
    },
  );
  assert.equal(savedWithoutFurtherEditResult.accepted, true);
  assert.deepEqual(savedWithoutFurtherEditResult.session.history, historyBeforeSave,
    "saving must preserve undo/redo history when no edit occurred during the request");
  const restoredAfterSave = module.undoRuntimeLayoutSession(savedWithoutFurtherEditResult.session);
  assert.equal(restoredAfterSave.draft.value, "initial",
    "undo must remain available after a successful save");
  const failedSave = module.beginRuntimeLayoutSave(savedWithoutFurtherEditResult.session);
  const afterFailure = module.failRuntimeLayoutSave(
    failedSave.session,
    failedSave.request.requestId,
  );
  assert.equal(afterFailure.pendingSave, undefined, "failed save must release the in-flight request");
  assert.equal(afterFailure.dirty, false, "failed retry bookkeeping must not rewrite the saved baseline");
  assert.deepEqual(afterFailure.history, savedWithoutFurtherEditResult.session.history,
    "failed save must preserve the undo/redo history for retry");
  const retry = module.beginRuntimeLayoutSave(afterFailure);
  assert.equal(retry.request.requestId, failedSave.request.requestId + 1,
    "retry must allocate a fresh request id");

  const started = module.beginRuntimeLayoutSave(session);
  session = started.session;
  session = module.editRuntimeLayoutSession(session, (draft) => ({ value: `${draft.value}-continued` }));

  const delayed = module.receiveRuntimeLayoutSnapshot(
    session,
    { value: "canonical-first" },
    { projectKey: "project-a", requestId: started.request.requestId, version: started.request.version },
  );
  assert.equal(delayed.accepted, true);
  assert.equal(delayed.session.draft.value, "initial-first-continued");
  assert.equal(delayed.session.savedSnapshot.value, "canonical-first");
  assert.equal(delayed.session.dirty, true);

  const nextSave = module.beginRuntimeLayoutSave(delayed.session);
  const stale = module.receiveRuntimeLayoutSnapshot(
    nextSave.session,
    { value: "stale" },
    { projectKey: "project-a", requestId: started.request.requestId, version: started.request.version },
  );
  assert.equal(stale.accepted, false);

  const wrongProject = module.receiveRuntimeLayoutSnapshot(
    nextSave.session,
    { value: "wrong-project" },
    { projectKey: "project-b", requestId: nextSave.request.requestId, version: nextSave.request.version },
  );
  assert.equal(wrongProject.accepted, false);

  const accepted = module.receiveRuntimeLayoutSnapshot(
    nextSave.session,
    { value: "canonical-latest" },
    { projectKey: "project-a", requestId: nextSave.request.requestId, version: nextSave.request.version },
  );
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.session.draft.value, "canonical-latest");
  assert.equal(accepted.session.savedSnapshot.value, "canonical-latest");
  assert.equal(accepted.session.dirty, false);

  const undone = module.undoRuntimeLayoutSession(
    module.editRuntimeLayoutSession(accepted.session, (draft) => ({ value: `${draft.value}-edit` })),
  );
  assert.equal(undone.draft.value, "canonical-latest");
  const redone = module.redoRuntimeLayoutSession(undone);
  assert.equal(redone.draft.value, "canonical-latest-edit");

  console.log("runtime layout session contract: PASS");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
