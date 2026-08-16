import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentToolRegistry, executeAgentTool, getAgentModelTools } from './tool-registry.mjs';

test('tool registry exposes the direct image tool and legacy recovery tools', () => {
  const registry = createAgentToolRegistry({
    createSkillJob: () => ({ id: 'job-1' }),
    getSkillJob: () => null,
  });
  assert.deepEqual([...registry.keys()], [
    'read_imagegen_context', 'generate_image', 'get_canvas_context', 'get_conversation_memory', 'list_project_context',
    'read_context_entity', 'load_visual_reference', 'update_conversation_memory',
    'handle_failed_task', 'read_relevant_context', 'submit_agent_analysis_checkpoint',
    'request_user_decision', 'start_image_planning', 'rewind_agent_analysis', 'resolve_failed_task_recovery',
    'request_main_agent_context',
    'request_image_clarification', 'submit_image_execution_plan',
    'handoff_to_image_planner', 'request_context_selection', 'start_skill_job', 'get_skill_job',
  ]);
  assert.equal(registry.get('start_skill_job').requiresConfirmation, true);
  assert.equal(registry.get('get_canvas_context').requiresConfirmation, false);
  assert.equal(registry.get('get_canvas_context').readOnly, true);
  assert.equal(registry.get('get_skill_job').readOnly, true);
  assert.equal(registry.get('generate_image').readOnly, false);
  assert.equal(registry.get('generate_image').terminal, true);
  assert.equal(registry.get('read_imagegen_context').readOnly, true);
  assert.equal(registry.get('read_imagegen_context').terminal, undefined);
  assert.equal(registry.get('read_imagegen_context').countAgainstToolBudget, false);
  assert.equal(registry.get('load_visual_reference').readOnly, true);
  assert.equal(registry.get('update_conversation_memory').terminal, undefined);
  assert.equal(registry.get('update_conversation_memory').countAgainstToolBudget, false);
  assert.equal(registry.get('handle_failed_task').terminal, undefined);
  assert.equal(registry.get('read_relevant_context').terminal, undefined);
  assert.equal(registry.get('submit_agent_analysis_checkpoint').terminal, true);
  assert.equal(registry.get('request_user_decision').terminal, true);
  assert.equal(registry.get('start_image_planning').terminal, true);
  assert.equal(registry.get('rewind_agent_analysis').terminal, true);
  assert.equal(registry.get('request_main_agent_context').terminal, undefined);
  assert.equal(registry.get('request_main_agent_context').readOnly, true);
  assert.equal(registry.get('request_main_agent_context').countAgainstToolBudget, false);
  assert.equal(registry.has('submit_image_compilation'), false);
  assert.equal(registry.get('submit_image_execution_plan').terminal, true);
  assert.equal(registry.get('submit_image_execution_plan').readOnly, true);
  assert.equal(registry.get('submit_image_execution_plan').countAgainstToolBudget, false);
});

test('read_imagegen_context reads the locked host and visual Skills without model arguments', async () => {
  const imagegenContext = {
    hostSkill: {
      id: 'imagegen',
      content: '# ImageGen Host\nShape the prompt without over-expanding it.',
      contentHash: 'host-hash',
    },
    visualSkill: {
      id: 'gc-minimal-zine-poster-v0-1',
      content: '# Minimal Zine Poster\nUse the locked visual method.',
      contentHash: 'visual-hash',
    },
  };
  const calls = [];
  const registry = createAgentToolRegistry({
    readImagegenContext: (context) => {
      calls.push(context.runId);
      return imagegenContext;
    },
  });
  const [modelTool] = getAgentModelTools(registry, ['read_imagegen_context']);

  assert.deepEqual(modelTool.function.parameters, { type: 'object', properties: {}, additionalProperties: false });
  assert.deepEqual(
    await executeAgentTool(registry, 'read_imagegen_context', {}, {
      allowedTools: ['read_imagegen_context'],
      runId: 'run-skill-read',
    }),
    imagegenContext,
  );
  assert.deepEqual(calls, ['run-skill-read']);
  await assert.rejects(
    () => executeAgentTool(registry, 'read_imagegen_context', { skillId: 'other' }, { allowedTools: ['read_imagegen_context'] }),
    /not allowed/,
  );
  await assert.rejects(
    () => executeAgentTool(createAgentToolRegistry(), 'read_imagegen_context', {}, { allowedTools: ['read_imagegen_context'] }),
    /unavailable/,
  );
});

