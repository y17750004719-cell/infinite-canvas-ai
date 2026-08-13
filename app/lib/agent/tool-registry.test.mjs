import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentToolRegistry, executeAgentTool, getAgentModelTools } from './tool-registry.mjs';

test('tool registry exposes the v1 domain tools and risk levels', () => {
  const registry = createAgentToolRegistry({
    createSkillJob: () => ({ id: 'job-1' }),
    getSkillJob: () => null,
  });
  assert.deepEqual([...registry.keys()], [
    'generate_image', 'get_canvas_context', 'get_conversation_memory', 'list_project_context',
    'read_context_entity', 'load_visual_reference', 'update_conversation_memory', 'resolve_failed_task_recovery',
    'handoff_to_image_planner', 'request_context_selection', 'start_skill_job', 'get_skill_job',
  ]);
  assert.equal(registry.get('start_skill_job').requiresConfirmation, true);
  assert.equal(registry.get('get_canvas_context').requiresConfirmation, false);
  assert.equal(registry.get('get_canvas_context').readOnly, true);
  assert.equal(registry.get('get_skill_job').readOnly, true);
  assert.equal(registry.get('generate_image').readOnly, false);
  assert.equal(registry.get('load_visual_reference').readOnly, true);
  assert.equal(registry.get('update_conversation_memory').terminal, undefined);
  assert.equal(registry.get('update_conversation_memory').countAgainstToolBudget, false);
});

test('recovery gate tool terminates without accepting rewritten task content', async () => {
  const registry = createAgentToolRegistry({
    resolveFailedTaskRecovery: (args) => ({ terminate: true, type: 'recovery_resolution', ...args }),
  });
  const result = await executeAgentTool(registry, 'resolve_failed_task_recovery', {
    decision: 'resume', confidence: 'high',
  }, { allowedTools: ['resolve_failed_task_recovery'] });
  assert.equal(result.type, 'recovery_resolution');
  assert.equal(Object.hasOwn(result, 'prompt'), false);
});

test('recovery gate rejects task identity, route, and Skill supplied by the model', async () => {
  const registry = createAgentToolRegistry({
    resolveFailedTaskRecovery: (args) => ({ terminate: true, type: 'recovery_resolution', ...args }),
  });
  await assert.rejects(
    () => executeAgentTool(registry, 'resolve_failed_task_recovery', {
      decision: 'resume', confidence: 'high', taskId: 'task-1', route: 'image_planner', skillId: null,
    }, { allowedTools: ['resolve_failed_task_recovery'] }),
    /Invalid arguments/,
  );
});

test('tool registry only exposes schemas for allowed tools', () => {
  const registry = createAgentToolRegistry({ createSkillJob: () => null, getSkillJob: () => null });
  const definitions = getAgentModelTools(registry, ['get_canvas_context', 'unknown']);
  assert.deepEqual(definitions.map((tool) => tool.function.name), ['get_canvas_context']);
});

test('Image Planner handoff can select one validated failed task without rewriting its request', async () => {
  const calls = [];
  const registry = createAgentToolRegistry({
    handoffToImagePlanner: (args) => {
      calls.push(args);
      return { terminate: true, type: 'planner_handoff', ...args };
    },
  });
  const result = await executeAgentTool(
    registry,
    'handoff_to_image_planner',
    {
      skillId: null,
      contextEntityIds: [],
      visualReferenceIds: [],
      visualSummary: null,
      confidence: 'high',
      resumeTaskId: 'agent-run-1',
    },
    { allowedTools: ['handoff_to_image_planner'] },
  );
  assert.equal(result.resumeTaskId, 'agent-run-1');
  assert.equal(Object.hasOwn(calls[0], 'prompt'), false);
  assert.equal(Object.hasOwn(calls[0], 'brief'), false);
  assert.equal(Object.hasOwn(calls[0], 'generationPrompt'), false);
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

test('update_conversation_memory is non-terminal and validates bounded semantic patches', async () => {
  const patches = [];
  const registry = createAgentToolRegistry({
    updateConversationMemory: (patch) => {
      patches.push(patch);
      return { staged: true };
    },
  });
  const result = await executeAgentTool(
    registry,
    'update_conversation_memory',
    { memoryPatch: { facts: ['用户偏好竖版构图'] } },
    { allowedTools: ['update_conversation_memory'] },
  );
  assert.deepEqual(result, { staged: true });
  assert.deepEqual(patches, [{ facts: ['用户偏好竖版构图'] }]);
  await assert.rejects(
    () => executeAgentTool(
      registry,
      'update_conversation_memory',
      { memoryPatch: { facts: [123] } },
      { allowedTools: ['update_conversation_memory'] },
    ),
    /Invalid arguments for update_conversation_memory/,
  );
});

test('read_context_entity keeps single-ID compatibility and batches up to eight unique IDs', async () => {
  const reads = [];
  const registry = createAgentToolRegistry({
    readContextEntity: async (id) => {
      reads.push(id);
      if (id === 'missing') throw new Error('Unknown context entity: missing');
      return {
        modelResult: { id, summary: `summary-${id}` },
        publicResult: { id },
      };
    },
  });
  const single = await executeAgentTool(
    registry,
    'read_context_entity',
    { id: ' one ' },
    { allowedTools: ['read_context_entity'] },
  );
  assert.deepEqual(single.modelResult, { id: 'one', summary: 'summary-one' });

  const batch = await executeAgentTool(
    registry,
    'read_context_entity',
    { ids: ['two', ' three ', 'two'] },
    { allowedTools: ['read_context_entity'] },
  );
  assert.deepEqual(batch.modelResult.entities.map((entity) => entity.id), ['two', 'three']);
  assert.deepEqual(batch.publicResult.entities, [{ id: 'two' }, { id: 'three' }]);
  assert.deepEqual(reads, ['one', 'two', 'three']);

  await assert.rejects(
    () => executeAgentTool(
      registry,
      'read_context_entity',
      { id: 'one', ids: ['two'] },
      { allowedTools: ['read_context_entity'] },
    ),
    /exactly one of id or ids/,
  );
  await assert.rejects(
    () => executeAgentTool(
      registry,
      'read_context_entity',
      { ids: [] },
      { allowedTools: ['read_context_entity'] },
    ),
    /too few items/,
  );
  await assert.rejects(
    () => executeAgentTool(
      registry,
      'read_context_entity',
      { ids: Array.from({ length: 9 }, (_, index) => `id-${index}`) },
      { allowedTools: ['read_context_entity'] },
    ),
    /too many items/,
  );
  await assert.rejects(
    () => executeAgentTool(
      registry,
      'read_context_entity',
      { ids: ['two', 'missing'] },
      { allowedTools: ['read_context_entity'] },
    ),
    /Unknown context entity/,
  );
});
