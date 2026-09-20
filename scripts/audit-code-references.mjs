import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Narrow, reviewed exceptions, not a blanket exemption for test-only exports.
export const REFERENCE_AUDIT_EXCEPTIONS = {
  'app/lib/api-client.ts#AVAILABLE_MODELS': 'Explicit legacy compatibility export; keep the documented consumer contract.',
  'app/lib/image-model-capabilities.mjs#IMAGE_MODEL_CAPABILITIES': 'Explicit compatibility shape; model capabilities now resolve through the provider registry.',
  'app/lib/api-security.mjs#resolvePublicAssetDataUrl': 'Historical public-image decoding boundary; preserve legacy image reads and path-safety tests.',
  'app/lib/local-assets.mjs#resolveLocalAssetDataUrl': 'Historical runtime/public-image decoding boundary; preserve legacy image reads and path-safety tests.',
  'app/lib/compatibility-gate.mjs#assertCurrentContract': 'Retained migration rejection contract, explicitly protected by the cleanup scope; currently test-consumed.',
  'app/lib/agent/native-business-ledger.mjs#readNativeBusinessOperation': 'Read-only durable-ledger audit boundary used by exactly-once and unknown-outcome regression tests, not a live runtime caller.',
};

const codeFile = /\.(?:[cm]?js|[jt]sx?)$/;
const testFile = /\.(?:test|spec)\./;
const frameworkEntry = /(?:^|\/)(?:page|layout|route|loading|error|global-error|not-found|template|default|middleware|proxy|instrumentation|instrumentation-client|sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\.[jt]sx?$/;
const generated = (file) => file.includes('/native-codex-protocol/');
const valueDeclaration = (node) => ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node);
const identifiers = (node) => {
  const names = new Set();
  const visit = (entry) => {
    if (ts.isIdentifier(entry)) names.add(entry.text);
    ts.forEachChild(entry, visit);
  };
  if (node) visit(node);
  return names;
};
const bindingNames = (node) => ts.isIdentifier(node) ? [node.text]
  : node.elements.flatMap((element) => ts.isBindingElement(element) ? bindingNames(element.name) : []);

/** Read-only, conservative source audit. Candidates are review evidence, never deletion instructions.
 * Namespace use retains every export; identifier shadowing can also over-retain.
 * Computed imports are reported explicitly because static reachability cannot prove them safe.
 */
