const fs = require("node:fs");
const path = require("node:path");
const parser = require("../editor/node_modules/@babel/parser");

const root = path.resolve(__dirname, "../editor/src");
const scannedAttributes = new Set(["aria-label", "ariaLabel", "title", "placeholder", "alt", "data-help-title"]);
const allowedStandalone = new Set([
  "AgentVN",
  "GameCLI",
  "AI",
  "API",
  "JSON",
  "Token",
  "Subagent",
  "TXT",
  "Markdown",
  "APK",
  "JDK",
  "Android",
  "CSS",
  "HEX",
  "KB",
  "MB",
  "ms",
  "px",
]);
const forbiddenPhrases = [
  "Agent progress",
  "Subagent task slots",
  "Task details",
  "Hide details",
  "Project Timeline",
  "Restore Backup",
  "Delete Project",
  "Chapter preview",
  "VISUAL PLACEHOLDER",
  "Missing final asset",
  "Animation target",
  "Wait for animation",
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(tsx|jsx)$/.test(entry.name) && !entry.name.includes(".generated.") ? [fullPath] : [];
  });
}

function getName(name) {
  if (!name) return "";
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return `${getName(name.object)}.${getName(name.property)}`;
  return "";
}

function getStaticAttributeValue(attribute) {
  if (!attribute?.value) return "";
  if (attribute.value.type === "StringLiteral") return attribute.value.value;
  if (attribute.value.type === "JSXExpressionContainer" && attribute.value.expression.type === "StringLiteral") {
    return attribute.value.expression.value;
  }
  return "";
}

function isAllowedEnglish(value) {
  const trimmed = value.trim();
  if (!trimmed || /[\u3400-\u9fff]/u.test(trimmed)) return true;
  if (/^(?:[#./:]|https?:|sk-)/i.test(trimmed)) return true;
  if (/^[A-Z0-9_.:/+-]+$/.test(trimmed)) return true;
  const normalized = trimmed.replace(/[·:：,，;；()[\]{}]/g, "").trim();
  return allowedStandalone.has(trimmed) || allowedStandalone.has(normalized);
}

function visit(node, onNode) {
  if (!node || typeof node !== "object") return;
  onNode(node);
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "start", "end"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => visit(child, onNode));
    else if (value && typeof value === "object") visit(value, onNode);
  }
}

const failures = [];

for (const file of walk(root)) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(path.resolve(__dirname, ".."), file);
  for (const phrase of forbiddenPhrases) {
    const index = source.indexOf(phrase);
    if (index !== -1) {
      const line = source.slice(0, index).split(/\r?\n/).length;
      failures.push({ relative, line, value: phrase });
    }
  }

  const ast = parser.parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    errorRecovery: true,
  });

  visit(ast, (node) => {
    let value = "";
    if (node.type === "JSXText") value = node.value.trim();
    if (node.type === "JSXAttribute" && scannedAttributes.has(getName(node.name))) {
      value = getStaticAttributeValue(node);
    }
    if (!value || !/[A-Za-z]{2}/.test(value) || isAllowedEnglish(value)) return;
    failures.push({ relative, line: node.loc?.start.line ?? 0, value });
  });
}

if (failures.length > 0) {
  console.error("编辑器中文文案审计失败，发现未允许的纯英文界面文本：");
  for (const failure of failures) {
    console.error(`- ${failure.relative}:${failure.line} ${JSON.stringify(failure.value)}`);
  }
  process.exit(1);
}

console.log("编辑器中文文案审计通过。");
