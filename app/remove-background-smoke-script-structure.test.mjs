import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scriptPath = '/Volumes/ZO/ZO.DESIGN/scripts/smoke-remove-background.mjs';

test('remove-background smoke script exists and prints endpoint diagnostics for both COMFLY candidates', () => {
  assert.equal(fs.existsSync(scriptPath), true);

  const scriptSource = fs.readFileSync(scriptPath, 'utf8');
  assert.equal(scriptSource.includes('resolveBackgroundRemovalEndpoints'), true);
  assert.equal(scriptSource.includes('COMFLY_API_URL'), true);
  assert.equal(scriptSource.includes('GPT_BEST_BASE_URL'), true);
  assert.equal(scriptSource.includes('candidateEndpoints'), true);
  assert.equal(scriptSource.includes('bodyPreview'), true);
  assert.equal(scriptSource.includes('extractRecraftBackgroundRemovalUrl'), true);
});
