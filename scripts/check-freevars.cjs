// Free-variable checker for extracted components/modules.
//
//   node scripts/check-freevars.cjs src/panels/SomeModal.js
//
// Transforms JSX with esbuild, parses with acorn, and reports identifiers that
// are REFERENCED but never bound (params/locals/imports) — i.e. things that
// must be props or imports. A clean extraction prints "(none)". This is the
// check that made the 600-line DashboardModal extraction safe: it proves no
// closure variable was forgotten when a block is moved out of App.js/main.js.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const esbuild = require(path.join(ROOT, "node_modules", "esbuild"));
const acorn = require(path.join(ROOT, "node_modules", "acorn"));

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/check-freevars.cjs <file.js>"); process.exit(2); }

const src = fs.readFileSync(file, "utf8");
const js = esbuild.transformSync(src, { loader: "jsx", format: "esm" }).code;
const ast = acorn.parse(js, { ecmaVersion: "latest", sourceType: "module" });

const bound = new Set();
const refs = new Set();

function collectPattern(node) {
  if (!node || typeof node !== "object") return;
  switch (node.type) {
    case "Identifier": bound.add(node.name); break;
    case "ObjectPattern": node.properties.forEach(p => collectPattern(p.value || p.argument || p)); break;
    case "ArrayPattern": node.elements.forEach(e => e && collectPattern(e)); break;
    case "AssignmentPattern": collectPattern(node.left); break;
    case "RestElement": collectPattern(node.argument); break;
    case "Property": collectPattern(node.value); break;
    default: break;
  }
}

function isRef(node, parent, key) {
  if (!parent) return true;
  if (parent.type === "MemberExpression" && key === "property" && !parent.computed) return false;
  if (parent.type === "Property" && key === "key" && !parent.computed && !parent.shorthand) return false;
  if (parent.type === "MethodDefinition" && key === "key" && !parent.computed) return false;
  if (parent.type === "ImportSpecifier" && key === "imported") return false;
  if ((parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") && key === "label") return false;
  return true;
}

function walk(node, parent, key) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, parent, key)); return; }
  if (typeof node.type !== "string") return;
  switch (node.type) {
    case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression":
      if (node.id) bound.add(node.id.name);
      node.params.forEach(collectPattern);
      break;
    case "VariableDeclarator": collectPattern(node.id); break;
    case "ClassDeclaration": case "ClassExpression": if (node.id) bound.add(node.id.name); break;
    case "ImportDefaultSpecifier": case "ImportNamespaceSpecifier": case "ImportSpecifier": bound.add(node.local.name); break;
    case "CatchClause": if (node.param) collectPattern(node.param); break;
    default: break;
  }
  if (node.type === "Identifier" && isRef(node, parent, key)) refs.add(node.name);
  for (const k of Object.keys(node)) {
    if (["type", "start", "end", "loc", "range"].includes(k)) continue;
    walk(node[k], node, k);
  }
}
walk(ast, null, null);

const GLOBALS = new Set([
  "React", "window", "document", "Math", "Object", "Array", "JSON", "Number", "String",
  "Boolean", "Set", "Map", "Infinity", "NaN", "undefined", "null", "console", "Date",
  "Promise", "parseInt", "parseFloat", "isNaN", "isFinite", "Symbol", "RegExp", "Error",
  "alert", "confirm", "prompt", "fetch", "setTimeout", "clearTimeout", "setInterval",
  "clearInterval", "requestAnimationFrame", "localStorage", "navigator", "URL", "Intl",
  "Reflect", "Proxy", "WeakMap", "WeakSet", "createPortal", "arguments", "globalThis",
  "structuredClone", "atob", "btoa", "TextEncoder", "TextDecoder", "Buffer", "process",
  "require", "module", "exports", "__dirname", "__filename", "global", "queueMicrotask",
  "default", // esbuild lowers `export default` to a token acorn reads as this
]);

const free = [...refs].filter(n => !bound.has(n) && !GLOBALS.has(n)).sort();
console.log(`${file}: ${free.length} free identifier(s)`);
console.log(free.length ? "  " + free.join(", ") : "  (none)");
process.exit(free.length ? 1 : 0);
