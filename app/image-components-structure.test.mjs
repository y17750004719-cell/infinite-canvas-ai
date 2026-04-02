import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = [
  '/Volumes/ZO/ZO.DESIGN/app/page.tsx',
  '/Volumes/ZO/ZO.DESIGN/app/components/workspace/GalleryView.tsx',
  '/Volumes/ZO/ZO.DESIGN/app/workspaces/page.tsx',
  '/Volumes/ZO/ZO.DESIGN/app/workspaces/[id]/page.tsx',
];

for (const filePath of files) {
  test(`${filePath} uses next/image instead of raw img tags`, () => {
    const source = fs.readFileSync(filePath, 'utf8');

    assert.equal(source.includes("import Image from 'next/image';"), true);
    assert.equal(source.includes('<img'), false);
  });
}
