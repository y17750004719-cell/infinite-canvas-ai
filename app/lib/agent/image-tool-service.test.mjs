import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveImageExecutionSelection } from './image-provider-selection.mjs';

const controllerPath = path.resolve(import.meta.dirname, 'agent-request-runtime.ts');
const servicePath = path.resolve(import.meta.dirname, 'image-tool-service.mjs');

test('image route is hidden behind the application image service boundary', () => {
  const controller = fs.readFileSync(controllerPath, 'utf8');
  const service = fs.readFileSync(servicePath, 'utf8');
  assert.doesNotMatch(controller, /api\/generate\/route/);
  assert.doesNotMatch(controller, /generatePost/);
  assert.match(controller, /executeImageRequest\(/);
  assert.match(service, /POST as generateImage/);
  assert.match(service, /dispatchImageGeneration/);
});

test('image provider selection is resolved by the image service boundary', () => {
  const providers = [
    {
      id: 'provider-a',
      enabled: true,
      primary: true,
      protocol: 'openai',
      imageModels: ['image-a'],
    },
    {
      id: 'provider-b',
      enabled: true,
      protocol: 'gemini',
      imageModels: ['image-b', 'image-c'],
    },
  ];
  const result = resolveImageExecutionSelection({
    providers,
    requestedProviderId: 'provider-b',
    requestedModel: 'image-c',
  });
  assert.deepEqual(result.selection, {
    providerId: 'provider-b',
    model: 'image-c',
    fallback: false,
    reason: 'exact',
  });
  assert.equal(result.provider.id, 'provider-b');
  assert.deepEqual(result.allowedModelIds, ['image-b', 'image-c']);
});

test('image provider selection fails before execution when no model is available', () => {
  assert.throws(() => resolveImageExecutionSelection({
    providers: [{ id: 'provider-a', enabled: true, imageModels: [] }],
    requestedProviderId: 'provider-a',
    requestedModel: 'missing-image',
    allowFallback: false,
  }), /No enabled image provider and model are configured/);
});
