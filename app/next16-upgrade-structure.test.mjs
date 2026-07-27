import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const readProjectFile = (relativePath) =>
  fs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');

const packageJson = JSON.parse(readProjectFile('package.json'));
const nextConfigSource = readProjectFile('next.config.js');
const eslintConfigSource = readProjectFile('eslint.config.mjs');

test('framework and runtime versions are pinned for the Next.js 16 upgrade', () => {
  assert.equal(packageJson.engines.node, '>=24 <25');
  assert.equal(packageJson.dependencies.next, '16.2.10');
  assert.equal(packageJson.dependencies.react, '19.2.7');
  assert.equal(packageJson.dependencies['react-dom'], '19.2.7');
  assert.equal(packageJson.devDependencies['eslint-config-next'], '16.2.10');
  assert.equal(packageJson.devDependencies.eslint, '9.39.5');
  assert.equal(packageJson.overrides.postcss, '$postcss');
  assert.equal(packageJson.overrides['brace-expansion@1.1.12'], '1.1.13');
  assert.equal(packageJson.overrides['picomatch@2.3.1'], '2.3.2');
  assert.equal(packageJson.overrides['picomatch@4.0.3'], '4.0.5');
});

test('quality scripts use ESLint CLI, Next typegen, tests, and Turbopack build defaults', () => {
  assert.equal(packageJson.scripts.lint, 'eslint app');
  assert.equal(packageJson.scripts.typecheck, 'next typegen && tsc --noEmit');
  assert.equal(packageJson.scripts.check, 'npm run lint && npm run typecheck && npm test && npm run build');
  assert.equal(packageJson.scripts.lint.includes('next lint'), false);
  assert.equal(packageJson.scripts.build.includes('--webpack'), false);
});

test('Next config no longer carries wildcard image access or a webpack-only canvas external', () => {
  assert.equal(nextConfigSource.includes('remotePatterns'), false);
  assert.equal(nextConfigSource.includes('hostname: "**"'), false);
  assert.equal(nextConfigSource.includes('webpack:'), false);
  assert.equal(nextConfigSource.includes('canvas'), false);
  assert.equal(nextConfigSource.includes('outputFileTracingExcludes'), true);
  assert.equal(nextConfigSource.includes("'/*': ['next.config.js']"), true);
});

test('ESLint uses the Next.js flat core-web-vitals configuration', () => {
  assert.equal(eslintConfigSource.includes("eslint-config-next/core-web-vitals"), true);
  assert.equal(eslintConfigSource.includes('...nextVitals'), true);
});
