"use strict";
// Cross-language disclosure contract against the real Editor/Runtime parser.
// Python AST reads only literals: never imports the app, opens a DB or calls a model.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process"), { test } = require("node:test");
const root = path.resolve(__dirname, "..");
const { buildSync } = require("../editor/node_modules/esbuild");
const result = spawnSync("python", ["-c",
  "import ast,json,sys; tree=ast.parse(open(sys.argv[1],encoding='utf-8').read()); " +
  "values=[ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) " +
  "and any(isinstance(t,ast.Name) and t.id=='ASSISTANT_COMPONENT_MARKUP_PROTOCOL' for t in n.targets)]; " +
  "print(json.dumps(values[0] if values else None))",
  path.join(root, "backend/app/api/routes_assistant.py")],
{ encoding: "utf8", windowsHide: true, timeout: 20000 });
assert.equal(result.status, 0, result.stderr);
const protocol = JSON.parse(result.stdout);
const source = buildSync({ stdin: { resolveDir: root, loader: "ts", contents:
  'export {parseCustomComponentMarkup} from "./shared/cartridge/customComponentMarkup"; export {validateCustomComponentDefinition} from "./shared/cartridge/customComponent";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
const m = { exports: {} }; new Function("module", "exports", source)(m, m.exports);
const { parseCustomComponentMarkup: parse, validateCustomComponentDefinition: validate } = m.exports;
function requireProtocol() {
  assert(protocol && protocol.version === 1,
    "Creation Agent must receive the complete supported markup protocol, not only a generic safe-subset claim");
  return protocol;
}
test("creation disclosure includes the actual classes, attributes, CSS and bounded example", () => {
  const p = requireProtocol();
  for (const name of ["tags", "classes", "attributes", "actions", "bindings", "css_values", "example"])
    assert(p[name] && Object.keys(p[name]).length > 0, name);
  assert.equal(p.limits.max_tool_calls, 12);
  assert.equal(p.limits.max_markup_characters, 32000);
  assert(p.exclusions.includes("alt") && p.exclusions.includes("box-sizing"));
  assert(p.exclusions.includes("background") && p.exclusions.includes("descendant selectors"));
});
test("every disclosed class, action and binding is accepted by both real safety boundaries", () => {
  const p = requireProtocol();
  const check = html => {
    const r = parse(html, ""); assert(r.ok, r.issues.join("; "));
    assert.deepEqual(validate(r.component), []);
  };
  for (const c of p.classes) check(`<div class="root"><span class="${c}">文字</span></div>`);
  for (const tag of p.tags) {
    const attrs = tag === "button" ? ' data-action="open_help"' : tag === "img" ? ' data-asset="authorized-image"' : "";
    check(`<div class="root"><${tag}${attrs}>${tag === "img" ? "" : "内容"}</${tag}>`.replace("</img>", "") + "</div>");
  }
  for (const a of p.actions) check(`<div class="root"><button data-action="${a}">按钮</button></div>`);
  for (const b of p.bindings) check(`<div class="root"><span data-bind="${b}"></span></div>`);
});
test("all advertised CSS values and image-card example survive real parsing and serialized Runtime validation", () => {
  const p = requireProtocol();
  for (const [property, values] of Object.entries(p.css_values)) {
    assert(values.length > 0, property);
    for (const value of values) {
      const r = parse('<div class="root"><span>正文</span></div>', `.root { ${property}: ${value}; }`);
      assert(r.ok, `${property}: ${value}: ${r.issues.join("; ")}`);
      assert.deepEqual(validate(JSON.parse(JSON.stringify(r.component))), []);
    }
  }
  const r = parse(p.example.html, p.example.css);
  assert(r.ok, r.issues.join("; ")); assert.deepEqual(validate(r.component), []);
  assert(r.component.root.children.some(n => n.tag === "img" && n.assetId === "AUTHORIZED_IMAGE_ALIAS"));
  assert(r.component.root.children.some(n => n.tag === "button" && n.action === "open_about"));
});
test("live-model rejected patterns remain rejected; disclosure never expands executable capabilities", () => {
  requireProtocol();
  for (const [html, css, issue] of [
    ['<div class="root"><img data-asset="ok" alt="徽章" /></div>', "", /alt/],
    ['<div class="root"><img data-asset="ok" width="32" height="32" /></div>', "", /width|height/],
    ['<div class="root"><span class="badge">标题</span></div>', "", /badge/],
    ['<div class="root"></div>', ".root img { width: 32px; }", /root img/],
    ['<div class="root"></div>', ".root { background: #2b2b2b; box-sizing: border-box; }", /background|box-sizing/],
    ['<div class="root"><script>bad()</script></div>', "", /script/],
    ['<div class="root"><img src="https://example.invalid/a.png" /></div>', "", /src/],
    ['<div class="root"></div>', ".root { color: var(--secret); }", /var/],
  ]) {
    const r = parse(html, css); assert.equal(r.ok, false);
    assert.match(r.issues.join(" "), issue);
  }
});
