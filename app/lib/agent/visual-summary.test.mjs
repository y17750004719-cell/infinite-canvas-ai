import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAgentVisualSummary } from './visual-summary.mjs';

test('visual summaries are bounded and must exactly cover stable reference ids', () => {
  const summary = normalizeAgentVisualSummary({
    version: 1,
    references: [{
      referenceId: 'image:1',
      description: ` ${'x'.repeat(2100)} `,
      salientSubjects: ['subject', 'subject'],
      visibleText: ['TITLE', 'TITLE'],
      ignored: 'drop',
    }],
  }, ['image:1']);
  assert.equal(summary.references[0].description.length, 2000);
  assert.deepEqual(summary.references[0].salientSubjects, ['subject']);
  assert.deepEqual(summary.references[0].visibleText, ['TITLE']);
  assert.equal(summary.references[0].ignored, undefined);
  assert.equal(normalizeAgentVisualSummary(summary, ['image:2']), null);
  assert.equal(normalizeAgentVisualSummary({ ...summary, references: [...summary.references, summary.references[0]] }), null);
});

test('visual summaries reject missing evidence and more than four references', () => {
  assert.equal(normalizeAgentVisualSummary({
    version: 1,
    references: [{ referenceId: 'image:1', description: '', salientSubjects: [], visibleText: [] }],
  }, ['image:1']), null);
  assert.equal(normalizeAgentVisualSummary({
    version: 1,
    references: Array.from({ length: 5 }, (_, index) => ({
      referenceId: `image:${index}`,
      description: 'visible image',
      salientSubjects: [],
      visibleText: [],
    })),
  }), null);
});
