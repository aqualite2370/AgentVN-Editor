"use strict";

// Editor GUI modal: DOM geometry alone cannot detect missing composited paint.
const assert = require("node:assert/strict");
const sharp = require("../../GameCli_framework/node_modules/sharp");

async function inspectGuiDialogPaint(page, dialog, png) {
  const dom = await dialog.evaluate(node => {
    const style = getComputedStyle(node);
    const header = node.querySelector("header");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    const rgb = color => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const panel = rgb(style.getPropertyValue("--panel-bg").trim());
    const ink = rgb(getComputedStyle(header).color);
    return { rect: node.getBoundingClientRect().toJSON(), viewport: { width: innerWidth, height: innerHeight },
      panel, ink, background: style.background,
      opacity: style.opacity, transform: style.transform, visibility: style.visibility,
      header: { rect: header.getBoundingClientRect().toJSON(), opacity: getComputedStyle(header).opacity,
        visibility: getComputedStyle(header).visibility, text: header.textContent },
      phase: node.parentElement.dataset.phase };
  });
  return inspectGuiDialogPng(dom, png);
}

async function inspectGuiDialogPng(dom, png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scaleX = info.width / dom.viewport.width, scaleY = info.height / dom.viewport.height;
  const sample = (x, y) => {
    const values = [0, 0, 0];
    let count = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const px = Math.round((x + dx) * scaleX), py = Math.round((y + dy) * scaleY);
      assert(px >= 0 && py >= 0 && px < info.width && py < info.height, "Paint patch outside screenshot");
      const offset = (py * info.width + px) * info.channels;
      for (let c = 0; c < 3; c++) values[c] += data[offset + c];
      count++;
    }
    return values.map(value => value / count);
  };
  // Empty inner padding, away from text, border, rounded corners and controls.
  const patches = [dom.rect.top + 30, dom.rect.bottom - 30].map(y => {
    const x = dom.rect.left + 8, rgb = sample(x, y);
    return { x, y, rgb, maxChannelDelta: Math.max(...rgb.map((value, index) => Math.abs(value - dom.panel[index]))) };
  });
  let headerInkPixels = 0;
  const header = dom.header.rect;
  for (let y = Math.ceil(header.top * scaleY); y < Math.floor(header.bottom * scaleY); y++) {
    for (let x = Math.ceil(header.left * scaleX); x < Math.floor(header.right * scaleX); x++) {
      const offset = (y * info.width + x) * info.channels;
      if (dom.ink && dom.ink.slice(0, 3).every((value, c) => Math.abs(data[offset + c] - value) < 50))
        headerInkPixels++;
    }
  }
  return { ...dom, image: { width: info.width, height: info.height, scaleX, scaleY }, patches, headerInkPixels };
}

function assertGuiDialogPaint(evidence) {
  assert.equal(evidence.phase, "open", "Paint proof must be captured after real dialog entry completion");
  assert.equal(evidence.panel[3], 255, "Fixture must use the opaque Editor panel theme");
  for (const patch of evidence.patches) {
    assert(patch.maxChannelDelta <= 40,
      `GUI shell missing painted theme surface despite visible DOM: ${JSON.stringify(patch)}`);
  }
  assert(evidence.headerInkPixels >= 30 * evidence.image.scaleX * evidence.image.scaleY,
    `GUI header has no painted title/actions despite visible DOM: ${evidence.headerInkPixels} ink pixels`);
}

module.exports = { inspectGuiDialogPaint, inspectGuiDialogPng, assertGuiDialogPaint };
