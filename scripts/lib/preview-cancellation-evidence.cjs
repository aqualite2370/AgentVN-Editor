"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

/** Only detached preview-frame cancellations are candidates, never live failures. */
async function verifyDetachedPreviewCancellation(request, page, editorUrl, recheckUrl = request.url()) {
  const frame = request.frame();
  const url = new URL(request.url());
  const preview = new URL(frame.url());
  if (request.failure()?.errorText !== "net::ERR_ABORTED"
    || preview.origin !== editorUrl || !preview.pathname.startsWith("/gamecli-preview/")) return undefined;
  const asset = ["font", "image", "script", "stylesheet"].includes(request.resourceType())
    && (url.pathname.startsWith("/api/project/assets/") || url.pathname.startsWith("/gamecli-preview/assets/"));
  const probeValidators = {
    "/runtime-mode.json": value => ["library", "preview", "fixed"].includes(value?.mode),
    "/fixed-only.json": value => typeof value?.fixedOnly === "boolean",
    "/release-package.json": value => ["development", "release"].includes(value?.presentationMode),
  };
  const validateProbe = url.origin === editorUrl && !url.search
    && request.resourceType() === "fetch" ? probeValidators[url.pathname] : undefined;
  if (!asset && !validateProbe) return undefined;
  // Chromium may deliver requestfailed immediately before framedetached for
  // the same removed iframe. Require the actual lifecycle event; an abort in
  // a still-mounted preview must remain a failure.
  if (!frame.isDetached()) {
    try {
      await page.waitForEvent("framedetached", { predicate: detached => detached === frame, timeout: 1000 });
    } catch {
      return undefined;
    }
  }
  if (!frame.isDetached()) return undefined;
  const response = await page.request.get(recheckUrl);
  const body = await response.body();
  const mime = response.headers()["content-type"] ?? "";
  let validation = "available-resource";
  if (validateProbe && response.status() === 404) {
    validation = "optional-probe-absent";
  } else {
    assert(response.ok(), `Cancelled preview resource is unavailable: ${recheckUrl} (${response.status()})`);
    assert(body.length > 0, `Cancelled preview resource is empty: ${recheckUrl}`);
    if (validateProbe) {
      if (mime.startsWith("text/html")) {
        // Dev SPA fallbacks intentionally have no marker. Prove this is the
        // actual editor document, not an arbitrary HTML error page.
        const fallback = await page.request.get(`${editorUrl}/`);
        assert(fallback.ok() && (fallback.headers()["content-type"] ?? "").startsWith("text/html")
          && body.equals(await fallback.body()), `Optional probe has an unverified HTML response: ${recheckUrl}`);
        validation = "optional-probe-spa-fallback";
      } else {
        assert(mime.includes("application/json"), `Invalid optional probe MIME: ${mime}`);
        assert(validateProbe(JSON.parse(body.toString("utf8"))), `Invalid optional probe schema: ${recheckUrl}`);
        validation = "optional-probe-json";
      }
    }
    if (request.resourceType() === "image") assert(mime.startsWith("image/"), `Invalid preview image MIME: ${mime}`);
    if (request.resourceType() === "font") assert(mime.startsWith("font/"), `Invalid preview font MIME: ${mime}`);
  }
  return { url: request.url(), recheckUrl, resourceType: request.resourceType(),
    originalError: request.failure().errorText, frameUrl: frame.url(), frameDetached: true,
    reason: "node-preview iframe unmounted", recheckStatus: response.status(), bytes: body.length,
    sha256: crypto.createHash("sha256").update(body).digest("hex"), validation };
}

module.exports = { verifyDetachedPreviewCancellation };
