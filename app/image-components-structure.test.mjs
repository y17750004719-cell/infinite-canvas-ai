import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const files = [
  './page.tsx',
  './components/workspace/GalleryView.tsx',
  './workspaces/page.tsx',
  './workspaces/[id]/page.tsx',
];

for (const relativePath of files) {
  test(`${relativePath} uses next/image instead of raw img tags`, () => {
    const filePath = fileURLToPath(new URL(relativePath, import.meta.url));
    const source = fs.readFileSync(filePath, 'utf8');

    assert.equal(source.includes("import Image from 'next/image';"), true);
    assert.equal(source.includes('<img'), false);
  });
}
