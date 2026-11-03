const fs = require("node:fs");
const path = require("node:path");
const { summarizeTraceLoafWindows } = require("./lib/e2-trace-window-analysis.cjs");

function fail(message) {
  process.stderr.write(`${message}\nUsage: node scripts/e2-trace-window-analysis.cjs <performance-diagnostic-only.json> [repeat]\n`);
  process.exit(2);
}

const [, , reportPathArg, repeatArg] = process.argv;
if (!reportPathArg) fail("A diagnostic report path is required.");
const reportPath = path.resolve(reportPathArg);
if (!fs.existsSync(reportPath)) fail(`Diagnostic report not found: ${reportPath}`);

const repeat = repeatArg === undefined ? 1 : Number(repeatArg);
if (!Number.isSafeInteger(repeat) || repeat < 1) fail("Repeat must be a positive integer.");

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const trial = report.diagnosticResults?.[0]?.trials?.find((candidate) => (
  candidate.mode === "low-intrusion" && candidate.repeat === repeat
));
if (!trial) fail(`Low-intrusion repeat ${repeat} was not found in the diagnostic report.`);

const traceClockOriginUs = Number(trial.traceSummary?.traceClockAlignment?.traceOriginUs);
const tracePath = trial.traceSummary?.rawTracePath;
if (!Number.isFinite(traceClockOriginUs)) fail("The selected trial has no valid trace clock origin.");
if (typeof tracePath !== "string" || !fs.existsSync(tracePath)) fail("The selected trial's raw Chrome trace is missing.");

const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
const result = summarizeTraceLoafWindows({
  traceOriginUs: traceClockOriginUs,
  longAnimationFrames: trial.longAnimationFrames,
  traceEvents: trace.traceEvents,
});
const output = {
  kind: "e2-trace-loaf-window-analysis",
  diagnosticReport: reportPath,
  rawTrace: tracePath,
  repeat,
  viewport: trial.viewport ?? report.diagnosticResults?.[0]?.viewport ?? null,
  entryMode: trial.entryMode ?? report.diagnosticResults?.[0]?.entryMode ?? null,
  result,
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
