"use strict";

// Browser-side contract probe only. No layout reads, DOM writes or model calls.
function installWorkspaceInertOwnershipProbe() {
  const state = window.__advancedLayoutTransitionAudit;
  if (!state || state.inertOwnershipProbe) throw new Error("workspace inert probe owner missing or duplicated");
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
  if (!descriptor?.configurable || typeof descriptor.get !== "function" || typeof descriptor.set !== "function")
    throw new Error("native inert accessor is required");
  const records = [];
  const setter = function (value) {
    if (state.running && state.interactionStart != null
      && this.classList.contains("editor-workspace-body")) {
      records.push({ at: performance.now(), previous: descriptor.get.call(this),
        requested: Boolean(value) });
    }
    return descriptor.set.call(this, value);
  };
  Object.defineProperty(HTMLElement.prototype, "inert", { ...descriptor, set: setter });
  state.inertOwnershipProbe = { records, restored: false, cleanup() {
    if (this.restored) return;
    if (Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert")?.set !== setter)
      throw new Error("workspace inert probe accessor ownership changed");
    Object.defineProperty(HTMLElement.prototype, "inert", descriptor);
    this.restored = true;
  } };
}

function inspectWorkspaceInertOwnership(records) {
  if (!Array.isArray(records) || records.length === 0)
    throw new Error("nonempty workspace inert writes required");
  for (const record of records) {
    if (!Number.isFinite(record.at) || typeof record.previous !== "boolean"
      || typeof record.requested !== "boolean") throw new Error("invalid inert write record");
  }
  return {
    lockCount: records.filter(record => !record.previous && record.requested).length,
    transientUnlocks: records.filter(record => record.previous && !record.requested),
    redundantWrites: records.filter(record => record.previous === record.requested),
  };
}
module.exports = { installWorkspaceInertOwnershipProbe, inspectWorkspaceInertOwnership };
