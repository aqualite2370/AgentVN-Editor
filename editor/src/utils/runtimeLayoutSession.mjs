function cloneValue(value, clone) {
  return clone(value);
}

function sameValue(left, right, equals) {
  return equals(left, right);
}

export function createRuntimeLayoutSession(initialSnapshot, projectKey, clone, equals) {
  const snapshot = cloneValue(initialSnapshot, clone);
  return {
    draft: snapshot,
    savedSnapshot: cloneValue(snapshot, clone),
    history: { past: [], future: [] },
    dirty: false,
    projectKey,
    version: 0,
    nextRequestId: 0,
    pendingSave: undefined,
    clone,
    equals,
  };
}

export function editRuntimeLayoutSession(session, updater) {
  const nextDraft = updater(cloneValue(session.draft, session.clone));
  if (sameValue(session.draft, nextDraft, session.equals)) return session;
  return {
    ...session,
    draft: cloneValue(nextDraft, session.clone),
    history: {
      past: [...session.history.past.slice(-30), cloneValue(session.draft, session.clone)],
      future: [],
    },
    dirty: true,
  };
}

export function undoRuntimeLayoutSession(session) {
  const previous = session.history.past[session.history.past.length - 1];
  if (!previous) return session;
  return {
    ...session,
    draft: cloneValue(previous, session.clone),
    history: {
      past: session.history.past.slice(0, -1),
      future: [cloneValue(session.draft, session.clone), ...session.history.future],
    },
    dirty: !sameValue(previous, session.savedSnapshot, session.equals),
  };
}

export function redoRuntimeLayoutSession(session) {
  const next = session.history.future[0];
  if (!next) return session;
  return {
    ...session,
    draft: cloneValue(next, session.clone),
    history: {
      past: [...session.history.past, cloneValue(session.draft, session.clone)],
      future: session.history.future.slice(1),
    },
    dirty: !sameValue(next, session.savedSnapshot, session.equals),
  };
}

export function beginRuntimeLayoutSave(session) {
  const requestId = session.nextRequestId + 1;
  const version = session.version + 1;
  const request = {
    requestId,
    version,
    projectKey: session.projectKey,
    draft: cloneValue(session.draft, session.clone),
  };
  return {
    session: {
      ...session,
      nextRequestId: requestId,
      pendingSave: request,
    },
    request,
  };
}

export function receiveRuntimeLayoutSnapshot(session, snapshot, metadata = {}) {
  if (metadata.projectKey !== undefined && metadata.projectKey !== session.projectKey) {
    return { accepted: false, session };
  }
  const pending = session.pendingSave;
  if (metadata.requestId !== undefined) {
    if (metadata.requestId < session.nextRequestId) return { accepted: false, session };
    if (pending && metadata.requestId !== pending.requestId) return { accepted: false, session };
  } else if (pending) {
    return { accepted: false, session };
  }

  const canonical = cloneValue(snapshot, session.clone);
  const baseline = pending?.draft ?? session.draft;
  const draftChangedSinceSave = !sameValue(session.draft, baseline, session.equals);
  return {
    accepted: true,
    session: {
      ...session,
      savedSnapshot: canonical,
      draft: draftChangedSinceSave ? session.draft : cloneValue(canonical, session.clone),
      // A successful save establishes a new clean baseline, but it must not
      // erase the in-session undo/redo timeline. External snapshots without a
      // matching save request still reset history below to avoid replaying
      // edits from a different canonical source.
      history: pending ? session.history : { past: [], future: [] },
      dirty: draftChangedSinceSave,
      version: Math.max(session.version, metadata.version ?? pending?.version ?? session.version),
      pendingSave: undefined,
    },
  };
}

export function failRuntimeLayoutSave(session, requestId) {
  if (!session.pendingSave || session.pendingSave.requestId !== requestId) return session;
  return { ...session, pendingSave: undefined };
}
