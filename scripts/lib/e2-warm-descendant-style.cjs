"use strict";
const { getRasterBackendDiagnostic } = require("./e2-raster-backend-diagnostic.cjs");

function getWarmDescendantStyleDiagnostic(enabled, scope = {}) {
  if (!enabled) return { enabled: false };
  getRasterBackendDiagnostic("default", scope);
  if (scope.otherInterventions) throw new Error("Warm style attribution cannot combine interventions.");
  return { enabled: true, kind: "hidden-descendant-style-attribution-not-acceptance" };
}

function getWarmDescendantPrepaintMode(value, enabled) {
  if (!value) return "style-only";
  if (!enabled || !["style-only", "style-opacity"].includes(value))
    throw new Error("Prepaint mode requires warm-style diagnostic and must be style-only or style-opacity.");
  return value;
}

function getWarmDescendantReadAttribution(value, scope = {}) {
  if (!value) {
    if (scope.warmStyleEnabled && scope.slowDomReads)
      throw new Error("Paired slow DOM reads require explicit attribution selection.");
    return { enabled: false };
  }
  if (!["slow-dom-read", "root-token-cache", "cached-slow-dom-read", "cache-pruned-snapshot",
    "cache-pruned-zero-warm-start", "cache-pruned-inspector-zero-warm-start"].includes(value)
    || !scope.warmStyleEnabled
    || scope.prepaintMode !== "style-opacity"
    || (value.endsWith("slow-dom-read") ? !scope.slowDomReads : scope.slowDomReads)
    || Boolean(scope.pruneHiddenSnapshot) !== value.startsWith("cache-pruned-"))
    throw new Error("Read attribution requires style-opacity and exactly the selected read/cache probe.");
  return { enabled: true, mode: value, kind: "perturbed-warm-style-prepaint-read-attribution",
    performanceAcceptance: false };
}

function instrumentWarmStartOpacitySource(source) {
  const anchor = /nextNodeBeforeSwitch\s*&&\s*!nextNodeBeforeSwitch\.hidden\s*\?/g;
  const matches = [...source.matchAll(anchor)].length;
  if (matches !== 1) throw new Error(`Warm opacity source requires one exact guard, found ${matches}`);
  return { matches, valid: true, source: source.replace(anchor,
    'nextNodeBeforeSwitch && !nextNodeBeforeSwitch.hidden && !nextNodeBeforeSwitch.classList.contains("is-warm") ?') };
}

// Snapshot-only diagnostic. Shell preserves the invisible promoted root and
// its authored geometry/compositing rules while dropping its expensive tree.
function pruneHiddenSnapshotLayers(root, strategy = "root") {
  if (!["root", "shell", "columns", "keep-inspector"].includes(strategy))
    throw new Error("Unknown hidden snapshot strategy");
  const records = [];
  const layers = [...root.querySelectorAll(".advanced-tab-content[aria-hidden='true']")].map(layer => {
    const descendants = layer.querySelectorAll("*").length;
    const targets = strategy === "keep-inspector"
      ? [...layer.querySelectorAll(".runtime-layout-header,.runtime-layout-sidebar,.runtime-layout-center")]
      : strategy === "columns"
      ? [...layer.querySelectorAll(".runtime-layout-header,.runtime-layout-sidebar,.runtime-layout-center,.runtime-layout-inspector")]
      : strategy === "shell" ? [...layer.children] : [layer];
    let removedNodeCount = 0;
    for (const target of targets) {
      removedNodeCount += target.querySelectorAll("*").length + 1;
      records.push({ node: target, parent: target.parentNode, next: target.nextSibling });
      target.remove();
    }
    return { tab: layer.dataset.tab, descendants, removedNodeCount, strategy };
  });
  return { layers, records };
}

