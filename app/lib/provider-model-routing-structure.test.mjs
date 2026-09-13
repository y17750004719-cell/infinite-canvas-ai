import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const agentSource = fs.readFileSync(path.join(root, 'app/lib/agent/agent-request-runtime.ts'), 'utf8');
const contextSource = fs.readFileSync(path.join(root, 'app/lib/agent/agent-context-service.mjs'), 'utf8');
const combinedAgentSource = `${agentSource}\n${contextSource}`;
const generateSource = fs.readFileSync(path.join(root, 'app/api/generate/route.ts'), 'utf8');

test('agent routes user-selected chat and image models independently', () => {
  const agentSource = combinedAgentSource;
  assert.match(agentSource, /chatOptions\?:\s*\{/);
  assert.match(agentSource, /resolveProviderModelSelection/);
  assert.match(agentSource, /purpose:\s*'chat'/);
  assert.match(agentSource, /providerId:\s*resolvedChatSelection\.providerId/);
  assert.match(agentSource, /model:\s*resolvedChatSelection\.model/);
  assert.match(agentSource, /requestedProviderId:\s*requestedChatProviderId/);
  assert.match(agentSource, /providerId:\s*resolvedChatSelection\.providerId(?:\s*\|\|\s*undefined)?/);
  assert.match(agentSource, /referenceImages:\s*executionReferenceImages/);
  assert.match(agentSource, /imageOptions:\s*body\.imageOptions/);
  assert.match(agentSource, /requestedImageCount/);
  assert.match(agentSource, /imageOptions:\s*body\.imageOptions/);
  assert.match(agentSource, /referenceImages:\s*\[\.\.\.executionReferenceImages\]/);
});

test('generate route resolves a valid provider and model pair for each purpose', () => {
  assert.match(generateSource, /resolveProviderModelSelection/);
  assert.match(generateSource, /purpose:\s*"image"/);
  assert.match(generateSource, /purpose:\s*"chat"/);
  assert.match(generateSource, /providerId:\s*resolvedImageSelection\.providerId/);
  assert.match(generateSource, /providerId:\s*resolvedChatSelection\.providerId/);
  assert.match(generateSource, /hasRequestedImageSelection\s*=\s*Boolean/);
  assert.match(generateSource, /const resolvedChatSelection = resolveProviderModelSelection\(\{/);
  assert.match(generateSource, /requestedProviderId:\s*requestedChatProviderId/);
  assert.match(generateSource, /requestedModel:\s*model/);
  assert.doesNotMatch(generateSource, /legacyChatModel|AGENT_MODEL/);
});

test('agent validates default environment and request chat selections through one resolver', () => {
  const agentSource = combinedAgentSource;
  assert.match(agentSource, /const resolvedChatSelection = resolveProviderModelSelection\(\{/);
  assert.match(agentSource, /const requestedChatProviderId = body\.chatOptions\?\.providerId\s*\|\|\s*process\.env\.AGENT_CHAT_PROVIDER_ID/);
  assert.match(agentSource, /requestedModel:\s*requestedChatModel/);
  assert.match(agentSource, /const requestedChatModel = body\.chatOptions\?\.model \|\| process\.env\.AGENT_CHAT_MODEL \|\| undefined/);
  assert.doesNotMatch(agentSource, /DEFAULT_AGENT_MODEL|gemini-3\.1-flash-lite-preview-thinking-medium/);
  assert.doesNotMatch(agentSource, /const resolvedChatSelection = hasRequestedChatSelection/);
});

test('agent sends reference-image requests to the selected model without local vision gating or fallback', () => {
  const agentSource = combinedAgentSource;
  assert.match(agentSource, /allowFallback:\s*!hasExplicitChatSelection/);
  assert.doesNotMatch(agentSource, /resolvedChatCapabilities\.supportsVision/);
  assert.doesNotMatch(agentSource, /不支持参考图输入，请切换支持视觉的规划模型/);
});
