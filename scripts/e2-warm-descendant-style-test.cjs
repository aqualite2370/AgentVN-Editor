"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { installWarmDescendantStyleDiagnostic, getWarmDescendantStyleDiagnostic, getWarmDescendantPrepaintMode,
  getWarmDescendantReadAttribution, installScopedRootMotionTokenCache, instrumentWarmStartOpacitySource } =
  require("./lib/e2-warm-descendant-style.cjs");
const scope = {
  diagnosticOnly: true, isolated: true, headful: true, hardwareGpu: true,
  cold: true, currentSource: true, viewport: "4k", dpr: 1, repeats: 1,
  injection: false, profiling: false, reducedMotion: false, target: "layout", singleTrial: true,
  otherInterventions: false,
};
assert.equal(getWarmDescendantStyleDiagnostic(false).enabled, false);
assert.equal(getWarmDescendantPrepaintMode(undefined, false), "style-only");
assert.equal(getWarmDescendantPrepaintMode("style-opacity", true), "style-opacity");
assert.throws(() => getWarmDescendantPrepaintMode("style-opacity", false));
assert.throws(() => getWarmDescendantPrepaintMode("0.0005", true));
const readScope = { warmStyleEnabled: true, prepaintMode: "style-opacity", slowDomReads: true };
assert.equal(getWarmDescendantReadAttribution(undefined, {}).enabled, false);
assert.throws(() => getWarmDescendantReadAttribution(undefined, readScope), /explicit attribution/);
assert.equal(getWarmDescendantReadAttribution("slow-dom-read", readScope).enabled, true);
assert.equal(getWarmDescendantReadAttribution("slow-dom-read", readScope).performanceAcceptance, false);
for (const invalid of [
  { ...readScope, warmStyleEnabled: false },
  { ...readScope, prepaintMode: "style-only" },
  { ...readScope, slowDomReads: false },
]) assert.throws(() => getWarmDescendantReadAttribution("slow-dom-read", invalid));
assert.throws(() => getWarmDescendantReadAttribution("trace", readScope));
assert.equal(getWarmDescendantReadAttribution("root-token-cache",
  { ...readScope, slowDomReads: false }).enabled, true);
assert.throws(() => getWarmDescendantReadAttribution("root-token-cache", readScope));
assert.throws(() => getWarmDescendantReadAttribution("root-token-cache",
  { ...readScope, slowDomReads: false, prepaintMode: "style-only" }));
assert.equal(getWarmDescendantReadAttribution("cached-slow-dom-read", readScope).enabled, true);
assert.throws(() => getWarmDescendantReadAttribution("cached-slow-dom-read",
  { ...readScope, slowDomReads: false }));
assert.equal(getWarmDescendantReadAttribution("cache-pruned-snapshot",
  { ...readScope, slowDomReads: false, pruneHiddenSnapshot: true }).enabled, true);
assert.throws(() => getWarmDescendantReadAttribution("cache-pruned-snapshot",
  { ...readScope, slowDomReads: false }));
assert.throws(() => getWarmDescendantReadAttribution("root-token-cache",
  { ...readScope, slowDomReads: false, pruneHiddenSnapshot: true }));
assert.equal(getWarmDescendantReadAttribution("cache-pruned-zero-warm-start",
  { ...readScope, slowDomReads: false, pruneHiddenSnapshot: true }).enabled, true);
assert.equal(getWarmDescendantReadAttribution("cache-pruned-inspector-zero-warm-start",
  { ...readScope, slowDomReads: false, pruneHiddenSnapshot: true }).enabled, true);
assert.throws(() => getWarmDescendantReadAttribution("cache-pruned-inspector-zero-warm-start",
  { ...readScope, slowDomReads: false, pruneHiddenSnapshot: false }));
const opacitySource = 'const nextOpacity = nextNodeBeforeSwitch && !nextNodeBeforeSwitch.hidden ? readActualOpacity() : 0;';
const opacityPatch = instrumentWarmStartOpacitySource(opacitySource);
assert(opacityPatch.source.includes('!nextNodeBeforeSwitch.classList.contains("is-warm")'));
assert.throws(() => instrumentWarmStartOpacitySource("unrecognized module"));
assert.throws(() => instrumentWarmStartOpacitySource(opacitySource + opacitySource));
for (const [isWarm, hidden, expected, reads] of [
  [true, false, 0, 0], [false, false, 0.42, 1], [false, true, 0, 0],
]) {
  let opacityReads = 0;
  const value = vm.runInNewContext(`${opacityPatch.source}\nnextOpacity;`, {
    nextNodeBeforeSwitch: { hidden, classList: { contains: () => isWarm } },
    readActualOpacity: () => { opacityReads++; return 0.42; },
  });
  assert.equal(value, expected, "warm-only correction preserves actual opacity for visible/reversing pages");
  assert.equal(opacityReads, reads);
}
assert.equal(getWarmDescendantStyleDiagnostic(true, scope).enabled, true);
for (const [key, value] of Object.entries({
  diagnosticOnly: false, isolated: false, headful: false, hardwareGpu: false,
  cold: false, currentSource: false, viewport: "1080p", dpr: 2,
  repeats: 3, profiling: true, reducedMotion: true, target: "theme",
  singleTrial: false, otherInterventions: true,
})) assert.throws(() => getWarmDescendantStyleDiagnostic(true, { ...scope, [key]: value }), key);
class Node {}
class StyleRule {
  constructor(selectorText) { this.selectorText = selectorText; this.style = { cssText: "padding: 8px;" }; }
}
class MediaRule { constructor(conditionText, cssRules) { Object.assign(this, { conditionText, cssRules }); } }
class SupportsRule { constructor(conditionText, cssRules) { Object.assign(this, { conditionText, cssRules }); } }
const authored = Array.from({ length: 21 }, (_, index) =>
  new StyleRule(`.advanced-tools-panel.layout-mode .runtime-layout-header button.item-${index}`));
