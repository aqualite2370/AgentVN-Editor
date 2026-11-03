const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const editorSourceRoot = path.join(root, "editor", "src");
const componentPath = path.join(editorSourceRoot, "components", "common", "GlassSelectionGroup.tsx");
const toolbarPath = path.join(editorSourceRoot, "components", "editor", "EditorToolbar.tsx");
const layoutPath = path.join(editorSourceRoot, "styles", "layout.css");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(entryPath);
    return entryPath.endsWith(".tsx") ? [entryPath] : [];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const componentSource = read(componentPath);
const toolbarSource = read(toolbarPath);
const layoutSource = read(layoutPath);
const tsxSources = walk(editorSourceRoot).map((filePath) => ({
  filePath,
  source: read(filePath),
}));
const callTags = tsxSources.flatMap(({ filePath, source }) => (
  Array.from(source.matchAll(/<GlassSelectionGroup\b[\s\S]*?>/g), (match) => ({
    filePath,
    tag: match[0],
  }))
));

assert(callTags.length === 25, `Expected 25 GlassSelectionGroup instances, found ${callTags.length}`);
for (const { filePath, tag } of callTags) {
  assert(tag.includes("selectedKey="), `GlassSelectionGroup is missing selectedKey in ${path.relative(root, filePath)}`);
}

const componentContracts = [
  ["spring response", "const springResponseSeconds = 0.34"],
  ["spring damping ratio", "const springDampingRatio = 0.72"],
  ["maximum stretch", "const maximumStretch = 0.18"],
  ["maximum squash", "const maximumSquash = 0.08"],
  ["prominent material mode", 'mode="prominent"'],
  ["displacement strength", "displacementScale={64}"],
  ["blur amount", "blurAmount={0.1}"],
  ["saturation", "saturation={150}"],
  ["chromatic aberration", "aberrationIntensity={1.8}"],
  ["material elasticity", "elasticity={0.35}"],
  ["mouse tracking", "mouseContainer={mouseContainer}"],
  ["independent scroll viewport", "className={`glass-selection-viewport"],
  ["viewport class passthrough", "viewportClassName?: string;"],
  ["viewport style passthrough", "viewportStyle?: CSSProperties;"],
  ["presentation-only wrapper", 'className="glass-selection-track" role="presentation"'],
  ["motion reason classification", 'type GlassMotionReason = "selection" | "press" | "scroll" | "layout" | "visibility"'],
  ["selection-only spring", 'reason !== "selection"'],
  ["container resize observation", 'new ResizeObserver(() => measure("layout"))'],
  ["content mutation observation", "new MutationObserver((records) =>"],
  ["motion style mutation isolation", "const motionNodes = new Set<HTMLElement>()"],
  ["disabled selection handling", 'selected.matches(":disabled, [aria-disabled=\'true\']")'],
  ["ancestor layout transition following", 'root.closest(\'[data-layout-transitioning="true"]\')'],
  ["deferred resize state", 'indicator.dataset.glassState = "deferred"'],
  ["in-place formation state", 'indicator.dataset.glassState = reducedMotionRef.current ? "settled" : "forming"'],
  ["double frame geometry confirmation", 'deferredFrameRef.current = window.requestAnimationFrame(() =>'],
  ["independent material transform layer", 'className="glass-selection-material"'],
  ["independent press transform layer", 'className="glass-selection-press"'],
  ["single rim formation layer", 'className="glass-selection-rim"'],
  ["lightweight material adapter", "function StaticGlassAdapter"],
  ["lightweight material branch", "motion === \"light\" ?"],
  ["lightweight observer isolation", "const observeContinuously = motion === \"full\""],
];

for (const [label, token] of componentContracts) {
  assert(componentSource.includes(token), `GlassSelectionGroup contract missing ${label}`);
}
assert(!componentSource.includes("clipPath"), "GlassSelectionGroup must not derive the indicator from a container clip-path");
assert(!componentSource.includes("playLandingFlash"), "Glass landing flash must stay removed");
assert(componentSource.includes('record.attributeName !== "style"'), "Glass mutation observer must ignore its own motion-layer style writes");
assert(
  !/motion === "light"[\s\S]{0,280}<LiquidGlass\b/.test(componentSource),
  "Lightweight navigation material must not mount liquid-glass-react",
);
assert(
  toolbarSource.includes('motion="light"') && toolbarSource.includes('className="workspace-surface-nav"'),
  "Workspace task navigation must use the lightweight glass material",
);