export function auditCodeReferences(files, { roots, compatibility = {} } = {}) {
  const modules = new Map();
  const resolve = (from, specifier) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
    const base = specifier.startsWith('@/') ? `app/${specifier.slice(2)}` : path.posix.join(path.posix.dirname(from), specifier);
    return [base, ...['.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx', '/index.mjs', '/index.js'].map(ext => base + ext), base.replace(/\.js$/, '.ts')]
      .find(candidate => files.has(candidate)) || null;
  };
  for (const [file, content] of files) {
    const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const typeOnly = ast.statements.every(node => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
      || (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)
      || (ts.isExportDeclaration(node) && node.isTypeOnly));
    const info = { typeOnly, imports: new Map(), exports: new Map(), stars: [], definitions: new Map(), effects: new Set(), edges: new Set(), opaque: new Set(), dynamic: [] };
    modules.set(file, info);
    for (const statement of ast.statements) {
      const exported = statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
      const defaultExport = statement.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
      const define = (name, node, effect = false) => {
        const deps = identifiers(node);
        deps.delete(name);
        info.definitions.set(name, deps);
        if (exported) info.exports.set(defaultExport ? 'default' : name, { local: name });
        if (effect) for (const dep of deps) info.effects.add(dep);
      };
      if (ts.isImportDeclaration(statement)) {
        if (statement.importClause?.isTypeOnly) continue;
        const target = resolve(file, statement.moduleSpecifier.text);
        if (!target) continue;
        info.edges.add(target);
        const clause = statement.importClause;
        if (clause?.name) info.imports.set(clause.name.text, { target, name: 'default' });
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) info.imports.set(bindings.name.text, { target, name: '*' });
        if (bindings && ts.isNamedImports(bindings)) for (const spec of bindings.elements) {
          if (!spec.isTypeOnly) info.imports.set(spec.name.text, { target, name: spec.propertyName?.text || spec.name.text });
        }
      } else if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly) continue;
        const target = statement.moduleSpecifier ? resolve(file, statement.moduleSpecifier.text) : null;
        if (target) info.edges.add(target);
        if (!statement.exportClause && target) info.stars.push(target);
        else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const spec of statement.exportClause.elements) if (!spec.isTypeOnly) {
            info.exports.set(spec.name.text, target
              ? { target, name: spec.propertyName?.text || spec.name.text }
              : { local: spec.propertyName?.text || spec.name.text });
          }
        } else if (target && statement.exportClause) info.exports.set(statement.exportClause.name.text, { target, name: '*' });
      } else if (ts.isExportAssignment(statement)) {
        info.exports.set('default', { local: '__default' });
        info.definitions.set('__default', identifiers(statement.expression));
        for (const dep of identifiers(statement.expression)) info.effects.add(dep);
      } else if (valueDeclaration(statement)) {
        const name = statement.name?.text || '__default';
        define(name, statement, ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement));
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const deferred = declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer));
          // Destructuring defaults and computed binding keys can execute too.
          for (const name of bindingNames(declaration.name)) define(name, declaration, !deferred);
        }
      } else if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) {
        for (const dep of identifiers(statement)) info.effects.add(dep);
      }
    }
    const visit = (node) => {
      const call = ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require');
      const url = ts.isNewExpression(node) && node.expression.getText(ast) === 'URL';
      if (call || url) {
        const argument = node.arguments?.[0];
        if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
          const target = resolve(file, argument.text);
          if (target) { info.edges.add(target); info.opaque.add(target); }
        } else if (call) info.dynamic.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, expression: node.getText(ast).slice(0, 160) });
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  const walk = (entries) => {
    const reached = new Set(), used = new Set(), exported = new Set();
    const markExport = (file, name) => {
      const key = `${file}#${name}`;
      if (exported.has(key)) return;
      exported.add(key);
      activate(file);
      const info = modules.get(file);
      if (!info) return;
      if (name === '*') { for (const key of info.exports.keys()) markExport(file, key); for (const target of info.stars) markExport(target, '*'); return; }
      const entry = info.exports.get(name);
      if (entry?.local) markLocal(file, entry.local);
      else if (entry?.target) markExport(entry.target, entry.name);
      else for (const target of info.stars) markExport(target, name);
    };
    const markLocal = (file, name) => {
      const key = `${file}#${name}`;
      if (used.has(key)) return;
      used.add(key);
      const info = modules.get(file);
      const imported = info?.imports.get(name);
      if (imported) markExport(imported.target, imported.name);
      else for (const dep of info?.definitions.get(name) || []) markLocal(file, dep);
    };
    const activate = (file) => {
      if (reached.has(file)) return;
      reached.add(file);
      const info = modules.get(file);
      if (!info) return;
      for (const target of info.edges) activate(target);
      for (const dep of info.effects) markLocal(file, dep);
      for (const target of info.opaque) markExport(target, '*');
    };
    for (const file of entries) markExport(file, '*');
    for (const key of Object.keys(compatibility)) {
      const [file, name] = key.split('#');
      markExport(file, name);
    }
    return { reached, used, exported };
  };
  const entries = roots || [...files.keys()].filter(file => !testFile.test(file) && (
    frameworkEntry.test(file) || file.startsWith('scripts/') || !file.includes('/')
  ));
  const production = walk(entries);
  const tests = walk([...files.keys()].filter(file => testFile.test(file)));
  const unusedFiles = [], unusedExports = [], unresolvedDynamicImports = [], typeOnlyFiles = [];
  for (const [file, info] of modules) {
    if (testFile.test(file) || generated(file) || file.endsWith('.d.ts')) continue;
    // Runtime reachability cannot classify type contracts. TypeScript owns these.
    if (info.typeOnly) { typeOnlyFiles.push(file); continue; }
    if (production.reached.has(file)) unresolvedDynamicImports.push(...info.dynamic);
    else unusedFiles.push({ file, testOnly: tests.reached.has(file) });
    if (!file.startsWith('app/lib/') || generated(file)) continue;
    for (const [name, entry] of info.exports) {
      if (production.exported.has(`${file}#${name}`) || (entry.local && production.used.has(`${file}#${entry.local}`))) continue;
      unusedExports.push({ file, name, testOnly: tests.exported.has(`${file}#${name}`) || (entry.local && tests.used.has(`${file}#${entry.local}`)) || false });
    }
  }
  return { sourceFiles: files.size, entrypoints: entries, unusedFiles, unusedExports, unresolvedDynamicImports, typeOnlyFiles, compatibility };
}

export function readRepositorySources(root) {
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) { if (!generated(`${file}/`)) visit(file); }
      else if (codeFile.test(file) && !file.endsWith('.d.ts')) files.set(file, readFileSync(path.join(root, file), 'utf8'));
    }
  };
  visit('app'); visit('scripts');
  for (const file of readdirSync(root)) if (codeFile.test(file) && !file.endsWith('.d.ts')) files.set(file, readFileSync(path.join(root, file), 'utf8'));
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  console.log(JSON.stringify(auditCodeReferences(readRepositorySources(root), {
    compatibility: REFERENCE_AUDIT_EXCEPTIONS,
  }), null, 2));
}