test('generate_image exposes a strict direct execution contract and forwards the final prompt unchanged', async () => {
  const calls = [];
  const registry = createAgentToolRegistry({
    generateImage: (args, context) => {
      calls.push([args, context.runId]);
      return { accepted: true };
    },
  });
  const args = {
    operation: 'edit',
    prompt: 'Replace the blue square with a red square; preserve every other visible element.',
    referenceIds: ['canvas:image-1', 'canvas:style-1'],
    targetReferenceId: 'canvas:image-1',
    outputCount: 2,
    aspectRatio: '1:1',
    deliveryMode: 'series',
    panelCount: null,
    items: [
      { prompt: 'Replace the blue square with a red square.' },
      { prompt: 'Replace the blue square with a crimson square.' },
    ],
  };

  const modelTool = getAgentModelTools(registry, ['generate_image'])[0];
  assert.equal(modelTool.function.parameters.additionalProperties, false);
  assert.deepEqual(modelTool.function.parameters.required, [
    'operation', 'prompt', 'referenceIds', 'targetReferenceId', 'outputCount', 'aspectRatio', 'deliveryMode', 'panelCount',
  ]);
  assert.equal(modelTool.function.parameters.properties.items.items.additionalProperties, false);

  assert.deepEqual(
    await executeAgentTool(registry, 'generate_image', args, { allowedTools: ['generate_image'], runId: 'run-image-1' }),
    { accepted: true },
  );
  assert.deepEqual(calls, [[args, 'run-image-1']]);

  await assert.rejects(
    () => executeAgentTool(registry, 'generate_image', { ...args, prompt: '' }, { allowedTools: ['generate_image'] }),
    /too short/,
  );
  await assert.rejects(
    () => executeAgentTool(registry, 'generate_image', { ...args, extraPromptRule: 'forbidden' }, { allowedTools: ['generate_image'] }),
    /not allowed/,
  );
  await assert.rejects(
    () => executeAgentTool(registry, 'generate_image', { ...args, items: [{ prompt: 'valid', style: 'unused' }] }, { allowedTools: ['generate_image'] }),
    /not allowed/,
  );
});

test('entry tools validate lazy routing contracts and forward runtime context', async () => {
  const calls = [];
  const registry = createAgentToolRegistry({
    handleFailedTask: (args, context) => calls.push(['failed', args, context.runId]),
    readRelevantContext: (args, context) => calls.push(['context', args, context.runId]),
    startImagePlanning: (args, context) => calls.push(['image', args, context.runId]),
  });
  const context = {
    allowedTools: ['handle_failed_task', 'read_relevant_context', 'start_image_planning'],
    runId: 'run-1',
  };
  await executeAgentTool(registry, 'handle_failed_task', { action: 'inspect' }, context);
  await executeAgentTool(registry, 'handle_failed_task', { action: 'resume', revision: '背景改成蓝色' }, context);
  await executeAgentTool(registry, 'read_relevant_context', { scope: 'canvas', ids: ['canvas:1'] }, context);
  const imageEntry = {
    operation: 'edit',
    requestedParameters: { outputCount: 1, aspectRatio: '1:1', deliveryMode: 'single' },
    readiness: {
      goal: 'Edit the selected image', targetIds: ['canvas:1'], constraints: [],
      resolvedAmbiguities: ['The selected image is the edit target'], blockingUnknowns: [],
    },
  };
  await executeAgentTool(registry, 'start_image_planning', imageEntry, context);
  assert.deepEqual(calls, [
    ['failed', { action: 'inspect' }, 'run-1'],
    ['failed', { action: 'resume', revision: '背景改成蓝色' }, 'run-1'],
    ['context', { scope: 'canvas', ids: ['canvas:1'] }, 'run-1'],
    ['image', imageEntry, 'run-1'],
  ]);
  await assert.rejects(
    () => executeAgentTool(registry, 'handle_failed_task', { action: 'retry' }, context),
    /allowed value/,
  );
  await assert.rejects(
    () => executeAgentTool(registry, 'read_relevant_context', { scope: 'memory' }, context),
    /allowed value/,
  );
  await assert.rejects(
    () => executeAgentTool(registry, 'start_image_planning', { ...imageEntry, operation: 'describe' }, context),
    /allowed value/,
  );
});

