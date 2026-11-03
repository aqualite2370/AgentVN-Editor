"use strict";

// Select measured pixels, never CSS declarations or interpolated frames.
// A frame before 25% that already reaches the threshold proves early response
// even when the display cadence skips the narrow quarter sampling window.
function selectEarlyRenderedResponse(frames, threshold = .45) {
  const measured = frames.filter(frame => Number.isFinite(frame.clock)
    && Number.isFinite(frame.renderedProgress));
  const quarter = measured.filter(frame => frame.clock >= .20 && frame.clock <= .32);
  const earlyProof = measured.filter(frame => frame.clock >= 0 && frame.clock <= .25
    && frame.renderedProgress >= threshold);
  const candidates = quarter.length ? quarter : earlyProof;
  if (!candidates.length) return null;
  const sample = candidates.reduce((best, frame) =>
    Math.abs(frame.clock - .25) < Math.abs(best.clock - .25) ? frame : best);
  return { sample, method: quarter.length ? "measured-quarter-frame" : "measured-before-quarter-threshold" };
}

module.exports = { selectEarlyRenderedResponse };