// Diagnostic only. Keep the existing numeric durations and easing values.
// Cache the four root tokens while measuring, never a descendant's override.
function installScopedRootMotionTokenCache() {
  const originalComputedStyle = window.getComputedStyle;
  const originalRead = CSSStyleDeclaration.prototype.getPropertyValue;
  const root = document.documentElement;
  const rootStyles = new WeakSet();
  const initialStyle = originalComputedStyle.call(window, root);
  rootStyles.add(initialStyle);
  const values = Object.fromEntries([
    "--ease-editor-crossfade", "--ease-ui-in-out", "--ease-ui-out", "--motion-scale",
  ].map(token => [token, originalRead.call(initialStyle, token)]));
  if (Object.values(values).some(value => !value.trim())) throw new Error("missing actual root motion token");
  const state = { kind: "scoped-root-motion-token-cache-not-acceptance", values, intercepted: {} };
  const computedStyle = function (element, ...args) {
    const style = originalComputedStyle.call(this, element, ...args);
    if (element === root && !args[0]) rootStyles.add(style);
    return style;
  };
  const read = function (name) {
    if (window.__advancedLayoutTransitionAudit?.running && rootStyles.has(this) && Object.hasOwn(values, name)) {
      state.intercepted[name] = (state.intercepted[name] ?? 0) + 1;
      return values[name];
    }
    return originalRead.call(this, name);
  };
  window.getComputedStyle = computedStyle;
  CSSStyleDeclaration.prototype.getPropertyValue = read;
  state.finish = () => {
    const currentStyle = originalComputedStyle.call(window, root);
    const current = Object.fromEntries(Object.keys(values).map(token => [token, originalRead.call(currentStyle, token)]));
    if (window.getComputedStyle === computedStyle) window.getComputedStyle = originalComputedStyle;
    if (CSSStyleDeclaration.prototype.getPropertyValue === read) CSSStyleDeclaration.prototype.getPropertyValue = originalRead;
    return { ...state, finish: undefined, current,
      stable: Object.keys(values).every(token => values[token] === current[token]) };
  };
  window.__e2ScopedMotionTokenCache = state;
  return { kind: state.kind, values };
}

// Test-only CSSOM adaptation. Reuse authored wide-workbench rules rather
// than guessing copied dimensions. Never target the live active page.
function installWarmDescendantStyleDiagnostic({ prepaint = false } = {}) {
  const root = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
  if (!(root instanceof HTMLElement)) throw new Error("warm layout root missing");
  const warmSelector = '.advanced-tab-content.is-warm[data-tab="layout"]';
  const prepaintSelector = `.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) ${warmSelector}`;
  const rules = [];
  const failures = [];
  const visit = list => {
    for (const rule of list) {
      if (rule instanceof CSSMediaRule) {
        if (matchMedia(rule.conditionText).matches) visit(rule.cssRules);
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) visit(rule.cssRules);
      } else if (rule instanceof CSSStyleRule) {
        if (!rule.selectorText.includes(".advanced-tools-panel.layout-mode")) continue;
        // CSSOM already parsed the authored selector. Discard selectors
        // addressing the viewport/scroll root rather than designer children.
        const adapted = rule.selectorText.split(/,(?![^(]*\))/)
          .map(selector => selector.trim())
          .filter(selector => selector.startsWith(".advanced-tools-panel.layout-mode ")
            && selector.includes(".runtime-layout-"))
          .map(selector => selector.replace(".advanced-tools-panel.layout-mode", warmSelector));
        if (adapted.length) rules.push(`${adapted.join(",")}{${rule.style.cssText}}`);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { visit(sheet.cssRules); }
    catch (error) { failures.push(String(error)); }
  }
  if (failures.length || rules.length < 20)
    throw new Error(`incomplete warm style source scan: ${rules.length} rules, ${failures.join("; ")}`);
  const style = document.createElement("style");
  style.dataset.e2WarmDescendantStyle = "diagnostic-only";
  style.textContent = rules.join("\n") + (prepaint ? `\n${prepaintSelector}{opacity:0.001!important}` : "");
  document.head.appendChild(style);
  return { kind: "hidden-descendant-wide-style-reuse-not-acceptance",
    ruleCount: rules.length, failures, selector: warmSelector,
    mediaBasis: { width: innerWidth, height: innerHeight }, activePageAffectedBySelector: false,
    fixedDuringDiagnostic: true, stylesheetCount: document.styleSheets.length, prepaint,
    hiddenOpacity: prepaint ? 0.001 : 0, prepaintSelector: prepaint ? prepaintSelector : null,
    ghostExcludedFromPrepaint: true };
}

module.exports = { installWarmDescendantStyleDiagnostic, getWarmDescendantStyleDiagnostic,
  getWarmDescendantPrepaintMode, getWarmDescendantReadAttribution, installScopedRootMotionTokenCache,
  instrumentWarmStartOpacitySource, pruneHiddenSnapshotLayers };
