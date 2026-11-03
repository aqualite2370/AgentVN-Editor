"use strict";
const { performance } = require("node:perf_hooks");

/** Read-only browser/IPC observations. Await each resolved value before testing
 * truthiness, keep one read in flight, and bound even a never-resolving read.
 * Rejections are failures, not another retry. This does not delay UI ownership. */
async function waitForAsyncFunction(page, predicate, argument, options = {}) {
  const timeout = options.timeout ?? 30000, polling = options.polling ?? 50;
  if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(polling) || polling <= 0)
    throw new Error("Async readiness requires positive finite timeout/polling");
  const deadline = performance.now() + timeout;
  let attempts = 0;
  const expired = () => new Error(`Async readiness timed out after ${timeout}ms (${attempts} observations)`);
  while (true) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw expired();
    let timer;
    attempts++;
    let value;
    try {
      value = await Promise.race([
        page.evaluate(predicate, argument),
        new Promise((_, reject) => { timer = setTimeout(() => reject(expired()), remaining); }),
      ]);
    } finally { clearTimeout(timer); }
    if (performance.now() >= deadline) throw expired();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, Math.min(polling, deadline - performance.now())));
  }
}

module.exports = { waitForAsyncFunction };
