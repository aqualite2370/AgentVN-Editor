const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const component = fs.readFileSync(
  path.join(root, "GameCli_framework", "src", "components", "shell", "SettingsScreen.tsx"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(root, "GameCli_framework", "src", "styles", "shell.css"),
  "utf8",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sliderCss = css.slice(css.indexOf(".settings-slider {"), css.indexOf(".settings-row:has(input[type=\"checkbox\"])"));

assert(component.includes('className="settings-slider-track"'), "slider must use a separate visible track");
assert(component.includes('className="settings-slider-fill"'), "slider must use a separate progress fill");
assert(component.includes("--range-label"), "slider must expose a transient value label");
assert(component.includes("onPointerDown"), "slider must respond at pointer down");
assert(component.includes("setPointerCapture"), "slider must retain direct manipulation outside its bounds");
assert(component.includes("onKeyDown"), "slider must expose keyboard adjustment feedback");
assert(!component.includes("onFocus={() => setIsInteracting(true)}"), "focus alone must not persist the value label");

assert(/--range-track-height:\s*clamp\(10px,[\s\S]*?12px\);/.test(sliderCss), "slider must use a fixed substantial capsule track");
assert(/height:\s*var\(--range-track-height\);/.test(sliderCss), "visible and native tracks must share the fixed track height");
assert(/--range-press-scale:\s*1\.22;/.test(sliderCss), "slider must define the deliberate hold scale");
assert(/--range-press-duration:\s*480ms;/.test(sliderCss), "hold enlargement must use the requested doubled duration");
assert(/--range-release-duration:\s*360ms;/.test(sliderCss), "release contraction must use the requested doubled duration");
assert(
  /\.settings-screen \.settings-slider:has\(input\[type="range"\]:not\(:disabled\):active\) \.settings-slider-track\s*\{[\s\S]*?scaleY\(var\(--range-press-scale\)\)[\s\S]*?transform var\(--range-press-duration\) var\(--ease-in-out\)/.test(css),
  "holding the slider must slowly enlarge only the capsule track",
);
assert(!/scaleY\(0\.43\)/.test(css), "slider must not return to the old compressed idle track");
assert(/width:\s*1px;[\s\S]*height:\s*1px;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/.test(sliderCss), "native thumb must be visually absent");
assert(/\.settings-slider\.is-interacting::after[\s\S]*opacity:\s*1;/.test(sliderCss), "value bubble must only appear during interaction");
assert(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.settings-slider:has\(input\[type="range"\]:not\(:disabled\):hover\)[\s\S]*opacity:\s*1;/.test(sliderCss), "hover must only strengthen the capsule paint");
assert(!/\.settings-slider:has\(input\[type="range"\]:not\(:disabled\):hover\)\s*\{/.test(sliderCss), "hover must not style the outer slider container");
assert(!/\.settings-slider:hover::before[\s\S]{0,200}(?:border|outline|box-shadow|transform):/.test(sliderCss), "hover must not add a rectangular frame or geometry change");
assert(
  /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.settings-screen \.settings-slider::after\s*\{[\s\S]*?transform:\s*none\s*!important;/.test(css),
  "slider must provide a late reduced-motion override that removes bubble movement",
);
assert(
  /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.settings-screen \.settings-slider-track\s*\{[\s\S]*?transform:\s*translateY\(-50%\)\s*!important;/.test(css),
  "reduced motion must suppress the hold enlargement",
);
assert(!/transition:\s*all/.test(sliderCss), "slider must not animate all properties");
assert(!/ease-in(?!-out)/.test(sliderCss), "slider must not use ease-in");

assert(
  /\.settings-screen \.settings-row:has\(\.settings-slider\) > output\s*\{\s*display:\s*none;/m.test(css),
  "persistent slider output must be hidden",
);
assert(!css.includes("--range-thumb-border"), "obsolete visible thumb styling must be removed");
assert(
  /\.settings-screen \.settings-slider:has\(input\[type="range"\]:focus-visible\)\s*\{\s*outline:\s*none;[\s\S]*?\.settings-slider-track\s*\{[\s\S]*?0 0 0 2px/m.test(css),
  "keyboard focus must render on the capsule track instead of the outer input box",
);

console.log("ios volume slider contract: PASS");
