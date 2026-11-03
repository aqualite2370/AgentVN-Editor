const fs = require("fs");
const path = require("path");
const parser = require("../editor/node_modules/@babel/parser");

const root = path.resolve(__dirname, "../editor/src");
const allowedMissing = new Set(["file-input"]);
const catalogPath = path.join(root, "components/common/hoverHelpCatalog.ts");

function loadCatalogKeys() {
  if (!fs.existsSync(catalogPath)) return new Set();
  const source = fs.readFileSync(catalogPath, "utf8");
  const keys = new Set();
  const regex = /"([^"]+)":\s*(?:\{|quickHelp\()/g;
  let match;
  while ((match = regex.exec(source))) keys.add(match[1]);
  return keys;
}

const catalogKeys = loadCatalogKeys();

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(tsx|jsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function getName(name) {
  if (!name) return "";
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return `${getName(name.object)}.${getName(name.property)}`;
  return "";
}

function getAttr(openingElement, attrName) {
  return openingElement.attributes.find(
    (attr) => attr.type === "JSXAttribute" && getName(attr.name) === attrName
  );
}

function hasAttr(openingElement, attrName) {
  return Boolean(getAttr(openingElement, attrName));
}

function getStringAttr(openingElement, attrName) {
  const attr = getAttr(openingElement, attrName);
  if (!attr || !attr.value) return "";
  if (attr.value.type === "StringLiteral") return attr.value.value;
  if (
    attr.value.type === "JSXExpressionContainer" &&
    attr.value.expression.type === "StringLiteral"
  ) {
    return attr.value.expression.value;
  }
  return "";
}

function hasFileButtonClass(openingElement) {
  const className = getStringAttr(openingElement, "className");
  return /\bfile-button\b/.test(className);
}

function isTypeFile(openingElement) {
  return getStringAttr(openingElement, "type") === "file";
}

function containsFieldHelp(node) {
  let found = false;
  visit(node, [], (candidate) => {
    if (found || candidate.type !== "JSXElement") return;
    const name = getName(candidate.openingElement.name);
    if (name === "FieldHelp") found = true;
  });
  return found;
}

function hasInheritedHelp(ancestors) {
  return ancestors.some((ancestor) => {
    if (ancestor.type !== "JSXElement") return false;
    if (getName(ancestor.openingElement.name) !== "label") return false;
    return hasAttr(ancestor.openingElement, "data-help-key") || containsFieldHelp(ancestor);
  });
}

function visit(node, ancestors, onNode) {
  if (!node || typeof node !== "object") return;
  onNode(node, ancestors);
  const nextAncestors = node.type === "JSXElement" ? [...ancestors, node] : ancestors;
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) visit(child, nextAncestors, onNode);
    } else if (value && typeof value === "object") {
      visit(value, nextAncestors, onNode);
    }
  }
}

function auditFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const ast = parser.parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    errorRecovery: true,
  });
  const missing = [];
  const missingCatalog = [];

  visit(ast, [], (node, ancestors) => {
    if (node.type !== "JSXElement") return;
    const opening = node.openingElement;
    const name = getName(opening.name);
    const line = opening.loc?.start.line ?? 0;
    const helpKey = getStringAttr(opening, "data-help-key");
    if (helpKey && catalogKeys.size > 0 && !catalogKeys.has(helpKey)) {
      missingCatalog.push({ file, line, key: helpKey, tag: name, reason: "data-help-key is not in hoverHelpCatalog" });
    }

    if (name === "label" && hasFileButtonClass(opening) && !hasAttr(opening, "data-help-key")) {
      missing.push({ file, line, tag: "label.file-button", reason: "file-button needs data-help-key" });
      return;
    }

    if (!["button", "input", "textarea", "select"].includes(name)) return;
    if (name === "input" && isTypeFile(opening)) return;
    if (hasAttr(opening, "data-help-key")) return;
    if (["input", "textarea", "select"].includes(name) && hasInheritedHelp(ancestors)) return;

    missing.push({ file, line, tag: name, reason: "missing data-help-key or FieldHelp inheritance" });
  });

  return { missing, missingCatalog };
}

const auditResults = walk(root).map(auditFile);
const missing = auditResults.flatMap((result) => result.missing);
const missingCatalog = auditResults.flatMap((result) => result.missingCatalog);

if (missing.length > 0) {
  console.error("Hover help audit failed. Missing coverage:");
  for (const item of missing) {
    const relative = path.relative(path.resolve(__dirname, ".."), item.file);
    console.error(`- ${relative}:${item.line} <${item.tag}> ${item.reason}`);
  }
  process.exit(1);
}

if (missingCatalog.length > 0) {
  console.warn("Hover help audit failed. These controls have keys but no catalog entry:");
  for (const item of missingCatalog.slice(0, 120)) {
    const relative = path.relative(path.resolve(__dirname, ".."), item.file);
    console.warn(`- ${relative}:${item.line} <${item.tag}> ${item.key} ${item.reason}`);
  }
  if (missingCatalog.length > 120) {
    console.warn(`...and ${missingCatalog.length - 120} more catalog warnings.`);
  }
  process.exitCode = 1;
}

if (!process.exitCode) console.log("Hover help audit passed. All scanned interactive controls are covered.");
