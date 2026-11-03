"use strict";

const assert = require("node:assert/strict");

// Serializable: runs inside the real Runtime document, including native CDP.
function measureSettingsIconProportions() {
  const panel = document.querySelector(".settings-renpy");
  if (!panel) throw Error("SETTINGS_PROPORTIONS_PANEL_MISSING");
  return [...panel.querySelectorAll(".settings-tabs button, .settings-footer button")]
    .filter(button => button.querySelector(".precision-icon"))
    .map(button => {
      const icon = button.querySelector(".precision-icon");
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      const glyph = icon.querySelector("g");
      const inkRect = glyph?.getBoundingClientRect();
      const iconCss = parseFloat(getComputedStyle(icon).width);
      return {
        label: button.textContent.trim(),
        font: parseFloat(style.fontSize),
        gap: parseFloat(style.columnGap),
        iconCss,
        ink: inkRect ? {
          width: inkRect.width,
          height: inkRect.height,
          left: inkRect.left,
          right: inkRect.right,
          top: inkRect.top,
          bottom: inkRect.bottom,
        } : null,
        rect: rect.toJSON(),
        icon: icon.getBoundingClientRect().toJSON(),
        hit: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
      };
    });
}

function assertSettingsIconProportions(controls) {
  assert.equal(controls.length, 7, "SETTINGS_PROPORTIONS: five categories and two footer icons required");
  for (const control of controls) {
    const message = `SETTINGS_PROPORTIONS: ${control.label}`;
    assert(control.hit, `${message} must be hittable`);
    assert(Math.abs(control.iconCss / control.font - 1.2) <= .03, `${message} icon/font ratio`);
    assert(Math.abs(control.gap / control.font - .4) <= .03, `${message} spacing/font ratio`);
    const inkRatio = Math.max(control.ink.width, control.ink.height) / control.font;
    assert(inkRatio >= .86 && inkRatio <= .96,
      `${message} visible icon ink/font ratio must stay optically balanced (got ${inkRatio.toFixed(3)})`);
    assert(control.ink.left >= control.icon.left && control.ink.right <= control.icon.right
      && control.ink.top >= control.icon.top && control.ink.bottom <= control.icon.bottom,
      `${message} visible paths must fit inside the SVG viewport`);
    assert(Math.abs(control.icon.width - control.icon.height) <= 1, `${message} square icon`);
    assert(Math.abs(control.icon.top + control.icon.height / 2 - control.rect.top - control.rect.height / 2) <= 1,
      `${message} vertical alignment`);
    assert(control.icon.left >= control.rect.left - 1 && control.icon.right <= control.rect.right + 1
      && control.icon.top >= control.rect.top - 1 && control.icon.bottom <= control.rect.bottom + 1,
    `${message} icon clipped by action bounds`);
  }
}

module.exports = { measureSettingsIconProportions, assertSettingsIconProportions };