test('analysis and user-decision tools keep checkpoints bounded and decisions explicit', async () => {
  const calls = [];
  const registry = createAgentToolRegistry({
    submitAgentAnalysisCheckpoint: (args) => calls.push(['checkpoint', args]),
    requestUserDecision: (args) => calls.push(['decision', args]),
    rewindAgentAnalysis: (args) => calls.push(['rewind', args]),
  });
  const checkpoint = {
    objective: 'Compare migration paths',
    currentUnderstanding: { goal: 'Choose a migration', expectedResult: 'A phased plan', domain: 'other' },
    evidence: [], workingAssumptions: [], constraints: [],
    unresolvedQuestions: [{ dimension: 'risk', reason: 'Needs deeper analysis', resolvableBy: 'analysis' }],
    nextFocus: 'Compare operational risk',
  };
  const decision = {
    scope: 'analysis', dimension: 'downtime', question: '允许停机吗？', reason: '会改变迁移方案',
    recommendedOptionId: 'no-downtime',
    options: [
      { id: 'no-downtime', label: '不停机', answer: '采用不停机迁移', description: '步骤更多，风险更低' },
      { id: 'maintenance', label: '维护窗口', answer: '允许维护窗口', description: '步骤更少，但会短暂停机' },
    ],
  };
  const rewind = { stage: 'compilation', reason: 'User changed the deliverable', preservedFacts: ['skill'], changedRequirements: ['blue background'] };
  await executeAgentTool(registry, 'submit_agent_analysis_checkpoint', checkpoint, { allowedTools: ['submit_agent_analysis_checkpoint'] });
  await executeAgentTool(registry, 'request_user_decision', decision, { allowedTools: ['request_user_decision'] });
  await executeAgentTool(registry, 'rewind_agent_analysis', rewind, { allowedTools: ['rewind_agent_analysis'] });
  assert.deepEqual(calls, [['checkpoint', checkpoint], ['decision', decision], ['rewind', rewind]]);
  await assert.rejects(
    () => executeAgentTool(registry, 'request_user_decision', { ...decision, options: decision.options.slice(0, 1) }, { allowedTools: ['request_user_decision'] }),
    /too few items/,
  );
});

test('Prompt compilation is not exposed as a Main Agent tool', async () => {
  const registry = createAgentToolRegistry();
  await assert.rejects(
    () => executeAgentTool(registry, 'submit_image_compilation', { renderPrompt: 'unused' }, { allowedTools: ['submit_image_compilation'] }),
    /Unknown tool/,
  );
});

test('image clarification uses only the two model-owned image stages', async () => {
  const calls = [];
  const registry = createAgentToolRegistry({
    requestImageClarification: (args) => calls.push(['clarification', args]),
  });
  const clarificationArgs = {
    stage: 'compilation', dimension: 'edit_target', question: '编辑哪张图？', reason: '存在多个目标',
    options: [{ id: 'ref-1', label: '图 1', answer: '编辑图 1' }, { id: 'ref-2', label: '图 2', answer: '编辑图 2' }],
  };
  await executeAgentTool(registry, 'request_image_clarification', clarificationArgs, { allowedTools: ['request_image_clarification'] });
  assert.deepEqual(calls, [['clarification', clarificationArgs]]);
  await assert.rejects(
    () => executeAgentTool(registry, 'request_image_clarification', { ...clarificationArgs, stage: 'brief' }, { allowedTools: ['request_image_clarification'] }),
    /allowed value/,
  );
});

