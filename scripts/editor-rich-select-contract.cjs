const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "editor", "src");
const ignoredDirectories = new Set(["node_modules", "dist", "output"]);
const violations = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(target);
      continue;
    }
    if (!entry.name.endsWith(".tsx")) continue;
    const source = fs.readFileSync(target, "utf8");
    if (/<select(?:\s|>)/i.test(source)) {
      violations.push(path.relative(path.resolve(__dirname, ".."), target));
    }
  }
}

walk(root);

if (violations.length > 0) {
  console.error("发现原生 <select>，请统一使用场景编辑台同款 RichSelect：");
  for (const file of violations) console.error(`- ${file}`);
  process.exit(1);
}

console.log("RichSelect contract passed: editor/src 中没有残留原生 <select>。");
