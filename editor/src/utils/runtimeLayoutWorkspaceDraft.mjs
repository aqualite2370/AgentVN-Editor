const workspaceDrafts = new Map();

function cacheKey(projectId, layoutType) {
  return JSON.stringify([projectId, layoutType]);
}

export function readRuntimeLayoutWorkspaceDraft(projectId, layoutType, clone) {
  const draft = workspaceDrafts.get(cacheKey(projectId, layoutType));
  return draft === undefined ? undefined : clone(draft);
}

export function writeRuntimeLayoutWorkspaceDraft(projectId, layoutType, draft, clone) {
  workspaceDrafts.set(cacheKey(projectId, layoutType), clone(draft));
}

export function clearRuntimeLayoutWorkspaceDraft(projectId, layoutType) {
  workspaceDrafts.delete(cacheKey(projectId, layoutType));
}
