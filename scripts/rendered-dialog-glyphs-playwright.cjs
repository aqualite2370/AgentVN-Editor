"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { renderedDialogGlyphs } = require("./lib/rendered-dialog-glyphs.cjs");
const output = path.resolve("output/playwright/rendered-dialog-glyphs",
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { status: "RUNNING", cases: [], startedAt: new Date().toISOString() };
let browser;
const contained = ({ rects, bounds }) => rects.every(rect => rect.left >= bounds.left - 1
  && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1);
(async () => {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(`<style>
    #panel{font:20px/24px monospace;white-space:pre-wrap;width:max-content;overflow:hidden;}
    #ink{white-space:pre;}
  </style><div id="panel"><span id="ink">ABCDEFGHIJ</span></div>`);
  await page.evaluate(() => {
    const panel = document.querySelector("#panel");
    panel.style.width = `${document.querySelector("#ink").getBoundingClientRect().width}px`;
    panel.querySelector("#ink").remove();
  });
  const check = async (name, text, styles, expected) => {
    const result = await page.evaluate(({ fn, text, styles }) => {
      const panel = document.querySelector("#panel");
      panel.style.whiteSpace = "pre-wrap"; panel.style.height = ""; panel.style.maxHeight = "";
      Object.assign(panel.style, styles);
      panel.replaceChildren();
      const outer = document.createElement("span"), inner = document.createElement("span");
      inner.textContent = text; outer.append(inner); panel.append(outer);
      const collect = new Function(`return (${fn})`)();
      const full = document.createRange(); full.selectNodeContents(inner);
      return { rects: collect(panel), bounds: panel.getBoundingClientRect().toJSON(),
        fullRange: [...full.getClientRects()].map(rect => rect.toJSON()), text: panel.textContent };
    }, { fn: renderedDialogGlyphs.toString(), text, styles });
    const row = { name, expected, actual: contained(result), result };
    report.cases.push(row);
    assert.equal(result.text, text, `${name}: source text must remain byte-for-byte intact`);
    assert.equal(row.actual, expected, `${name}: visible ink containment`);
    row.status = "PASS";
  };
  await check("pre-wrap hanging trailing space preserves visible ink", "ABCDEFGHIJ ", {}, true);
  assert(report.cases[0].result.fullRange.some(rect => rect.right > report.cases[0].result.bounds.right + 1),
    "Regression must actually reproduce Chromium's hanging-space Range");
  await check("multiple hanging spaces and authored newline", "ABCDEFGHIJ   \nABC", {}, true);
  await check("all-whitespace content", "   \n ", {}, true);
  await check("CJK punctuation and surrogate-pair text stay measured", "中文，测试。\n😀!", {}, true);
  await check("unwrapped visible letters outside right edge must fail", "ABCDEFGHIJK", { whiteSpace: "pre" }, false);
  await check("unwrapped CJK outside right edge must fail", "中文可见文字不应被豁免裁切", { whiteSpace: "pre" }, false);
  await check("visible second line outside bottom must fail", "ABC\nDEF", { height: "24px" }, false);
  await check("visible punctuation outside right edge must fail", "ABCDEFGHIJ!", { whiteSpace: "pre" }, false);
  assert.equal(report.cases.length, 8);
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, output, error: report.error }));
});
