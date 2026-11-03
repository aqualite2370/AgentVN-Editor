"use strict";

// Result explanation is separate from status calculation. Never upgrades a
// report or changes recorded evidence, and can be replayed against raw reports.
function runtimeFailureDetails(report) {
  if (["RUNTIME_PASS", "INSTALLED_RESOURCE_SMOKE_PASS", "INSTALLED_PACKAGE_SMOKE_PASS"].includes(report.status))
    return { failureCode: null, message: null, missingCoverage: [] };
  const stages = report.stages || {};
  const missingCoverage = Object.entries(report.requiredCoverage || {})
    .filter(([, status]) => status !== "PASS")
    .map(([name, status]) => ({ name, status }));
  const failed = value => value === "FAILED" || value === "FAIL";
  const audioRequired = report.scope !== "installed-package-smoke";
  const failureCode = failed(stages.cleanup) ? "ANDROID_CLEANUP_FAILED"
    : failed(stages.runtime) ? "ANDROID_FATAL_RUNTIME_ERROR"
    : failed(stages.build) ? "ANDROID_BUILD_FAILED"
    : failed(stages.provenance) ? "ANDROID_PROVENANCE_FAILED"
    : audioRequired && stages.audio !== "PASS" ? "ANDROID_AUDIO_EVIDENCE_MISSING"
    : "ANDROID_REQUIRED_EVIDENCE_MISSING";
  const reasons = [];
  for (const name of ["build", "runtime", "provenance", "audio", "cleanup"]) {
    if (name === "audio" && !audioRequired) continue;
    if (stages[name] === "PASS") continue;
    let detail = `${name}=${stages[name] || "NOT_RECORDED"}`;
    if (name === "runtime") {
      if (missingCoverage.length) detail += ` (${missingCoverage.map(row => `${row.name}=${row.status}`).join(", ")})`;
      if (missingCoverage.some(row => row.name === "rendererWarnings")) {
        const assessment = report.rendererWarningAssessment;
        if (assessment?.reason) detail += `; renderer reason: ${assessment.reason}`;
        if (assessment?.unknownWarnings?.length) detail += `; unknownWarnings=${assessment.unknownWarnings.length}`;
      }
      if (report.logcat?.fatal?.length) detail += `; ${report.logcat.fatal.join("; ")}`;
    }
    if (name === "audio" && report.audio?.reason) detail += `; ${report.audio.reason}`;
    if (name === "provenance" && report.provenance?.reason) detail += `; ${report.provenance.reason}`;
    if (name === "build" && report.build?.reason) detail += `; ${report.build.reason}`;
    if (name === "cleanup") detail += `; ${report.cleanupError
      || `uninstall=${report.uninstallStatus || "NOT_RECORDED"}, staging=${report.apkCleanupStatus || "NOT_RECORDED"}`}`;
    reasons.push(detail);
  }
  return { failureCode, missingCoverage,
    message: `${failureCode}: ${reasons.join("; ") || "Required acceptance evidence is not recorded"}` };
}

function rendererDiagnosticStatus(runtimeStatus) {
  return ["RUNTIME_PASS", "INSTALLED_RESOURCE_SMOKE_PASS", "INSTALLED_PACKAGE_SMOKE_PASS"].includes(runtimeStatus)
    ? "RENDERER_DIAGNOSTIC_PASS" : runtimeStatus;
}

module.exports = { runtimeFailureDetails, rendererDiagnosticStatus };