const cssContracts = [
  ["visible root overflow", /overflow:\s*visible\s*!important/],
  ["horizontal viewport scrolling", /overflow-x:\s*auto/],
  ["viewport vertical clipping isolation", /overflow-y:\s*hidden/],
  ["exterior drop shadow", "drop-shadow(0 6px 8px"],
  ["selected press feedback", /transform:\s*scale\(\.94\)/],
  ["smooth glass button hover", /\.glass-selection-group button\s*\{[\s\S]*transition:/],
  ["fine pointer hover gating", /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/],
  ["deferred glass hidden", /\.glass-selection-indicator\[data-glass-state=.?deferred.?\]/],
  ["subtle projected light", /0 6px 14px/],
  ["material transform ownership", /\.glass-selection-material\s*\{/],
  ["press transform ownership", /\.glass-selection-press\s*\{/],
  ["rounded material and press layers", /\.glass-selection-material,\s*\.glass-selection-press\{[^}]*border-radius:inherit/],
  ["material pseudo overlays disabled", /\.glass-selection-material:before,.glass-selection-material:after\{content:none/],
  ["edge-only glass mask", /mask-composite:exclude/],
  ["advanced tab frame reset", /\.advanced-tools-panel>nav\.glass-selection-group,.advanced-tools-panel\.layout-mode>nav\.glass-selection-group\{/],
  ["horizontal hover safety space", /padding-block:8px;margin-block:0/],
  ["reduced motion", /@media\(prefers-reduced-motion:reduce\)/],
  ["reduced transparency", /@media\(prefers-reduced-transparency:reduce\)/],
  ["increased contrast", /@media\(prefers-contrast:more\)/],
  ["820px preview container query", /@container embedded-preview\s*\(max-width:\s*820px\)/],
  ["520px preview container query", /@container embedded-preview\s*\(max-width:\s*520px\)/],
];

for (const [label, token] of cssContracts) {
  assert(typeof token === "string" ? layoutSource.includes(token) : token.test(layoutSource), `Glass selection CSS contract missing ${label}`);
}

assert(!layoutSource.includes(".advanced-tab-viewport.is-morphing"), "Legacy advanced tab scale morph must stay removed");
assert(
  fs.readFileSync(path.join(root, "editor/src/styles/editor-topbar.css"), "utf8")
    .includes(".toolbar-popover.is-morphing {\n  transform-origin: top left;\n  will-change: transform, opacity;\n}"),
  "Container FLIP morph should be isolated to a compositor layer with a stable origin",
);
assert(toolbarSource.includes("scaleX"), "Advanced width transition must use compositor FLIP scaleX");
assert(/cubic-bezier\([^)]*\)/.test(toolbarSource), "Advanced width transition must use an explicit easing curve");
assert(!toolbarSource.includes("node.style.width = `${targetRect.width}px`"), "Advanced width transition must not animate layout width");
assert(toolbarSource.includes("const nextRect = node.getBoundingClientRect()"), "Advanced width transition must measure the rendered target once before compositor animation");
assert(!toolbarSource.includes("node.getAnimations()"), "Advanced width transition must cancel only its tracked animation, not synchronously enumerate browser animations");
assert(!toolbarSource.includes("const targetRect = node.getBoundingClientRect()"), "Advanced width transition must not force a second target layout read");
assert(
  /\.glass-selection-indicator\s*\{[^}]*filter:\s*[\s\S]*drop-shadow\(/s.test(layoutSource),
  "Glass selection indicator must keep an exterior depth shadow",
);

console.log(JSON.stringify({
  ok: true,
  instances: callTags.length,
  files: new Set(callTags.map(({ filePath }) => filePath)).size,
  scrollableInstances: callTags.filter(({ tag }) => tag.includes("scrollAxis=")).length,
}, null, 2));
