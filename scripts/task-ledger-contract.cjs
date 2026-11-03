const fs = require("fs");
const path = require("path");
const { validateActiveTaskIndex } = require("./lib/active-task-index.cjs");

const root = path.resolve(__dirname, "..");
const ledgerPath = path.join(root, "plans", "ACTIVE_TASKS.md");
const ledger = fs.readFileSync(ledgerPath, "utf8").replace(/^\uFEFF/, "");
const result = validateActiveTaskIndex(ledger);
console.log(`active task index contract: PASS (${result.activeHeading}; ${result.evidenceReferenceCount} evidence references)`);
