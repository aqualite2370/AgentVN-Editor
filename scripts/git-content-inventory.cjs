"use strict";
// Read-only candidate inventory. Findings contain locations and fingerprints,
// never matched secrets. A clean heuristic scan is not a completed review/push.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Git-Content-Review-20261103-01";
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true,
  maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ["service-key", /\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/g],
  ["literal-credential", /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\b["']?\s*[:=]\s*["']([A-Za-z0-9_+./=-]{16,})["']/gi],
  ["url-credentials", /\bhttps?:\/\/[A-Za-z0-9._~-]+:[^/\s"'<>]{8,}@/g],
];
function scan(text) {
  const findings = [];
  for (const [rule, regex] of rules) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex))
      findings.push({ rule, line: text.slice(0, match.index).split("\n").length,
        fingerprint: hash(match[0]), review: "REQUIRED" });
  }
  return findings;
}
function selfTest() {
  const specimens = [
    ["private-key", "-----BEGIN " + "PRIVATE KEY-----"],
    ["service-key", "sk-" + "A9".repeat(20)],
    ["service-key", "ghp_" + "B8".repeat(20)],
    ["literal-credential", 'api_key: "' + "C7".repeat(12) + '"'],
    ["url-credentials", "https://qa:" + "D6".repeat(10) + "@invalid.test"],
  ];
  for (const [rule, text] of specimens) {
    const items = scan(text); assert(items.some(f => f.rule === rule));
    assert(!JSON.stringify(items).includes(text)); assert(items.every(f => /^[a-f0-9]{64}$/.test(f.fingerprint)));
  }
  assert.deepEqual(scan('api_key: process.env.API_KEY\nconst token = "";\nhttps://example.com'), []);
  return { status: "PASS", syntheticDetections: specimens.length, redactedOutputs: specimens.length,
    nonSecretNegative: 1 };
}
module.exports = { scan, selfTest };
if (require.main === module) {
  if (process.argv[2] === "--self-test") console.log(JSON.stringify(selfTest()));
  else {
    const number = process.argv[2]; assert.match(number || "", /^\d{2}$/);
    const out = path.join(base, "inventory-" + number); assert(!fs.existsSync(out));
    fs.mkdirSync(out, { recursive: true });
    const report = { status: "RUNNING", scope: "READ_ONLY_CANDIDATE_CONTENT_HEURISTICS_NOT_FULL_REVIEW_OR_DELIVERY",
      startedAt: new Date().toISOString(), stagedPaths: 0, commits: 0, pushes: 0, fetches: 0,
      limitations: ["Heuristic rules cannot prove absence of all credentials, encoded secrets or private data.",
        "All candidates, third-party licenses and needed ignored inputs still require review before staging.",
        "Binary bytes are inventoried, not parsed as text. Git history is not scanned."],
      files: [], findings: [], errors: [] };
    const descriptor = f => fs.existsSync(f) ? { path: f, sha256: hash(fs.readFileSync(f)) } : { path: f, exists: false };
    const state = () => ({
      head: git(["rev-parse", "HEAD"]).trim(), branch: git(["branch", "--show-current"]).trim(),
      index: descriptor(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())),
      fetchHead: descriptor(path.resolve(root, git(["rev-parse", "--git-path", "FETCH_HEAD"]).trim())),
      refs: git(["for-each-ref", "--format=%(refname):%(objectname)"]).trim(),
    });
    try {
      report.selfTest = selfTest(); report.before = state();
      const tracked = new Set(git(["ls-files", "-z", "--cached"]).split("\0").filter(Boolean));
      const untracked = git(["ls-files", "-z", "--others", "--exclude-standard"]).split("\0").filter(Boolean);
      report.tracked = tracked.size; report.untracked = untracked.length;
      for (const relative of [...new Set([...tracked, ...untracked])].sort()) {
        const file = path.resolve(root, relative);
        assert(!path.relative(root, file).startsWith("..") && file !== root);
        if (!fs.existsSync(file)) { report.files.push({ relative, tracked: tracked.has(relative), deleted: true }); continue; }
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) { report.errors.push({ relative, reason: "Non-regular candidate" }); continue; }
        const bytes = fs.readFileSync(file), binary = bytes.subarray(0, 8192).includes(0);
        const item = { relative, tracked: tracked.has(relative), bytes: bytes.length, sha256: hash(bytes), binary };
        if (!binary) {
          const matches = scan(bytes.toString("utf8"));
          item.findings = matches.length;
          report.findings.push(...matches.map(f => ({ relative, ...f })));
        }
        report.files.push(item);
      }
      report.after = state(); assert.deepEqual(report.after, report.before, "Git state changed");
      report.gitStatePreserved = true;
      report.status = report.errors.length ? "FAILED" : report.findings.length ? "BLOCKED" : "PASS";
      report.interpretation = "Inventory complete only; no staging, completed content review, commit or push.";
    } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, out, files: report.files.length,
      findings: report.findings.length, errors: report.errors.length, error: report.error }));
  }
}
