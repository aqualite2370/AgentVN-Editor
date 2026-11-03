"use strict";

function getStagedMaterialMode(mode) {
  if (!["default", "visible-material", "staged-visible-material"].includes(mode))
    throw new Error("unsupported material preparation mode");
  return mode === "staged-visible-material";
}

// Also serialized into the browser; no external dependencies.
function groupMaterialSignatures(records) {
  if (!records.length) throw new Error("nonempty material population required");
  const ids = new Set(), groups = new Map();
  for (const { id, signature } of records) {
    if (!Number.isInteger(id) || id < 0 || ids.has(id)) throw new Error("unique nonnegative material IDs required");
    if (typeof signature !== "string" || !signature) throw new Error("material signature required");
    ids.add(id);
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(id);
  }
  return [...groups.values()];
}

// Serialized into the page. This intentionally changes presentation during
// preparation and is diagnostic only. It must be measured from before setup
// through restoration and the real navigation, never used as an acceptance fix.
function installStagedMaterialPlan() {
  const root = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
  if (!(root instanceof HTMLElement) || !root.inert || root.hasAttribute("data-e2-staged-material"))
    throw new Error("staged preparation requires an untouched inert warm layout");
  const nodes = [root, ...root.querySelectorAll("*")];
  if (nodes.some(node => node.hasAttribute("data-e2-material-ready")))
    throw new Error("diagnostic attribute collision");
  const records = nodes.map((node, id) => {
    const rect = node.getBoundingClientRect(), main = getComputedStyle(node);
    const drawable = main.visibility === "visible" && main.display !== "none"
      && rect.width > 0 && rect.height > 0 && !node.closest("[hidden]");
    const styles = [null, "::before", "::after"].map(pseudo => {
      const style = getComputedStyle(node, pseudo);
      return [style.background, style.boxShadow, style.borderRadius, style.filter, style.backdropFilter,
        style.borderWidth, style.borderStyle, style.opacity, style.transform, style.clipPath];
    });
    return { id, drawable, signature: JSON.stringify(styles) };
  });
  const style = document.createElement("style");
  style.dataset.e2StagedMaterialDiagnostic = "not-acceptance";
  const base = "[data-e2-staged-material]";
  const subjects = [base, `${base} *`];
  const suffixes = ["", "::before", "::after"];
  const hidden = subjects.flatMap(subject => suffixes.map(suffix => `${subject}${suffix}`));
  const shown = [`${base}[data-e2-material-ready="true"]`, `${base} [data-e2-material-ready="true"]`]
    .flatMap(subject => suffixes.map(suffix => `${subject}${suffix}`));
  style.textContent = `${hidden.join(",")}{visibility:hidden!important}\n` +
    `${shown.join(",")}{visibility:visible!important}`;
  root.setAttribute("data-e2-staged-material", "diagnostic-only");
  document.head.append(style);
  const state = { root, nodes, records, style, cleaned: false };
  state.cleanup = () => {
    if (state.cleaned) return;
    for (const node of nodes) node.removeAttribute("data-e2-material-ready");
    root.removeAttribute("data-e2-staged-material");
    style.remove();
    state.cleaned = true;
  };
  window.__e2StagedMaterialPlan = state;
  return { records, nodeCount: nodes.length, drawableCount: records.filter(item => item.drawable).length,
    performanceAcceptance: false };
}

async function runStagedMaterialPlan(groups) {
  const state = window.__e2StagedMaterialPlan;
  if (!state || state.cleaned || !state.root.matches(":popover-open") || !state.root.inert)
    throw new Error("staged material top-layer ownership missing");
  const expected = state.records.filter(item => item.drawable).map(item => item.id).sort((a, b) => a - b);
  const received = groups.flat().sort((a, b) => a - b);
  if (JSON.stringify(expected) !== JSON.stringify(received))
    throw new Error("staged batches must cover every drawable exactly once");
  const batches = [];
  for (const ids of groups) {
    const start = performance.now();
    for (const id of ids) state.nodes[id].setAttribute("data-e2-material-ready", "true");
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const visible = ids.every(id => getComputedStyle(state.nodes[id]).visibility === "visible");
    if (!visible) throw new Error("staged batch failed actual visibility verification");
    batches.push({ count: ids.length, start, end: performance.now() });
  }
  return { batchCount: groups.length, batches, drawableCount: received.length, performanceAcceptance: false };
}

module.exports = { groupMaterialSignatures, getStagedMaterialMode, installStagedMaterialPlan, runStagedMaterialPlan };
