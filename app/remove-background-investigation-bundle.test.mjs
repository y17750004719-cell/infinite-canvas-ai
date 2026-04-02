import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reportPath = '/Volumes/ZO/ZO.DESIGN/docs/remove-background/2026-04-02-comfly-root-cause.md';
const smokePath = '/Volumes/ZO/ZO.DESIGN/docs/remove-background/2026-04-02-comfly-smoke-results.json';

test('remove-background investigation bundle includes a markdown report with the baseline COMFLY evidence', () => {
  assert.equal(fs.existsSync(reportPath), true);

  const report = fs.readFileSync(reportPath, 'utf8');
  assert.equal(report.includes('/recraft/v1/images/removeBackground'), true);
  assert.equal(report.includes('custom_router_error'), true);
  assert.equal(report.includes('unknown error'), true);
  assert.equal(report.includes('1024x1024'), true);
  assert.equal(report.includes('1224000'), true);
  assert.equal(report.includes('curl'), true);
  assert.equal(report.includes('https://ai.comfly.chat/v1/recraft/v1/images/removeBackground'), true);
  assert.equal(report.includes('404'), true);
  assert.equal(report.includes('2026-04-02 10:43'), true);
});

test('remove-background investigation bundle includes captured smoke results for the documented and incorrect candidate paths', () => {
  assert.equal(fs.existsSync(smokePath), true);

  const smokePayload = JSON.parse(fs.readFileSync(smokePath, 'utf8'));
  assert.equal(smokePayload.runtimeEndpoint, 'https://ai.comfly.chat/recraft/v1/images/removeBackground');
  assert.deepEqual(smokePayload.candidateEndpoints, [
    'https://ai.comfly.chat/recraft/v1/images/removeBackground',
    'https://ai.comfly.chat/v1/recraft/v1/images/removeBackground',
  ]);
  assert.equal(smokePayload.results[0].status, 500);
  assert.equal(smokePayload.results[0].bodyPreview.includes('custom_router_error'), true);
  assert.equal(smokePayload.results[1].status, 404);
  assert.equal(smokePayload.results[1].bodyPreview.includes('Invalid URL'), true);
});
