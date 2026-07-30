import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMultimodalReferenceParts, countMultimodalReferenceImages } from './multimodal-reference-context.mjs';

test('multimodal reference parts preserve inline text and reference order', () => {
  const context = {
    references: [
      { id: 'target', src: 'https://example.test/target.png', label: 'Target', source: 'canvas', role: 'reference' },
      { id: 'style', src: 'https://example.test/style.png', label: 'Style', source: 'upload', role: 'reference' },
    ],
    composerSegments: [
      { type: 'text', text: '把' },
      { type: 'reference', referenceId: 'target' },
      { type: 'text', text: '做成' },
      { type: 'reference', referenceId: 'style' },
      { type: 'text', text: '的风格' },
    ],
  };
  const parts = buildMultimodalReferenceParts(context);
  assert.deepEqual(parts.filter((part) => part.type === 'image_url').map((part) => part.image_url.url), [
    'https://example.test/target.png',
    'https://example.test/style.png',
  ]);
  assert.match(parts[1].text, /Reference ID: target/);
  assert.match(parts[4].text, /Reference ID: style/);
  assert.equal(countMultimodalReferenceImages(context), 2);
});

test('annotation composites are emitted as non-selectable evidence after their parent image', () => {
  const parts = buildMultimodalReferenceParts({
    references: [{
      id: 'annotated',
      src: 'https://example.test/original.png',
      label: 'Annotated image',
      source: 'canvas',
      role: 'annotation_bundle',
      annotationCount: 3,
    }],
    composerSegments: [{ type: 'reference', referenceId: 'annotated' }],
    evidenceImages: [{
      id: 'annotated:preview',
      referenceId: 'annotated',
      src: 'https://example.test/preview.png',
      kind: 'annotation_composite',
    }],
  });
  assert.deepEqual(parts.filter((part) => part.type === 'image_url').map((part) => part.image_url.url), [
    'https://example.test/original.png',
    'https://example.test/preview.png',
  ]);
  assert.match(parts[2].text, /not an independent reference/i);
  assert.match(parts[2].text, /never be selected as targetReferenceId/i);
});

test('confirmed region crops follow their parent and pending region targets never reach the model', () => {
  const parts = buildMultimodalReferenceParts({
    references: [
      { id: 'pending', src: 'https://example.test/pending.png', label: 'Pending', source: 'canvas', role: 'region_target' },
      {
        id: 'region',
        src: 'https://example.test/original.png',
        label: '左侧老虎',
        source: 'canvas',
        role: 'region_target',
        confirmationStatus: 'confirmed',
        aliases: ['左虎'],
        description: '画面左侧戴墨镜的老虎',
        confidence: 'high',
      },
    ],
    composerSegments: [{ type: 'reference', referenceId: 'pending' }, { type: 'reference', referenceId: 'region' }],
    evidenceImages: [{ id: 'region:crop', referenceId: 'region', src: 'https://example.test/crop.png', kind: 'region_crop' }],
  });
  assert.deepEqual(parts.filter((part) => part.type === 'image_url').map((part) => part.image_url.url), [
    'https://example.test/original.png',
    'https://example.test/crop.png',
  ]);
  assert.match(parts[0].text, /Candidate aliases: 左虎/);
  assert.match(parts[2].text, /Region crop evidence image/);
  assert.match(parts[2].text, /never be selected as targetReferenceId/i);
});

test('identical image sources are sent once while retaining both reference ids', () => {
  const parts = buildMultimodalReferenceParts({
    references: [
      { id: 'first', src: 'https://example.test/shared.png', label: 'First', source: 'upload', role: 'reference' },
      { id: 'second', src: 'https://example.test/shared.png', label: 'Second', source: 'history', role: 'reference' },
    ],
    composerSegments: [
      { type: 'reference', referenceId: 'first' },
      { type: 'reference', referenceId: 'second' },
    ],
  });
  assert.equal(parts.filter((part) => part.type === 'image_url').length, 1);
  assert.ok(parts.some((part) => part.type === 'text' && /Reference ID: second/.test(part.text)));
  assert.ok(parts.some((part) => part.type === 'text' && /pixels are identical to reference first/i.test(part.text)));
});
