"use strict";

/**
 * Start observing the creation POST before triggering the UI action, then
 * expose the server receipt to the caller. Reading a process by id must happen
 * after this receipt; observing a request is not a durable creation signal.
 */
async function waitForAcceptedCreationSubmission(page, trigger, options = {}) {
  const timeout = options.timeout ?? 20_000;
  const responsePromise = page.waitForResponse(
    response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/assistant/creation/processes"
      && response.status() === 202,
    { timeout },
  );
  await trigger();
  const response = await responsePromise;
  const body = await response.json();
  if (!body || typeof body.id !== "string" || !body.id.trim()) {
    throw new Error("Creation POST returned 202 without a process id.");
  }
  return body;
}

module.exports = { waitForAcceptedCreationSubmission };
