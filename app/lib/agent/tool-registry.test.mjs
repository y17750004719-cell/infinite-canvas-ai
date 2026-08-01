import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentToolRegistry, executeAgentTool, getAgentModelTools } from './tool-registry.mjs';

test('tool registry exposes the v1 domain tools and risk levels', () => {
  const registry = createAgentToolRegistry({
    createSkillJob: () => ({ id: 'job-1' }),
    getSkillJob: () => null,
  });
  assert.deepEqual([...registry.keys()], ['generate_image', 'get_canvas_context', 'start_skill_job', 'get_skill_job']);
  assert.equal(registry.get('start_skill_job').requiresConfirmation, true);
  assert.equal(registry.get('get_canvas_context').requiresConfirmation, false);
  assert.equal(registry.get('get_canvas_context').readOnly, true);
  assert.equal(registry.get('get_skill_job').readOnly, true);
  assert.equal(registry.get('generate_image').readOnly, false);
});

test('tool registry only exposes schemas for allowed tools', () => {
  const registry = createAgentToolRegistry({ createSkillJob: () => null, getSkillJob: () => null });
  const definitions = getAgentModelTools(registry, ['get_canvas_context', 'unknown']);
  assert.deepEqual(definitions.map((tool) => tool.function.name), ['get_canvas_context']);
});

test('executeAgentTool enforces skill allowlists and confirmation', async () => {
  const registry = createAgentToolRegistry({
    createSkillJob: () => ({ id: 'job-1' }),
    getSkillJob: () => null,
  });
  await assert.rejects(
    () => executeAgentTool(registry, 'start_skill_job', { skillType: 'logo', payload: {} }, { allowedTools: [] }),
    /not allowed/,
  );
  const confirmation = await executeAgentTool(
    registry,
    'start_skill_job',
    { skillType: 'logo', payload: {} },
    { allowedTools: ['start_skill_job'], confirmed: false },
  );
  assert.equal(confirmation.confirmationRequired, true);
});

test('executeAgentTool rejects schema-invalid arguments before confirmation or execution', async () => {
  let created = 0;
  const registry = createAgentToolRegistry({
    createSkillJob: () => {
      created += 1;
      return { id: 'job-1' };
    },
    getSkillJob: () => null,
  });
  await assert.rejects(
    () => executeAgentTool(
      registry,
      'start_skill_job',
      { skillType: 123 },
      { allowedTools: ['start_skill_job'], confirmed: true },
    ),
    /Invalid arguments for start_skill_job: arguments\.skillType/,
  );
  assert.equal(created, 0);
});

test('get_canvas_context returns only the supplied bounded summary', async () => {
  const registry = createAgentToolRegistry({ createSkillJob: () => null, getSkillJob: () => null });
  const result = await executeAgentTool(
    registry,
    'get_canvas_context',
    {},
    { allowedTools: ['get_canvas_context'], canvasContext: { itemCount: 3, selectedItemIds: ['a'] } },
  );
  assert.deepEqual(result, { itemCount: 3, selectedItemIds: ['a'] });
});
