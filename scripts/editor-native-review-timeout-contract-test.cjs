#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { resolveNativeReviewTimeout } = require("./lib/native-review-timeout.cjs");

assert.equal(resolveNativeReviewTimeout(undefined), 300000, "default review window changed");
assert.equal(resolveNativeReviewTimeout("900000"), 900000, "configured review window ignored");
assert.throws(() => resolveNativeReviewTimeout("nope"), /integer/i);
assert.throws(() => resolveNativeReviewTimeout("29999"), /between/i);
assert.throws(() => resolveNativeReviewTimeout("1800001"), /between/i);

console.log("PASS native review timeout contract");
