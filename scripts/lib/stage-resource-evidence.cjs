"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function collectStageResourceEvidence(root, files) {
  const evidence = { bundled: [], frontendSources: [], backendSources: [] };
  for (const file of files) {
    if (typeof file !== "string" || file.includes("\\") || path.isAbsolute(file)
      || file.split("/").some(part => !part || part === "." || part === "..")) {
      throw Error(`Unsafe resource path: ${file}`);
    }
    const source = sha(path.join(root, file));
    if (file.startsWith("backend/")) {
      evidence.backendSources.push({ file, sha256: source,
        scope: "backend-source; Dev uses owned Python workspace; packaged backend requires Release acceptance" });
      continue;
    }
    if (file.startsWith("editor/src/")) {
      evidence.frontendSources.push({
        file, sha256: source,
        scope: "editor-frontend-source; compiled into frontendDist, not Runtime workspace",
      });
      continue;
    }
    const bundled = sha(path.join(root, "editor/src-tauri/bundle-workspace", file));
    evidence.bundled.push({ file, sha256: source, bundledSha256: bundled });
    if (source !== bundled) throw Error(`Bundled workspace mismatch: ${file}`);
  }
  return evidence;
}

module.exports = { collectStageResourceEvidence };