const styles = [];
const context = {
  HTMLElement: Node, CSSStyleRule: StyleRule, CSSMediaRule: MediaRule, CSSSupportsRule: SupportsRule,
  CSS: { supports: value => value === "valid" }, matchMedia: query => ({ matches: query === "wide" }),
  innerWidth: 3840, innerHeight: 2160,
  document: {
    querySelector: () => new Node(),
    styleSheets: [{ cssRules: [
      ...authored,
      new StyleRule(".advanced-tools-panel.layout-mode .advanced-tab-viewport"),
      new StyleRule(".advanced-tools-panel.layout-mode .advanced-tab-scroll"),
      new StyleRule(".advanced-tools-panel .runtime-layout-header"),
      new MediaRule("narrow", [new StyleRule(".advanced-tools-panel.layout-mode .runtime-layout-header .excluded")]),
      new MediaRule("wide", [new StyleRule(".advanced-tools-panel.layout-mode .runtime-layout-header .included")]),
      new SupportsRule("invalid", [new StyleRule(".advanced-tools-panel.layout-mode .runtime-layout-header .unsupported")]),
    ] }],
    createElement: () => ({ dataset: {}, textContent: "" }),
    head: { appendChild: node => styles.push(node) },
  },
};
vm.createContext(context);
const run = () => vm.runInContext(`(${installWarmDescendantStyleDiagnostic.toString()})()`, context);
const evidence = run();
assert.equal(evidence.ruleCount, 22);
assert(styles[0].textContent.includes('.advanced-tab-content.is-warm[data-tab="layout"]'));
assert(styles[0].textContent.includes(".included"));
assert(!/excluded|unsupported|advanced-tab-viewport|advanced-tab-scroll|advanced-tools-panel/.test(styles[0].textContent));
vm.runInContext(`(${installWarmDescendantStyleDiagnostic.toString()})({prepaint: true})`, context);
assert(styles[1].textContent.includes('opacity:0.001!important'));
assert(styles[1].textContent.includes('.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)'));
context.document.styleSheets = [{ cssRules: [] }];
assert.throws(run, /incomplete warm style source scan/);
context.document.querySelector = () => null;
assert.throws(run, /warm layout root missing/);

// Root tokens only; descendants and reads outside the measured window stay native.
class Declaration {
  constructor(values) { this.values = values; this.reads = 0; }
  getPropertyValue(name) { this.reads++; return this.values[name] ?? ""; }
}
const rootElement = {};
const tokens = { "--ease-editor-crossfade": "ease-out", "--ease-ui-in-out": "ease-in-out",
  "--ease-ui-out": "ease-out", "--motion-scale": "1" };
const rootDeclaration = new Declaration({ ...tokens });
const childDeclaration = new Declaration({ ...tokens, "--motion-scale": "2" });
const originalRead = Declaration.prototype.getPropertyValue;
const tokenContext = {
  document: { documentElement: rootElement }, CSSStyleDeclaration: Declaration, WeakSet,
  window: { getComputedStyle: element => element === rootElement ? rootDeclaration : childDeclaration,
    __advancedLayoutTransitionAudit: { running: false } },
};
vm.createContext(tokenContext);
const cache = vm.runInContext(`(${installScopedRootMotionTokenCache.toString()})()`, tokenContext);
assert.deepEqual({ ...cache.values }, tokens);
tokenContext.window.__advancedLayoutTransitionAudit.running = true;
const beforeReads = rootDeclaration.reads;
const rootStyle = tokenContext.window.getComputedStyle(rootElement);
assert.equal(rootStyle.getPropertyValue("--motion-scale"), "1");
assert.equal(rootDeclaration.reads, beforeReads, "cached root read must not flush native computed style");
assert.equal(tokenContext.window.getComputedStyle({}).getPropertyValue("--motion-scale"), "2");
rootStyle.getPropertyValue("color");
assert.equal(rootDeclaration.reads, beforeReads + 1, "uncached property stays native");
tokenContext.window.__advancedLayoutTransitionAudit.running = false;
rootDeclaration.values["--motion-scale"] = "3";
assert.equal(rootStyle.getPropertyValue("--motion-scale"), "3", "outside measurement reads stay live");
const cacheResult = tokenContext.window.__e2ScopedMotionTokenCache.finish();
assert.equal(cacheResult.stable, false, "changed token invalidates attribution");
assert.equal(cacheResult.intercepted["--motion-scale"], 1);
assert.equal(Declaration.prototype.getPropertyValue, originalRead, "probe restores original property method");
console.log("PASS scoped warm descendant style adaptation and incomplete-scan rejection");
