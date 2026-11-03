"use strict";
function getSectionSelector(section) {
  if (!["header", "toolbar", "sidebar", "center", "inspector"].includes(section)) {
    throw new Error(`unsupported section: ${section}`);
  }
  return `.runtime-layout-${section}`;
}

// Browser-serialized diagnostic only. Never change page state or readiness.
function installSectionOmission(selector) {
  if (!/^\.runtime-layout-(header|toolbar|sidebar|center|inspector)$/.test(selector)) {
    throw new Error(`unsupported selector: ${selector}`);
  }
  const style = document.createElement("style");
  style.dataset.e2SectionOmission = selector;
  style.textContent = `.advanced-tab-content.is-warm[data-tab="layout"] ${selector}{display:none!important}`;
  document.head.appendChild(style);
  const state = window.__e2SectionOmission = {
    selector, restored: false, restores: 0, geometryEquivalent: false,
    interpretation: "Diagnostic only. Whole navigation includes restoration. Not performance acceptance.",
  };
  const restore = event => {
    if (state.restored || !event.isTrusted
      || !event.target?.closest?.('[data-help-key="advanced.tab.layout"]')) return;
    style.disabled = true;
    state.restored = true;
    state.restores++;
  };
  document.addEventListener("pointerdown", restore, true);
  state.cleanup = () => {
    document.removeEventListener("pointerdown", restore, true);
    style.remove();
  };
}

function inspectSectionOmission(warm) {
  const state = window.__e2SectionOmission;
  if (!state) throw new Error("omission diagnostic not installed");
  const root = document.querySelector(
    `.advanced-tab-content.${warm ? "is-warm" : "is-active"}[data-tab="layout"]`);
  const node = root?.querySelector(state.selector);
  if (!node) throw new Error("expected omission target absent");
  const rect = node.getBoundingClientRect();
  return {
    selector: state.selector, restored: state.restored, restores: state.restores,
    display: getComputedStyle(node).display,
    childCount: node.querySelectorAll("*").length,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    geometryEquivalent: false,
  };
}
module.exports = { getSectionSelector, installSectionOmission, inspectSectionOmission };
