"use strict";
const assert = require("node:assert/strict");

// Diagnostic counterfactuals only; never written into product source/builds.
const modes = ["current", "prepatch-css", "initial-layout-unmounted",
  "batch-preloads-omitted", "canvas-blur-omitted", "stage-initial-read-omitted", "layout-after-entry",
  "glass-initial-read-observed", "preview-after-stage-size", "layout-progressive-sections",
  "designer-glass-after-positive-size", "warm-size-contained", "warm-display-grid", "panel-layout-contained",
  "has-blur-rules-omitted", "layout-native-appearance-none", "layout-explicit-cjk-fallback",
  "layout-columns-flex", "layout-designer-static-glass", "layout-section-omitted"];
const entryWarmEffect = `
  useEffect(() => {
    let cancelled = false, frame;
    const prepare = () => {
      if (cancelled) return;
      const root = document.querySelector(".advanced-tools-panel");
      const panel = root?.closest(".toolbar-popover");
      if (!root || !panel || [...root.getAnimations(), ...panel.getAnimations()]
        .some(animation => animation.pending || animation.playState === "running")) {
        frame = requestAnimationFrame(prepare);
        return;
      }
      setMountedTabs(current => new Set([...current, "layout"]));
    };
    frame = requestAnimationFrame(prepare);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, []);
`;
function transformOptionsModule(source, mode) {
  assert(modes.includes(mode), `unsupported Options diagnostic: ${mode}`);
  let expression, replacement;
  if (mode === "initial-layout-unmounted" || mode === "layout-after-entry") {
    expression = /new Set\(\["settings",\s*"layout"\]\)/g;
    replacement = 'new Set(["settings"])';
  } else if (mode === "batch-preloads-omitted") {
    expression = /for \(const tab of visibleAdvancedTabs\)/g;
    replacement = "for (const tab of [])";
  } else if (mode === "stage-initial-read-omitted") {
    expression = /const initialRect = node\.getBoundingClientRect\(\);\s*commitSize\(initialRect\.width, initialRect\.height\);(?=\s*if \(typeof ResizeObserver !== "undefined"\))/g;
    replacement = "// Diagnostic: first size supplied only by the existing ResizeObserver.";
  } else if (mode === "preview-after-stage-size") {
    expression = /const titleBackground = assetPreviewUrl\(assetManifest, packageAppearance\.titleBackgroundAssetId\);/g;
    replacement = original => `if (stageSize.width <= 0 || stageSize.height <= 0) return null;\n  ${original}`;
  } else return { source, applied: 0 };
  const matches = [...source.matchAll(expression)];
  assert.equal(matches.length, 1, "diagnostic seam must match exactly once");
  let output = source.replace(expression, replacement);
  if (mode === "layout-after-entry") {
    const seam = /useEffect\(\(\) => \{\s*activeTabRef\.current = activeTab;\s*\}, \[activeTab\]\);/g;
    assert.equal([...output.matchAll(seam)].length, 1, "entry wait seam must match exactly once");
    output = output.replace(seam, original => original + entryWarmEffect);
  }
  return { source: output, applied: 1 };
}
function transformProductionStageRead(source) {
  const expression = /,([A-Za-z_$]\w*)=([A-Za-z_$]\w*)\.getBoundingClientRect\(\);if\(([A-Za-z_$]\w*)\(\1\.width,\1\.height\),typeof ResizeObserver<"u"\)/g;
  assert.equal([...source.matchAll(expression)].length, 1,
    "production stage read seam must match exactly once");
  return { source: source.replace(expression, ';if(typeof ResizeObserver<"u")'), applied: 1 };
}
function transformGlassInitialRead(source, production = false) {
  // Change timing of this one mount measurement, not glass visuals or geometry.
  // Keep the exact resize callback, including its transformed border-box read.
  const expression = production
    ? /([A-Za-z_$]\w*)\.useEffect\(\(\)=>\{const ([A-Za-z_$]\w*)=\(\)=>\{if\(([A-Za-z_$]\w*)\.current\)\{const ([A-Za-z_$]\w*)=\3\.current\.getBoundingClientRect\(\);([A-Za-z_$]\w*)\(\{width:\4\.width,height:\4\.height\}\)\}\};return \2\(\),window\.addEventListener\("resize",\2\),\(\)=>window\.removeEventListener\("resize",\2\)\},\[\]\)/g
    : /updateGlassSize\(\);\s*window\.addEventListener\("resize", updateGlassSize\);\s*return \(\) => window\.removeEventListener\("resize", updateGlassSize\);/g;
  assert.equal([...source.matchAll(expression)].length, 1,
    "glass mount measurement seam must match exactly once");
  const output = source.replace(expression, (original, hooks, update, glassRef, rect, setter) => {
    if (production) return `${hooks}.useEffect(()=>{const ${update}=()=>{if(${glassRef}.current){const ${rect}=${glassRef}.current.getBoundingClientRect();${setter}({width:${rect}.width,height:${rect}.height})}};let observer;`
      + `if(typeof ResizeObserver==="function"&&${glassRef}.current){observer=new ResizeObserver(()=>{observer.disconnect();${update}()});observer.observe(${glassRef}.current)}else ${update}();`
      + `window.addEventListener("resize",${update});return()=>{observer?.disconnect();window.removeEventListener("resize",${update})}},[])`;
    return `let observer;
    if (typeof ResizeObserver === "function" && glassRef.current) {
      observer = new ResizeObserver(() => { observer.disconnect(); updateGlassSize(); });
      observer.observe(glassRef.current);
    } else updateGlassSize();
    window.addEventListener("resize", updateGlassSize);
    return () => { observer?.disconnect(); window.removeEventListener("resize", updateGlassSize); };`;
  });
  return { source: output, applied: 1 };
}
function transformProgressiveSections(source) {
  // Served Vite JS only. Preserve each entire subtree and existing props.
  const ts = require("../../editor/node_modules/typescript");
  const file = ts.createSourceFile("diagnostic.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0, "progressive probe requires valid served JS");
  const functions = [];
  const find = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "RuntimeLayoutDesigner") functions.push(node);
    ts.forEachChild(node, find);
  };
  find(file);
  assert.equal(functions.length, 1, "one RuntimeLayoutDesigner function required");
  const body = functions[0].body, edits = [], counts = new Map();
  const sections = new Map([["runtime-layout-header", 1], ["runtime-layout-toolbar", 2],
    ["runtime-layout-sidebar", 3], ["runtime-layout-center", 4], ["runtime-layout-inspector", 5]]);
  let ready = 0;
  const visit = node => {
    if (ts.isCallExpression(node) && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
      const props = node.arguments[1].properties;
      const className = props.find(prop => ts.isPropertyAssignment(prop)
        && prop.name.getText(file).replaceAll('"', "").replaceAll("'", "") === "className");
      const name = className && ts.isStringLiteral(className.initializer) ? className.initializer.text : null;
      if (sections.has(name)) {
        counts.set(name, (counts.get(name) || 0) + 1);
        edits.push({ start: node.getStart(file), end: node.getEnd(),
          text: `(e2PreparedStep >= ${sections.get(name)} ? ${node.getText(file)} : null)` });
      }
      const readiness = props.find(prop => ts.isPropertyAssignment(prop)
        && prop.name.getText(file) === '"data-advanced-tab-ready"');
      if (readiness) {
        ready++;
        edits.push({ start: readiness.initializer.getStart(file), end: readiness.initializer.getEnd(),
          text: `(e2PreparedStep >= 5 ? ${readiness.initializer.getText(file)} : "false")` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  for (const name of sections.keys()) assert.equal(counts.get(name), 1, `unique ${name} subtree required`);
  assert.equal(ready, 1, "unique final readiness boundary required");
  edits.push({ start: body.getStart(file) + 1, end: body.getStart(file) + 1, text: `
  const [e2PreparedStep, setE2PreparedStep] = useState(1);
  useEffect(() => {
    if (e2PreparedStep >= 5) return;
    let timer;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setE2PreparedStep(step => step + 1), 0);
    });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [e2PreparedStep]);
` });
  // Nested replacements would silently discard a child edit; reject them.
  edits.sort((a, b) => b.start - a.start);
  for (let i = 1; i < edits.length; i++) assert(edits[i].end <= edits[i - 1].start,
    "progressive probe edits must not overlap");
  let output = source;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return { source: output, applied: 1 };
}
function transformDesignerGlassMount(source) {
  const ts = require("../../editor/node_modules/typescript");
  const file = ts.createSourceFile("glass-probe.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0);
  let adapter, glassCall, wrapper, adapterCall;
  const unique = (previous, next, label) => { assert(!previous, `unique ${label} required`); return next; };
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "LiquidGlassAdapter")
      adapter = unique(adapter, node, "adapter");
    if (ts.isCallExpression(node) && node.arguments[0]?.getText(file) === "LiquidGlass")
      glassCall = unique(glassCall, node, "LiquidGlass call");
    if (ts.isCallExpression(node) && node.arguments[0]?.getText(file) === "LiquidGlassAdapter")
      adapterCall = unique(adapterCall, node, "adapter call");
    if (ts.isCallExpression(node) && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])
      && node.arguments[1].properties.some(prop => ts.isPropertyAssignment(prop)
        && prop.name.getText(file) === "className"
        && ts.isStringLiteral(prop.initializer) && prop.initializer.text === "liquid-glass-adapter"))
      wrapper = unique(wrapper, node.arguments[1], "wrapper");
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert(adapter && glassCall && wrapper && adapterCall, "all designer glass mount seams required");
  assert(ts.isObjectBindingPattern(adapter.parameters[0].name)
    && ts.isObjectLiteralExpression(adapterCall.arguments[1]), "adapter prop objects required");
  const binding = adapter.parameters[0].name, props = adapterCall.arguments[1], body = adapter.body;
  const appendMember = (node, member) => ({
    start: node.getEnd() - 1, end: node.getEnd() - 1,
    text: `${source.slice(node.getStart(file), node.getEnd() - 1).trimEnd().endsWith(",") ? "" : ","} ${member}`,
  });
  const edits = [
    appendMember(binding, "waitForSize"),
    appendMember(wrapper, "ref: e2GlassMountRef"),
    appendMember(props, 'waitForSize: className === "runtime-layout-sidebar" || className?.startsWith("runtime-layout-zoom-switch")'),
    { start: glassCall.getStart(file), end: glassCall.getEnd(),
      text: `(e2GlassReady ? ${glassCall.getText(file)} : null)` },
    { start: body.getStart(file) + 1, end: body.getStart(file) + 1, text: `
  const e2GlassMountRef = useRef(null);
  const [e2GlassReady, setE2GlassReady] = useState(!waitForSize);
  useEffect(() => {
    if (!waitForSize || e2GlassReady) return;
    if (typeof ResizeObserver !== "function") { setE2GlassReady(true); return; }
    const node = e2GlassMountRef.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => {
      if (entries.some(entry => entry.contentRect.width > 0 && entry.contentRect.height > 0)) {
        observer.disconnect(); setE2GlassReady(true);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [waitForSize, e2GlassReady]);
` },
  ].sort((a, b) => b.start - a.start);
  for (let i = 1; i < edits.length; i++) assert(edits[i].end <= edits[i - 1].start);
  let output = source;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return { source: output, applied: 1 };
}

function transformDesignerStaticGlass(source, production = false) {
  if (production) {
    const zoomExpression = /a\.jsx\(cs,\{className:`runtime-layout-zoom-switch\$\{ut\?" is-placeholder":""\}`,selectedKey:/g;
    const sidebarExpression = /a\.jsxs\(cs,\{as:"aside",className:"runtime-layout-sidebar",selectedKey:/g;
    const zoomMatches = [...source.matchAll(zoomExpression)];
    const sidebarMatches = [...source.matchAll(sidebarExpression)];
    assert.equal(zoomMatches.length, 1, "production zoom glass seam must match exactly once");
    assert.equal(sidebarMatches.length, 1, "production sidebar glass seam must match exactly once");
    return {
      source: source
        .replace(zoomExpression, 'a.jsx(cs,{className:`runtime-layout-zoom-switch${ut?" is-placeholder":""}`,motion:"light",selectedKey:')
        .replace(sidebarExpression, 'a.jsxs(cs,{as:"aside",className:"runtime-layout-sidebar",motion:"light",selectedKey:'),
      applied: 2,
    };
  }

  const ts = require("../../editor/node_modules/typescript");
  const file = ts.createSourceFile("runtime-layout-designer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(file.parseDiagnostics.length, 0, "static glass probe requires valid TSX");
  const edits = [];
  let targeted = 0;
  const visit = node => {
    const openingElement = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : undefined;
    if (openingElement) {
      const tagName = openingElement.tagName.getText(file);
      if (tagName === "GlassSelectionGroup") {
        const className = openingElement.attributes.properties.find(attribute => (
          ts.isJsxAttribute(attribute)
          && attribute.name.text === "className"
          && /runtime-layout-(?:zoom-switch|sidebar)/.test(attribute.initializer?.getText(file) ?? "")
        ));
        if (className) {
          targeted += 1;
          const hasMotion = openingElement.attributes.properties.some(attribute => (
            ts.isJsxAttribute(attribute) && attribute.name.text === "motion"
          ));
          assert(!hasMotion, "targeted designer glass group already has an explicit motion prop");
          const close = openingElement.end - (ts.isJsxSelfClosingElement(node) ? 2 : 1);
          edits.push({ start: close, end: close, text: ' motion="light"' });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(targeted, 2, "source designer glass groups must match exactly twice");
  let output = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return { source: output, applied: targeted };
}
function hasFullSizeContainment(value) {
  return typeof value === "string" && (value === "strict" || value.split(/\s+/).includes("size"));
}
function transformHasBlurRules(source) {
  const rule = /body:has\(\.toolbar-popover\.workspace-task-panel:not\(\.cartridge\):not\(\.toolbar-popover-morph-ghost\)\.(?:is-open|is-closing)\)\s*\.editor-workspace-body\s+\.editor-workspace\s*>\s*\.flow-surface\s*\{[^{}]*\}/g;
  const matches = [...source.matchAll(rule)];
  assert.equal(matches.length, 2, "both workspace blur :has rules must match exactly");
  const output = source.replace(rule, "");
  assert(!output.includes("body:has(.toolbar-popover.workspace-task-panel"),
    "blur :has rules must be absent from diagnostic stylesheet");
  return { source: output, applied: matches.length };
}
module.exports = { modes, transformOptionsModule, transformProductionStageRead, transformGlassInitialRead,
  transformProgressiveSections, transformDesignerGlassMount, transformDesignerStaticGlass,
  hasFullSizeContainment, transformHasBlurRules };
