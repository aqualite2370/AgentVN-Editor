"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/checkpoints/assistant-global-queue", runId);
const files = [
  "backend/app/api/routes_assistant.py",
  "backend/app/api/deps.py",
  "backend/app/db/init_db.py",
  "backend/app/main.py",
  "backend/app/models/assistant_creation.py",
  "backend/app/services/project_state_service.py",
  "backend/tests/test_assistant_creation_api.py",
  "editor/src/assistant/creationProcessQueue.ts",
  "editor/src/assistant/creationAgent.ts",
  "editor/src/assistant/conversationHistory.ts",
  "editor/src/api/backendClient.ts",
  "editor/src/api/types.ts",
  "editor/src/components/assistant/AssistantChatPanel.tsx",
  "editor/src/components/assistant/AssistantCreationWorkbenchWindow.tsx",
  "editor/src/components/editor/VisualNovelEditor.tsx",
  "editor/src/styles/editor-shell.css",
  "editor/src/__assistant_session_harness__.tsx",
  "scripts/assistant-creation-process-queue-test.cjs",
  "scripts/assistant-conversation-history-playwright.cjs",
];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.mkdirSync(output, { recursive: true });
const entries = files.map(relative => {
  const source = path.join(root, relative);
  const target = path.join(output, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  return { path: relative, sha256: sha(source) };
});
for (const [name, args] of [
  ["status.txt", ["status", "--short"]],
  ["tracked.patch", ["diff", "--binary", "HEAD"]],
  ["untracked.txt", ["ls-files", "--others", "--exclude-standard"]],
]) {
  fs.writeFileSync(path.join(output, name), execFileSync("git", args, {
    cwd: root, maxBuffer: 128 * 1024 * 1024,
  }), { flag: "wx" });
}
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({
  runId,
  scope: "assistant-global-queue",
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  files: entries,
  artifacts: ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe"]
    .filter(relative => fs.existsSync(path.join(root, relative)))
    .map(relative => ({ path: relative, sha256: sha(path.join(root, relative)) })),
  note: "Pre-implementation copies include untracked slice files. Existing reports and artifacts remain in place.",
}, null, 2), { flag: "wx" });
console.log(path.join(output, "manifest.json"));
