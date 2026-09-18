import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const agentSource = fs.readFileSync(path.join(root, 'app/lib/agent/agent-request-runtime.ts'), 'utf8');
const contextSource = fs.readFileSync(path.join(root, 'app/lib/agent/agent-context-service.mjs'), 'utf8');
const skillProviderSource = fs.readFileSync(path.join(root, 'app/lib/agent/agent-skill-provider-service.mjs'), 'utf8');
const combinedAgentSource = `${agentSource}\n${contextSource}\n${skillProviderSource}`;
const streamSource = fs.readFileSync(path.join(root, 'app/lib/agent/agent-request-stream-run-service.mjs'), 'utf8');
const imageRuntimeSource = fs.readFileSync(path.join(root, 'app/lib/agent/agent-image-runtime-context-service.mjs'), 'utf8');
const resultSource = fs.readFileSync(path.join(root, 'app/lib/agent/agent-result-resolution-service.mjs'), 'utf8');
const resultContextSource = fs.readFileSync(path.join(root, 'app/lib/agent/agent-main-execution-context-service.mjs'), 'utf8');
const generateSource = fs.readFileSync(path.join(root, 'app/api/generate/route.ts'), 'utf8');

test('agent routes user-selected chat and image models independently', () => {
  assert.match(contextSource, /body\.chatOptions\?\.model/);
  assert.match(contextSource, /body\.chatOptions\?\.providerId/);
  assert.match(contextSource, /purpose:\s*'chat'/);
  assert.match(skillProviderSource, /resolveProviderModelSelection/);
  assert.match(streamSource, /id:\s*resolvedChatSelection\.providerId/);
  assert.match(streamSource, /model:\s*resolvedChatSelection\.model/);
  assert.match(streamSource, /imageOptions:\s*body\.imageOptions/);
  assert.match(imageRuntimeSource, /requestedProviderId:\s*override\?\.providerId\s*\|\|\s*imageOptions\?\.providerId/);
  assert.match(imageRuntimeSource, /requestedModel:\s*override\?\.model\s*\|\|\s*imageOptions\?\.model/);
  assert.match(imageRuntimeSource, /providerId:\s*selection\.selection\.providerId/);
  assert.match(imageRuntimeSource, /modelId:\s*selection\.selection\.model/);
  assert.match(resultContextSource, /referenceImages:\s*executionReferenceImages/);
  assert.match(resultSource, /imageOptions:\s*body\.imageOptions/);
  assert.match(resultSource, /referenceImages:\s*\[\.\.\.executionReferenceImages\]/);
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
  assert.match(agentSource, /resolveProviderModelSelection/);
  assert.match(agentSource, /requestedProviderId/);
  assert.match(agentSource, /requestedModel/);
  assert.doesNotMatch(agentSource, /DEFAULT_AGENT_MODEL|gemini-3\.1-flash-lite-preview-thinking-medium/);
  assert.doesNotMatch(agentSource, /const resolvedChatSelection = hasRequestedChatSelection/);
});

test('agent sends reference-image requests to the selected model without local vision gating or fallback', () => {
  const agentSource = combinedAgentSource;
  assert.match(agentSource, /allowFallback/);
  assert.doesNotMatch(agentSource, /resolvedChatCapabilities\.supportsVision/);
  assert.doesNotMatch(agentSource, /不支持参考图输入，请切换支持视觉的规划模型/);
});
