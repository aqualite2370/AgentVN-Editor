"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { modes, transformOptionsModule, transformProductionStageRead, transformGlassInitialRead,
  transformProgressiveSections, transformDesignerGlassMount, transformDesignerStaticGlass,
  hasFullSizeContainment } = require("./lib/e2-first-options-probes.cjs");
const { transformHasBlurRules } = require("./lib/e2-first-options-probes.cjs");
const source = fs.readFileSync("editor/src/components/advanced/AdvancedToolsPanel.tsx", "utf8");
for (const mode of ["current", "prepatch-css", "canvas-blur-omitted", "warm-size-contained", "panel-layout-contained"]) {
  assert.deepEqual(transformOptionsModule(source, mode), { source, applied: 0 });
}
for (const mode of ["initial-layout-unmounted", "batch-preloads-omitted", "layout-after-entry"]) {
  const result = transformOptionsModule(source, mode);
  assert.equal(result.applied, 1);
  assert.notEqual(result.source, source);
  assert(result.source.includes('preloadAdvancedTab(nextTab)'),
    "actual requested destination loading remains intact");
  assert(result.source.includes('RuntimeLayoutDesigner sessionRef='),
    "actual layout component remains available");
  assert.throws(() => transformOptionsModule("", mode), /exactly once/);
  assert.throws(() => transformOptionsModule(source + source, mode), /exactly once/);
}
assert.throws(() => transformOptionsModule(source, "unknown"), /unsupported/);
const designer = fs.readFileSync("editor/src/components/advanced/RuntimeLayoutDesigner.tsx", "utf8");
const stageSeam = 'const initialRect = node.getBoundingClientRect();\n'
  + 'commitSize(initialRect.width, initialRect.height);\n'
  + 'if (typeof ResizeObserver !== "undefined") {\n'
  + 'commitSize(entry.contentRect.width, entry.contentRect.height);\nobserver.observe(node);\n}';
const deferred = transformOptionsModule(stageSeam, "stage-initial-read-omitted");
assert.equal(deferred.applied, 1);
assert(deferred.source.includes("observer.observe(node)"));
assert(deferred.source.includes("commitSize(entry.contentRect.width, entry.contentRect.height)"));
assert.throws(() => transformOptionsModule("", "stage-initial-read-omitted"), /exactly once/);
assert.throws(() => transformOptionsModule(stageSeam + stageSeam, "stage-initial-read-omitted"), /exactly once/);
assert.throws(() => transformOptionsModule(designer, "stage-initial-read-omitted"),
  /exactly once/, "fixed observer fallback must not masquerade as the old initial read");
assert.equal(modes.length, 20);
assert(modes.includes("warm-display-grid"));
assert.deepEqual(transformOptionsModule(source, "warm-display-grid"), { source, applied: 0 },
  "display counterfactual must not rewrite module code");
assert.deepEqual(transformOptionsModule(source, "layout-native-appearance-none"), { source, applied: 0 },
  "native appearance counterfactual must not rewrite module code");
assert.deepEqual(transformOptionsModule(source, "layout-explicit-cjk-fallback"), { source, applied: 0 },
  "font counterfactual must not rewrite module code");
assert.deepEqual(transformOptionsModule(source, "layout-columns-flex"), { source, applied: 0 },
  "column layout counterfactual must not rewrite module code");
assert.deepEqual(transformOptionsModule(source, "layout-designer-static-glass"), { source, applied: 0 },
  "static glass counterfactual is applied at the designer module seam");
assert.deepEqual(transformOptionsModule(source, "layout-section-omitted"), { source, applied: 0 },
  "section omission is applied through the explicit stylesheet diagnostic seam");
const readyPreview = transformOptionsModule(designer, "preview-after-stage-size");
assert.equal(readyPreview.applied, 1);
assert(readyPreview.source.includes("if (stageSize.width <= 0 || stageSize.height <= 0) return null;"));
assert(readyPreview.source.includes("onQuickMenuToggle={() => setQuickMenuPreviewExpanded"), "final preview functionality retained");
assert.throws(() => transformOptionsModule("", "preview-after-stage-size"), /exactly once/);
assert.throws(() => transformOptionsModule(designer + designer, "preview-after-stage-size"), /exactly once/);
// Vite has already lowered JSX before route fulfillment; this probe uses a
// stable function-body seam that survives that transformation.
assert.equal(transformOptionsModule(
  'function Preview({stageSize,assetManifest,packageAppearance}) { const titleBackground = assetPreviewUrl(assetManifest, packageAppearance.titleBackgroundAssetId); return jsxDEV("div", {}); }',
  "preview-after-stage-size").applied, 1);
const afterEntry = transformOptionsModule(source, "layout-after-entry").source;
assert(afterEntry.includes('new Set([...current, "layout"])'), "layout eventually mounts");
assert(afterEntry.includes("cancelAnimationFrame(frame)"), "unmount releases the wait");
assert(afterEntry.includes("animation.pending || animation.playState"), "only actual animation state gates mount");
const compiledSeam = 'const f=(w,h)=>commit(w,h),k=r.getBoundingClientRect();if(f(k.width,k.height),typeof ResizeObserver<"u"){observe(r)}';
assert.equal(transformProductionStageRead(compiledSeam).source,
  'const f=(w,h)=>commit(w,h);if(typeof ResizeObserver<"u"){observe(r)}');
