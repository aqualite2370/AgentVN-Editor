const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const richSelectPath = path.join(root, "editor", "src", "components", "common", "RichSelect.tsx");
const source = fs.readFileSync(richSelectPath, "utf8");
const failures = [];

if (!/interface RichSelectPosition \{[\s\S]*top\?: number;[\s\S]*bottom\?: number;/.test(source)) {
  failures.push("RichSelectPosition must support optional top and bottom anchors.");
}
if (!/const top = placement === "bottom" \? rect\.bottom \+ gap : undefined;/.test(source)) {
  failures.push("Bottom placement must anchor to trigger.bottom.");
}
if (!/const bottom = placement === "top" \? window\.innerHeight - rect\.top \+ gap : undefined;/.test(source)) {
  failures.push("Top placement must anchor with viewport bottom distance.");
}
if (/rect\.top - maxHeight - gap/.test(source)) {
  failures.push("Top placement must not derive its anchor from maxHeight.");
}
if (!/data-glass-selected=\{isSelected\}/.test(source)) {
  failures.push("RichSelect options must expose the shared glass selection state.");
}
if (!/data-glass-active=\{isActive\}/.test(source)) {
  failures.push("RichSelect options must expose the active keyboard navigation state.");
}
if (!/viewportClassName="rich-select-viewport selection-scroll-region"/.test(source)) {
  failures.push("RichSelect must give the internal viewport ownership of themed scrolling.");
}
if (!/viewportStyle=\{\{ maxHeight: Math\.max\(0, position\.maxHeight - 14\) \}\}/.test(source)) {
  failures.push("RichSelect must constrain the internal viewport within the popover padding.");
}
if (!/const viewport = option\?\.closest<HTMLElement>\("\.glass-selection-viewport"\);/.test(source)
  || !/viewport\.scrollTop \+= optionRect\.bottom - viewportRect\.bottom;/.test(source)
  || !/optionRect\.bottom > viewportRect\.bottom/.test(source)) {
  failures.push("RichSelect must keep the active option visible during keyboard navigation and opening.");
}
if (!/style=\{\{[\s\S]*maxHeight: position\.maxHeight,[\s\S]*\}\}/.test(source)) {
  failures.push("RichSelect popover must remain bounded by the available viewport height.");
}

const layoutPath = path.join(root, "editor", "src", "styles", "layout.css");
const layoutSource = fs.readFileSync(layoutPath, "utf8");
if (!/\.rich-select-popover\s*\{[\s\S]*box-sizing: border-box;[\s\S]*overflow: hidden !important;/.test(layoutSource)) {
  failures.push("RichSelect popover must clip decoration instead of becoming a second scroll node.");
}
if (!/\.rich-select-popover > \.rich-select-viewport > \.glass-selection-track\s*\{[\s\S]*flex-direction: column;/.test(layoutSource)) {
  failures.push("RichSelect option track must be explicitly vertical.");
}
if (!/\.glass-selection-group\[data-glass-scroll-axis="y"\] > \.glass-selection-viewport\s*\{[\s\S]*max-height: 100%;[\s\S]*overflow-y: auto;/.test(layoutSource)) {
  failures.push("Vertical glass selection viewports must own bounded vertical scrolling.");
}
if (!/\.glass-selection-viewport\.selection-scroll-region\s*\{[\s\S]*scrollbar-width: thin;/.test(layoutSource)) {
  failures.push("Selection viewports must use the shared thin scrollbar styling.");
}

if (failures.length > 0) {
  console.error("RichSelect positioning contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("RichSelect positioning contract passed.");
