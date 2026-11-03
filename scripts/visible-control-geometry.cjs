"use strict";

// Self-contained so the same function can run in Chromium and Android CDP.
function visibleControlRect(element) {
  const bounds = element.getBoundingClientRect();
  let left = bounds.left;
  let top = bounds.top;
  let right = bounds.right;
  let bottom = bounds.bottom;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
    const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const rect = parent.getBoundingClientRect();
    const scaleX = parent.offsetWidth ? rect.width / parent.offsetWidth : 1;
    const scaleY = parent.offsetHeight ? rect.height / parent.offsetHeight : 1;
    const contentLeft = rect.left + parent.clientLeft * scaleX;
    const contentTop = rect.top + parent.clientTop * scaleY;
    if (clipsX) {
      left = Math.max(left, contentLeft);
      right = Math.min(right, contentLeft + parent.clientWidth * scaleX);
    }
    if (clipsY) {
      top = Math.max(top, contentTop);
      bottom = Math.min(bottom, contentTop + parent.clientHeight * scaleY);
    }
  }
  right = Math.max(left, right);
  bottom = Math.max(top, bottom);
  return { x: left, y: top, right, bottom, width: right - left, height: bottom - top };
}

function rectOutsideRoot(rect, root) {
  return rect.x < -1 || rect.y < -1 || rect.right > root.width + 1 || rect.bottom > root.height + 1;
}

module.exports = { visibleControlRect, rectOutsideRoot };
