"use strict";
// Observe the existing Playwright session. Never reconnect or reapply emulation.
const fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("../../GameCli_framework/node_modules/sharp");

async function startPresentedFrames(page, directory) {
  const client = await page.context().newCDPSession(page);
  const frames = [], animations = [], errors = [], waiters = new Set();
  const layers = [], layerReasons = new Map(), pendingReasons = [];
  const waitForFrameCount = count => new Promise((resolve, reject) => {
    if (frames.length >= count) { resolve(); return; }
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`Screencast missing frame ${count}`)); }, 5000);
    const check = () => {
      if (frames.length < count) return;
      clearTimeout(timer); waiters.delete(check); resolve();
    };
    waiters.add(check);
  });
  const state = () => page.evaluate(() => ({
    now: performance.now(), timeOrigin: performance.timeOrigin,
    width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  const before = await state();
  const onFrame = event => {
    // Ack before decoding or touching disk so observation doesn't hold the producer.
    frames.push({ bytes: Buffer.from(event.data, "base64"), metadata: event.metadata,
      sessionId: event.sessionId, receivedUtc: Date.now() });
    void client.send("Page.screencastFrameAck", { sessionId: event.sessionId })
      .catch(error => errors.push(String(error)));
    for (const check of waiters) check();
  };
  const onAnimation = event => animations.push(event);
  const onLayers = event => {
    layers.push({ receivedUtc: Date.now(), layers: event.layers });
    for (const layer of event.layers || []) {
      if (layerReasons.has(layer.layerId)) continue;
      layerReasons.set(layer.layerId, null);
      pendingReasons.push(client.send("LayerTree.compositingReasons", { layerId: layer.layerId })
        .then(result => layerReasons.set(layer.layerId, result))
        .catch(error => layerReasons.set(layer.layerId, { diagnosticError: String(error) })));
    }
  };
  client.on("Page.screencastFrame", onFrame);
  client.on("Animation.animationStarted", onAnimation);
  client.on("LayerTree.layerTreeDidChange", onLayers);
  await client.send("Animation.enable");
  await client.send("LayerTree.enable");
  await client.send("Page.startScreencast", {
    format: "jpeg", quality: 90, maxWidth: 640, maxHeight: 360, everyNthFrame: 1,
  });
  await waitForFrameCount(1);
  let finished;
  return {
    waitForFrameCount,
    async stop() {
      if (finished) return finished;
      const after = await state();
      await client.send("Page.stopScreencast");
      client.off("Page.screencastFrame", onFrame);
      client.off("Animation.animationStarted", onAnimation);
      client.off("LayerTree.layerTreeDidChange", onLayers);
      await Promise.all(pendingReasons);
      await client.detach();
      fs.mkdirSync(directory, { recursive: false });
      const saved = [];
      for (const [index, frame] of frames.entries()) {
        const file = path.join(directory, `frame-${String(index).padStart(4, "0")}.jpg`);
        fs.writeFileSync(file, frame.bytes, { flag: "wx" });
        const { data, info } = await sharp(frame.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        // Top-left artwork, away from text; all probe media has solid color here.
        const x = Math.floor(info.width * .03), y = Math.floor(info.height * .12);
        const at = (y * info.width + x) * info.channels;
        saved.push({
          path: file, sha256: crypto.createHash("sha256").update(frame.bytes).digest("hex"),
          metadata: frame.metadata, receivedUtc: frame.receivedUtc,
          at: frame.metadata.timestamp === undefined ? null
            : frame.metadata.timestamp * 1000 - before.timeOrigin,
          width: info.width, height: info.height, rgb: [...data.subarray(at, at + 3)],
        });
      }
      finished = { before, after, frames: saved, animations, layers, layerReasons: [...layerReasons], errors,
        boundary: "CDP compositor screencast, downsampled observer; not physical display or RAF" };
      fs.writeFileSync(path.join(directory, "capture.json"), JSON.stringify(finished, null, 2), { flag: "wx" });
      return finished;
    },
  };
}

function colorOpacity(rgb, references) {
  const candidates = references.map(reference => {
    const alpha = rgb.reduce((total, channel, i) => total + channel * reference[i], 0)
      / reference.reduce((total, channel) => total + channel * channel, 0);
    const error = Math.sqrt(rgb.reduce((total, channel, i) =>
      total + (channel - reference[i] * alpha) ** 2, 0) / 3);
    return { alpha, error, reference };
  });
  return candidates.sort((a, b) => a.error - b.error)[0];
}

module.exports = { startPresentedFrames, colorOpacity };
