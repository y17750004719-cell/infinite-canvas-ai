import test from 'node:test';
import assert from 'node:assert/strict';

import { collectSessionDiagnostics, estimateStructuredValueBytes } from './session-diagnostics.mjs';

test('session diagnostics estimates large image strings without serializing the full session', () => {
  const shared = `data:image/png;base64,${'A'.repeat(2048)}`;
  const value = { first: shared, nested: { second: shared } };
  value.self = value;
  const diagnostics = estimateStructuredValueBytes(value);
  assert.equal(diagnostics.dataUrlCount, 2);
  assert.ok(diagnostics.dataUrlBytes >= shared.length * 4);
  assert.equal(diagnostics.truncated, false);
});

test('session diagnostics reports message and canonical reference counts', () => {
  const diagnostics = collectSessionDiagnostics({
    items: [{ id: 'image-1' }],
    messages: [{ referenceContext: { references: [{ id: 'photo', src: '/photo.png' }] } }],
  });
  assert.equal(diagnostics.messageCount, 1);
  assert.equal(diagnostics.referenceCount, 1);
  assert.equal(diagnostics.canvasItemCount, 1);
});
