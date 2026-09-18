import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentSkillProviderService } from './agent-skill-provider-service.mjs';

test('skill/provider service prepares stable provider selection and fingerprint', async () => {
  const service = createAgentSkillProviderService({
    listSkillManifests: async () => [{ id: 'visual', enabled: true }],
    loadSkillContent: async () => '# Visual rules',
    readProviderRegistry: async () => ({ providers: [{
      id: 'chat', enabled: true, protocol: 'openai', baseUrl: 'https://example.test', chatModels: ['model-a'],
    }] }),
    buildProviderImageOptionProfiles: () => ({ chat: { models: ['model-a'] } }),
  });
  assert.deepEqual(await service.listSkillManifests(), [{ id: 'visual', enabled: true }]);
  const loaded = await service.loadSkillSnapshot('visual');
  assert.equal(loaded.content, '# Visual rules');
  assert.equal(loaded.contentHash.length, 64);
  const selected = await service.prepareProviderSelection({ body: { chatOptions: { providerId: 'chat', model: 'model-a' } } });
  assert.equal(selected.provider.id, 'chat');
  assert.equal(selected.selection.model, 'model-a');
  assert.equal(selected.resolvedSelection.validated, true);
  assert.equal(selected.resolvedSelection.capability, 'chat');
  assert.equal(selected.fingerprint.length, 64);
});

test('locked image Skills reject invalid manifests and changed content', async () => {
  const service = createAgentSkillProviderService({ loadSkillContent: async () => 'current' });
  await assert.rejects(
    () => service.assertLockedSkill({ id: 'chat', executionMode: 'agent_loop', allowedTools: [] }),
    /not allowed/,
  );
  await assert.rejects(
    () => service.assertLockedSkill({ id: 'visual', executionMode: 'image_pipeline', allowedTools: ['generate_image'] }, 'wrong'),
    /content changed/,
  );
});
