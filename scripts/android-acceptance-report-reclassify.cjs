#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { assessRestartTrials, compareRestartScreenshots } = require("./android-runtime-log-analysis.cjs");

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("usage: node android-acceptance-report-reclassify.cjs <input-report> <output-report>");

const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const input = path.resolve(inputPath);
const output = path.resolve(outputPath);
const report = JSON.parse(fs.readFileSync(input, "utf8"));
const derived = structuredClone(report);
const trials = derived.restartTrials || [];
for (const trial of trials) {
  if (trial.screenshotPath) continue;
  const inferred = path.join(path.dirname(input), `${trial.kind}-${trial.iteration}.png`);
  if (fs.existsSync(inferred)) trial.screenshotPath = inferred;
}
const reference = trials.find(trial => !(trial.warnings || []).some(line => /tile memory limits exceeded/i.test(line)))?.screenshotPath;

(async () => {
  for (const trial of trials) {
    if (!(trial.warnings || []).some(line => /tile memory limits exceeded/i.test(line))) continue;
    if (!reference || !trial.screenshotPath || !fs.existsSync(reference) || !fs.existsSync(trial.screenshotPath)) {
      throw new Error(`MISSING_SCREENSHOT_EVIDENCE:${trial.kind}-${trial.iteration}`);
    }
    trial.visualComparison = await compareRestartScreenshots(trial.screenshotPath, reference);
  }
  derived.rendererWarningAssessment = assessRestartTrials(trials);
  if (!derived.rendererWarningAssessment.status.startsWith("PASS")) {
    throw new Error(`RENDERER_RECLASSIFICATION_BLOCKED:${derived.rendererWarningAssessment.reason}`);
  }
  derived.requiredCoverage.rendererWarnings = "PASS";
  derived.stages.runtime = derived.logcat?.fatal?.length ? "FAILED" : "PASS";
  derived.amendment = {
    schemaVersion: 1,
    kind: "post-run-evidence-reclassification",
    generatedAt: new Date().toISOString(),
    sourceReportPath: input,
    sourceReportSha256: sha256(input),
    reason: "Re-evaluated scoped WebView cache/tile warnings with bounded DOM ranges and decoded screenshot comparisons; original report is preserved.",
    originalStatus: report.status,
    rendererStatus: derived.rendererWarningAssessment.status,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(derived, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: derived.status,
    runtime: derived.stages.runtime,
    renderer: derived.rendererWarningAssessment.status,
    output,
  }));
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
