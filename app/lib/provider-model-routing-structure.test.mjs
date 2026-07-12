import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const agentSource = fs.readFileSync(path.join(root, 'app/api/agent/route.ts'), 'utf8');
const generateSource = fs.readFileSync(path.join(root, 'app/api/generate/route.ts'), 'utf8');
const skillJobsSource = fs.readFileSync(path.join(root, 'app/lib/skill-jobs.ts'), 'utf8');

test('agent routes user-selected chat and image models independently', () => {
  assert.match(agentSource, /chatOptions\?:\s*\{/);
  assert.match(agentSource, /resolveProviderModelSelection/);
  assert.match(agentSource, /purpose:\s*'chat'/);
  assert.match(agentSource, /providerId:\s*resolvedChatSelection\.providerId/);
  assert.match(agentSource, /model:\s*resolvedChatSelection\.model/);
  assert.match(agentSource, /requestedProviderId:\s*body\.chatOptions\?\.providerId/);
  assert.match(agentSource, /providerId:\s*resolvedChatSelection\.providerId\s*\|\|\s*undefined/);
  assert.match(agentSource, /referenceImages:\s*body\.referenceImages/);
  assert.match(agentSource, /imageOptions:\s*body\.imageOptions\s*\?\s*structuredClone/);
  assert.match(agentSource, /generateImagePayload\([\s\S]{0,240}confirmationRecord\.imageOptions/);
  assert.match(agentSource, /generateImagePayload\([\s\S]{0,320}confirmationRecord\.referenceImages/);
});

test('generate route resolves a valid provider and model pair for each purpose', () => {
  assert.match(generateSource, /resolveProviderModelSelection/);
  assert.match(generateSource, /purpose:\s*"image"/);
  assert.match(generateSource, /purpose:\s*"chat"/);
  assert.match(generateSource, /providerId:\s*resolvedImageSelection\.providerId/);
  assert.match(generateSource, /providerId:\s*resolvedChatSelection\.providerId/);
  assert.match(generateSource, /hasRequestedChatSelection\s*=\s*Boolean/);
  assert.match(generateSource, /hasRequestedImageSelection\s*=\s*Boolean/);
});

test('agent validates default environment and request chat selections through one resolver', () => {
  assert.match(agentSource, /const resolvedChatSelection = resolveProviderModelSelection\(\{/);
  assert.match(agentSource, /requestedProviderId:\s*body\.chatOptions\?\.providerId\s*\|\|\s*process\.env\.AGENT_CHAT_PROVIDER_ID/);
  assert.match(agentSource, /requestedModel:\s*requestedChatModel/);
  assert.doesNotMatch(agentSource, /const resolvedChatSelection = hasRequestedChatSelection/);
});

test('skill jobs persist and execute with the revalidated image selection', () => {
  assert.match(skillJobsSource, /providerId:\s*normalizeOptionalText\(payload\.providerId\)/);
  assert.match(skillJobsSource, /model:\s*normalizeOptionalText\(payload\.model\)/);
  assert.match(skillJobsSource, /readProviderRegistry/);
  assert.match(skillJobsSource, /resolveProviderModelSelection/);
  assert.match(skillJobsSource, /job\.metadata\.providerId\s*=\s*selection\.providerId/);
  assert.match(skillJobsSource, /providerId:\s*selection\.providerId/);
  assert.match(skillJobsSource, /model:\s*selection\.model/);
});