test('Main Agent context remains the only exposed auxiliary read operation', async () => {
  const calls = [];
  const registry = createAgentToolRegistry({
    requestMainAgentContext: (args, context) => {
      calls.push(['context', args, context.marker]);
      return { unlocked: args.scopes };
    },
  });
  const context = { allowedTools: ['request_main_agent_context'], marker: 'run-1' };
  assert.deepEqual(
    await executeAgentTool(registry, 'request_main_agent_context', { scopes: ['conversation', 'project'] }, context),
    { unlocked: ['conversation', 'project'] },
  );
  assert.deepEqual(calls, [
    ['context', { scopes: ['conversation', 'project'] }, 'run-1'],
  ]);
  await assert.rejects(
    () => executeAgentTool(registry, 'request_main_agent_context', { scopes: ['memory'] }, context),
    /Invalid arguments/,
  );
});

test('submit_image_execution_plan is a strict terminal draft and performs no mutation itself', async () => {
  const drafts = [];
  const registry = createAgentToolRegistry({
    submitImageExecutionPlan: (args) => {
      drafts.push(args);
      return { terminate: true, type: 'image_execution_plan', draft: args };
    },
  });
  const draft = {
    decision: 'execute',
    confidence: 'high',
    clarification: null,
    contextEntityIds: Array.from({ length: 8 }, (_, index) => `entity-${index}`),
    visualReferenceIds: ['reference-1'],
    visualSummary: {
      version: 1,
      references: [{
        referenceId: 'reference-1',
        description: 'A red poster.',
        salientSubjects: ['poster'],
        visibleText: ['SALE'],
      }],
    },
    referenceRoles: [{ referenceId: 'reference-1', role: 'edit_target' }],
    targetSelectionReason: 'The user selected this image.',
    targetSelectionConfidence: 'high',
    imageTask: {
      operation: 'edit',
      targetReferenceId: 'reference-1',
      supportingReferenceIds: [],
      targetRegionIds: [],
      instruction: 'Replace SALE with OPEN.',
      mustChange: ['visible text'],
      mustPreserve: ['layout'],
    },
    brief: {
      deliverable: 'One edited poster',
      subject: 'Red poster',
      style: ['minimal'],
      literalCopy: ['OPEN'],
      constraints: ['preserve layout'],
    },
    delivery: {
      mode: 'single',
      outputCount: 1,
      panelCount: null,
      variationAxes: [],
      sharedInvariants: [],
      distinctPerItem: [],
      items: [],
    },
    generation: { aspectRatio: '2:3', promptFormat: 'text', prompt: 'Edit the red poster.', items: [] },
  };
  const result = await executeAgentTool(
    registry,
    'submit_image_execution_plan',
    draft,
    { allowedTools: ['submit_image_execution_plan'] },
  );
  assert.equal(result.terminate, true);
  assert.deepEqual(drafts, [draft]);

  await assert.rejects(
    () => executeAgentTool(registry, 'submit_image_execution_plan', {
      ...draft,
      contextEntityIds: [...draft.contextEntityIds, 'entity-8'],
    }, { allowedTools: ['submit_image_execution_plan'] }),
    /too many items/,
  );
  await assert.rejects(
    () => executeAgentTool(registry, 'submit_image_execution_plan', {
      ...draft,
      visualReferenceIds: ['a', 'b', 'c', 'd', 'e'],
    }, { allowedTools: ['submit_image_execution_plan'] }),
    /too many items/,
  );
  await assert.rejects(
    () => executeAgentTool(registry, 'submit_image_execution_plan', {
      ...draft,
      delivery: { ...draft.delivery, outputCount: 0 },
    }, { allowedTools: ['submit_image_execution_plan'] }),
    /too small/,
  );
  await assert.rejects(
    () => executeAgentTool(registry, 'submit_image_execution_plan', {
      ...draft,
      generation: { ...draft.generation, aspectRatio: '7:5' },
    }, { allowedTools: ['submit_image_execution_plan'] }),
    /allowed value/,
  );
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
