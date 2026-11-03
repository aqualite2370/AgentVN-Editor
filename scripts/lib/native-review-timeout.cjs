"use strict";

const DEFAULT_NATIVE_REVIEW_TIMEOUT_MS = 300000;
const MIN_NATIVE_REVIEW_TIMEOUT_MS = 30000;
const MAX_NATIVE_REVIEW_TIMEOUT_MS = 1800000;

function resolveNativeReviewTimeout(value) {
  if (value === undefined || value === "") return DEFAULT_NATIVE_REVIEW_TIMEOUT_MS;
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout))
    throw new TypeError("Native UI review timeout must be an integer.");
  if (timeout < MIN_NATIVE_REVIEW_TIMEOUT_MS || timeout > MAX_NATIVE_REVIEW_TIMEOUT_MS)
    throw new RangeError(`Native UI review timeout must be between ${MIN_NATIVE_REVIEW_TIMEOUT_MS} and ${MAX_NATIVE_REVIEW_TIMEOUT_MS} ms.`);
  return timeout;
}

module.exports = {
  DEFAULT_NATIVE_REVIEW_TIMEOUT_MS,
  resolveNativeReviewTimeout,
};
