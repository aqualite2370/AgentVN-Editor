"use strict";

function summarizeSettledAdvancedLayers(layers, prepaintPixelQualified = false) {
  const painted = layers.filter(layer => layer.display !== "none" && layer.visibility !== "hidden");
  const warm = painted.filter(layer => layer.className.split(/\s+/).includes("is-warm")
    && layer.inert && layer.ariaHidden === "true" && layer.pointerEvents === "none"
    && (Number(layer.opacity) === 0 || (layer.tab === "layout"
      && layer.opacity === "0.001" && prepaintPixelQualified)));
  return { visibleLayers: painted.length - warm.length, qualifiedWarmLayers: warm };
}

module.exports = { summarizeSettledAdvancedLayers };
