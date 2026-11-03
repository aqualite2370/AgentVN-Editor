"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const output = "F:/AgentVN/Checkpoints/Assistant-Tool-Protocol-20261019-01";
if (fs.existsSync(output)) throw new Error(`Checkpoint already exists: ${output}`);
const files = [
  "AGENTS.md", "plans/ACTIVE_TASKS.md",
  "backend/app/ai/provider.py", "backend/app/api/routes_assistant.py",
  "backend/app/services/assistant_creation_agent.py",
  "backend/app/services/assistant_creation_local_tools.py",
  "backend/tests/test_assistant_creation_agent.py",
  "backend/tests/test_assistant_creation_transport.py",
  "backend/tests/test_assistant_creation_authorization.py",
  "editor/src/assistant/creationAgent.ts",
];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(output, { recursive: false });
const entries = files.map(file => {
  const source = path.join(root, file);
  const destination = path.join(output, "files", file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  const digest = sha(source);
  if (sha(destination) !== digest) throw new Error(`Checkpoint hash mismatch: ${file}`);
  return { file, sha256: digest };
});
fs.writeFileSync(path.join(output, "tracked.patch"), execFileSync("git", ["diff", "--binary", "HEAD"], {
  cwd: root, maxBuffer: 128 * 1024 * 1024,
}));
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
  at: new Date().toISOString(),
  scope: "Authorized AI creation tool protocol repair; existing dirty and untracked sources preserved",
  entries,
  dev: { path: path.join(root, "AgentVN Dev.exe"), sha256: sha(path.join(root, "AgentVN Dev.exe")) },
  installedEditor: {
    path: "F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe",
    sha256: sha("F:/AgentVN/QA/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe"),
  },
  binariesCopied: false,
}, null, 2));
console.log(JSON.stringify({ status: "PASS", output, files: entries.length }));