assert.throws(() => transformProductionStageRead(""), /exactly once/);
assert.throws(() => transformProductionStageRead(compiledSeam + compiledSeam), /exactly once/);
const glass = fs.readFileSync("editor/node_modules/liquid-glass-react/dist/index.js", "utf8");
const observedGlass = transformGlassInitialRead(glass);
assert.equal(observedGlass.applied, 1);
assert(observedGlass.source.includes("observer.disconnect(); updateGlassSize();"));
assert(observedGlass.source.includes("else updateGlassSize();"), "no-observer fallback preserved");
assert(observedGlass.source.includes('window.removeEventListener("resize", updateGlassSize)'));
assert(observedGlass.source.includes("calculateElasticTranslation().x"), "render behavior retained");
const minifiedGlass = 'K.useEffect(()=>{const m=()=>{if(A.current){const U=A.current.getBoundingClientRect();b({width:U.width,height:U.height})}};return m(),window.addEventListener("resize",m),()=>window.removeEventListener("resize",m)},[])';
const productionGlass = transformGlassInitialRead(minifiedGlass, true);
assert.equal(productionGlass.applied, 1);
assert(productionGlass.source.includes('observer.observe(A.current)'));
assert(productionGlass.source.includes('b({width:U.width,height:U.height})'));
assert(productionGlass.source.includes('observer?.disconnect()'));
for (const [source, production] of [[glass, false], [minifiedGlass, true]]) {
  assert.throws(() => transformGlassInitialRead("", production), /exactly once/);
  assert.throws(() => transformGlassInitialRead(source + source, production), /exactly once/);
}
const ts = require("../editor/node_modules/typescript");
const servedDesigner = ts.transpileModule(designer, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSXDev, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText;
const sections = transformProgressiveSections(servedDesigner);
assert.equal(sections.applied, 1);
assert(sections.source.includes('e2PreparedStep >= 5 ?'));
assert(sections.source.includes('setE2PreparedStep(step => step + 1)'));
assert(sections.source.includes('cancelAnimationFrame(frame); clearTimeout(timer)'));
assert.equal(ts.createSourceFile("probe.js", sections.source, ts.ScriptTarget.Latest, true,
  ts.ScriptKind.JS).parseDiagnostics.length, 0, "transformed served JS must parse");
assert.throws(() => transformProgressiveSections(""), /one RuntimeLayoutDesigner/);
assert.throws(() => transformProgressiveSections(servedDesigner + servedDesigner), /one RuntimeLayoutDesigner/);
assert.throws(() => transformProgressiveSections(servedDesigner.replaceAll("runtime-layout-center", "missing-center")),
  /unique runtime-layout-center/);
const selection = fs.readFileSync("editor/src/components/common/GlassSelectionGroup.tsx", "utf8");
const servedSelection = ts.transpileModule(selection, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSXDev, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText;
const positiveGlass = transformDesignerGlassMount(servedSelection);
assert.equal(positiveGlass.applied, 1);
assert(positiveGlass.source.includes('className === "runtime-layout-sidebar"'));
assert(positiveGlass.source.includes('className?.startsWith("runtime-layout-zoom-switch")'));
assert(positiveGlass.source.includes('entry.contentRect.width > 0 && entry.contentRect.height > 0'));
assert(positiveGlass.source.includes('const [e2GlassReady, setE2GlassReady] = useState(!waitForSize)'));
assert.equal(ts.createSourceFile("probe.js", positiveGlass.source, ts.ScriptTarget.Latest, true,
  ts.ScriptKind.JS).parseDiagnostics.length, 0);
assert.throws(() => transformDesignerGlassMount(""), /all designer/);
assert.throws(() => transformDesignerGlassMount(servedSelection + servedSelection), /unique/);
const designerStaticGlass = transformDesignerStaticGlass(designer);
assert.equal(designerStaticGlass.applied, 2);
assert.equal((designerStaticGlass.source.match(/motion="light"/g) || []).length, 2);
assert.equal(ts.createSourceFile("probe.tsx", designerStaticGlass.source, ts.ScriptTarget.Latest, true,
  ts.ScriptKind.TSX).parseDiagnostics.length, 0);
assert.throws(() => transformDesignerStaticGlass("not valid <tsx"), /valid TSX/);
assert.throws(() => transformDesignerStaticGlass(""), /exactly twice/);
assert.throws(() => transformDesignerStaticGlass(designer + designer), /exactly twice/);
const productionDesigner = 'a.jsx(cs,{className:`runtime-layout-zoom-switch${ut?" is-placeholder":""}`,selectedKey:F,children:[]});'
  + 'a.jsxs(cs,{as:"aside",className:"runtime-layout-sidebar",selectedKey:M,children:[]});';
const productionStaticGlass = transformDesignerStaticGlass(productionDesigner, true);
assert.equal(productionStaticGlass.applied, 2);
assert(productionStaticGlass.source.includes('motion:"light"'));
assert.throws(() => transformDesignerStaticGlass("", true), /exactly once/);
assert.throws(() => transformDesignerStaticGlass(productionDesigner + productionDesigner, true), /exactly once/);
assert.equal(hasFullSizeContainment("strict"), true, "CSSOM normalizes size layout paint style to strict");
assert.equal(hasFullSizeContainment("size layout paint style"), true);
for (const value of [null, undefined, "", "content", "layout paint style", "inline-size layout"])
  assert.equal(hasFullSizeContainment(value), false);
const shellCss = fs.readFileSync("editor/src/styles/editor-shell.css", "utf8");
const noBlur = transformHasBlurRules(shellCss);
assert.equal(noBlur.applied, 2);
assert(!noBlur.source.includes("body:has(.toolbar-popover.workspace-task-panel"));
assert.throws(() => transformHasBlurRules(shellCss.replace("body:has(", "body:not(")), /match exactly/);
assert.throws(() => transformHasBlurRules(shellCss + shellCss), /match exactly/);
console.log("PASS: bounded diagnostic transforms, current passthrough, unsupported/missing/duplicate seams");
