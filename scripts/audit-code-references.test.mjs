import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCodeReferences, readRepositorySources, REFERENCE_AUDIT_EXCEPTIONS } from './audit-code-references.mjs';
import { fileURLToPath } from 'node:url';

const audit = (files) => auditCodeReferences(new Map(Object.entries(files)), { roots: ['app/page.ts'] });

test('reference audit traces named aliases, re-exports and local dependency chains', () => {
  const report = audit({
    'app/page.ts': 'import { alias as call } from "./lib/barrel.mjs"; call();',
    'app/lib/barrel.mjs': 'export { live as alias } from "./helpers.mjs";',
    'app/lib/helpers.mjs': 'export const dependency = () => 1; export function live(){ return dependency(); } export const dead = () => 2;',
  });
  assert.deepEqual(report.unusedFiles, []);
  assert.deepEqual(report.unusedExports.map(x => x.name), ['dead']);
});

test('reference audit follows default exports, star barrels, and conservative namespaces', () => {
  const report = audit({
    'app/page.ts': 'import * as all from "./lib/barrel.mjs"; import start from "./lib/default.mjs"; start(all);',
    'app/lib/barrel.mjs': 'export * from "./helpers.mjs";',
    'app/lib/helpers.mjs': 'export function live(){}; export function possiblyUsed(){};',
    'app/lib/default.mjs': 'export default function start(x){ return x; }',
  });
  assert.deepEqual(report.unusedExports, []);
});

test('reference audit preserves destructuring defaults and computed binding dependencies', () => {
  const report = audit({
    'app/page.ts': 'import { live, key, nested } from "./lib/helpers.mjs"; const { [key()]: result = live(), values: [value = nested()] = [] } = {}; export default [result, value];',
    'app/lib/helpers.mjs': 'export function live(){} export function key(){} export function nested(){}',
  });
  assert.deepEqual(report.unusedFiles, []);
  assert.deepEqual(report.unusedExports, []);
});

test('Next metadata and proxy conventions retain their dependencies as runtime roots', () => {
  const names = ['sitemap', 'robots', 'manifest', 'opengraph-image', 'twitter-image', 'icon', 'apple-icon'];
  const report = auditCodeReferences(new Map([
    ...names.map(name => [`app/${name}.ts`, 'import { urls } from "./lib/urls.mjs"; export default function metadata(){ return urls(); }']),
    ['proxy.ts', 'import { urls } from "./app/lib/urls.mjs"; export function proxy(){ return urls(); }'],
    ['app/lib/urls.mjs', 'export function urls(){ return []; }'],
  ]));
  assert.deepEqual(report.unusedFiles, []);
  assert.deepEqual(report.unusedExports, []);
});

test('reference audit preserves import side effects but distinguishes test-only modules and exports', () => {
  const report = audit({
    'app/page.ts': 'import "./lib/live.mjs";',
    'app/lib/live.mjs': 'function initialize(){}; initialize(); export function unused(){}',
    'app/lib/old.mjs': 'export function legacy(){}',
    'app/lib/old.test.mjs': 'import { legacy } from "./old.mjs"; legacy();',
  });
  assert.deepEqual(report.unusedFiles, [{ file: 'app/lib/old.mjs', testOnly: true }]);
  assert.deepEqual(report.unusedExports.map(x => [x.name, x.testOnly]), [['unused', false], ['legacy', true]]);
});

test('reference audit handles aliases, require, literal imports and URL loading without hiding computed imports', () => {
  const report = audit({
    'app/page.ts': 'import { run } from "@/lib/a.mjs"; run(); require("./lib/b.mjs"); import("./lib/c.mjs"); new URL("./lib/d.mjs", import.meta.url); import(computed);',
    ...Object.fromEntries(['a', 'b', 'c', 'd'].map(name => [`app/lib/${name}.mjs`, 'export function run(){}'])),
  });
  assert.deepEqual(report.unusedFiles, []);
  assert.deepEqual(report.unusedExports, []);
  assert.equal(report.unresolvedDynamicImports.length, 1);
});

test('framework routes and manual CLI tools are roots; type-only imports do not authorize removal of declarations', () => {
  const report = auditCodeReferences(new Map([
    ['app/api/compat/route.ts', 'export function GET(){}'],
    ['scripts/manual.mjs', 'import { run } from "../app/lib/run.mjs"; run();'],
    ['app/lib/run.mjs', 'export function run(){}'],
    ['app/lib/contract.ts', 'export interface Contract { id: string }'],
  ]));
  assert.deepEqual(report.unusedFiles, []);
  assert.deepEqual(report.unusedExports, []);
  assert.deepEqual(report.typeOnlyFiles, ['app/lib/contract.ts']);
});

test('reviewed compatibility exemptions retain only the named export', () => {
  const report = auditCodeReferences(new Map([
    ['app/page.ts', 'export default function Page(){}'],
    ['app/lib/compat.mjs', 'export function supported(){} export function unused(){}'],
  ]), { compatibility: { 'app/lib/compat.mjs#supported': 'Documented public compatibility contract.' } });
  assert.deepEqual(report.unusedFiles, []);
  assert.deepEqual(report.unusedExports.map(item => item.name), ['unused']);
});

test('repository has no unreviewed orphan runtime modules, exports or opaque production imports', () => {
  const report = auditCodeReferences(readRepositorySources(fileURLToPath(new URL('..', import.meta.url))), {
    compatibility: REFERENCE_AUDIT_EXCEPTIONS,
  });
  assert.deepEqual(report.unusedFiles, []);
  assert.deepEqual(report.unusedExports, []);
  assert.deepEqual(report.unresolvedDynamicImports, []);
  // New candidates require review; the checker never edits or deletes source.
});
