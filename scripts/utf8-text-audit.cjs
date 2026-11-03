const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const allowedExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".kt", ".md", ".mjs",
  ".ps1", ".py", ".rs", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);
const excludedSegments = new Set(["node_modules", "target", "dist", "build", ".git"]);
const mojibakeFixtureAllowlist = new Set(["scripts/utf8-text-audit.cjs"]);
const knownMojibake = /鍚庣|闅愬|鐨勬|锛\?/;
const suspiciousMojibakeCharacters = /[縺繧譁陦莠螟]/g;
const ansi = /\x1b\[[0-?]*[ -/]*[@-~]/;
const decoder = new TextDecoder("utf-8", { fatal: true });

function containsLikelyMojibake(text) {
  if (knownMojibake.test(text)) return true;
  const positions = [...text.matchAll(suspiciousMojibakeCharacters)].map((match) => match.index);
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] - positions[index - 1] <= 8) return true;
  }
  return false;
}

if (containsLikelyMojibake("蜿蜒曲折")) {
  throw new Error("UTF-8 mojibake detector must accept normal Chinese text.");
}
if (!containsLikelyMojibake("闅愬繊鐨勬垚闀")) {
  throw new Error("UTF-8 mojibake detector must reject known mojibake.");
}

const listed = execFileSync("git", [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
], { cwd: root, encoding: "utf8" });

const failures = [];
for (const relativePath of listed.split(/\r?\n/).filter(Boolean)) {
  const parts = relativePath.split(/[\\/]/);
  if (parts.some((part) => excludedSegments.has(part))) continue;
  if (!allowedExtensions.has(path.extname(relativePath).toLowerCase())) continue;
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
  let text;
  try {
    text = decoder.decode(fs.readFileSync(filePath));
  } catch (error) {
    failures.push(`${relativePath}: invalid UTF-8 (${error.message})`);
    continue;
  }
  if (text.includes("\uFFFD")) failures.push(`${relativePath}: contains U+FFFD`);
  if (!mojibakeFixtureAllowlist.has(relativePath) && containsLikelyMojibake(text)) {
    failures.push(`${relativePath}: contains likely UTF-8/GBK mojibake`);
  }
  if (path.extname(relativePath).toLowerCase() === ".json" && ansi.test(text)) {
    failures.push(`${relativePath}: JSON contains ANSI terminal escapes`);
  }
}

if (failures.length > 0) {
  throw new Error(`UTF-8 text audit failed:\n${failures.join("\n")}`);
}
console.log("PASS UTF-8 repository text audit");
