import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_EXECUTION_PLAN_TOOL,
  areAgentTaskContractsEqual,
  buildAgentExecutionPlanTool,
  buildAgentExecutionPlannerMessages,
  buildAgentTaskContract,
  buildFallbackAgentExecutionPlan,
  compactCanvasContext,
  executionPlanToBrief,
  executionPlanToImageDeliveryPlan,
  parseAgentExecutionPlan,
  planAgentExecutionRequest,
  validateAgentExecutionPlan,
} from './execution-planner.mjs';

test('compact canvas context bounds and limits region prompt data', () => {
  const compacted = compactCanvasContext({
    regionSelections: [{
      regionId: `region-${'x'.repeat(240)}`,
      imageItemId: `image-${'y'.repeat(240)}`,
      label: 'z'.repeat(240),
      point: { x: -2, y: 3 },
      box: { x: 0.9, y: 0.8, width: 0.5, height: 0.7 },
      candidateId: 'candidate-id',
      aliases: ['别名'],
      description: '左侧戴墨镜的老虎',
      confidence: 'high',
    }],
  });
  const region = compacted.regionSelections[0];
  assert.equal(region.regionId.length, 160);
  assert.equal(region.imageItemId.length, 160);
  assert.equal(region.label.length, 120);
  assert.deepEqual(region.point, { x: 0, y: 1 });
  assert.equal(region.box.x, 0.9);
  assert.equal(region.box.y, 0.8);
  assert.ok(Math.abs(region.box.width - 0.1) < 1e-12);
  assert.ok(Math.abs(region.box.height - 0.2) < 1e-12);
  assert.deepEqual(region.aliases, ['别名']);
  assert.equal(region.description, '左侧戴墨镜的老虎');
});

test('planner context keeps only confirmed region references and parented region crops', () => {
  const payload = JSON.parse(buildAgentExecutionPlannerMessages({
    userMessage: '修改选区',
    referenceContext: {
      references: [
        { id: 'pending', label: '待确认', source: 'canvas', role: 'region_target' },
        { id: 'confirmed', label: '左侧老虎', source: 'canvas', role: 'region_target', confirmationStatus: 'confirmed', aliases: ['左虎'], description: '左侧戴墨镜的老虎', confidence: 'high' },
      ],
      composerSegments: [],
      evidenceImages: [{ id: 'crop', referenceId: 'confirmed', kind: 'region_crop' }],
    },
  })[1].content);
  assert.deepEqual(payload.referenceContext.references.map((reference) => reference.id), ['confirmed']);
  assert.equal(payload.referenceContext.references[0].description, '左侧戴墨镜的老虎');
  assert.deepEqual(payload.referenceContext.evidenceImages, [{ id: 'crop', referenceId: 'confirmed', kind: 'region_crop' }]);
});

const manifests = [{
  id: 'magazine-poster',
  name: 'Magazine Poster',
  description: 'Editorial typography, magazine covers, and art-directed collage posters',
  triggerHints: ['editorial poster', 'collage editorial poster'],
  planningGuidance: 'Use for typography-led cultural and collage editorial posters.',
  allowedTools: ['generate_image'],
  executionMode: 'image_pipeline',
  promptStyle: 'json-text',
  generationContract: 'Return supplier-ready valid JSON text prompts.',
  enabled: true,
}];

function plan(overrides = {}) {
  const mustChange = ['Create the requested deliverables'];
  const mustPreserve = ['Literal copy and explicit constraints'];
  const literalCopy = ['DISASSEMBLED GODS', 'Truths are torn, not told'];
  const finalPrompt = (variation) => JSON.stringify({
    subject: 'fragmented Greek statue',
    variation,
    mustChange,
    mustPreserve,
    literalCopy,
  });
  const result = {
    version: 3,
    taskRelation: 'new_task',
    taskRelationConfidence: 'high',
    taskRelationReason: 'The user requested a separate deliverable.',
    intent: 'image',
    skillId: 'magazine-poster',
    confidence: 'high',
    needsClarification: false,
    clarification: null,
    contextReferences: [],
    imageTask: {
      operation: 'generate',
      targetReferenceId: null,
      supportingReferenceIds: [],
      instruction: 'Generate the requested standalone poster series.',
      mustChange,
      mustPreserve,
    },
    presentation: {
      title: 'Generated Poster Series',
      completionSummary: 'Created the requested standalone poster series.',
    },
    brief: {
      deliverable: 'four standalone posters',
      subject: 'fragmented Greek statue',
      style: ['surreal hand-cut collage'],
      literalCopy,
      constraints: ['gold and red stripes across the eyes'],
    },
    delivery: {
      mode: 'series',
      outputCount: 4,
      panelCount: null,
      variationAxes: ['layout'],
      sharedInvariants: ['same editorial typography and color system'],
      distinctPerItem: ['layout composition', 'paper layering'],
      items: [
        { index: 1, label: 'Poster 1', subject: 'Greek statue bust', variation: 'asymmetric editorial layout' },
        { index: 2, label: 'Poster 2', subject: 'Greek statue bust', variation: 'centered monumental layout' },
        { index: 3, label: 'Poster 3', subject: 'Greek statue bust', variation: 'vertical typographic layout' },
        { index: 4, label: 'Poster 4', subject: 'Greek statue bust', variation: 'layered diagonal layout' },
      ],
    },
    generation: {
      promptFormat: 'json-text',
      prompt: finalPrompt('shared editorial system'),
      items: [
        { index: 1, label: 'Poster 1', prompt: finalPrompt('asymmetric editorial layout') },
        { index: 2, label: 'Poster 2', prompt: finalPrompt('centered monumental layout') },
        { index: 3, label: 'Poster 3', prompt: finalPrompt('vertical typographic layout') },
        { index: 4, label: 'Poster 4', prompt: finalPrompt('layered diagonal layout') },
      ],
    },
    execution: { kind: 'image_pipeline', requiresConfirmation: true, tool: 'generate_image' },
    ...overrides,
  };
  if (overrides.delivery && !Object.hasOwn(overrides, 'generation')) {
    result.generation = {
      ...result.generation,
      items: result.delivery.mode === 'series'
        ? result.generation.items.slice(0, result.delivery.outputCount)
        : [],
    };
  }
  if (overrides.imageTask && !Object.hasOwn(overrides, 'generation')) {
    const contractPrompt = (variation) => JSON.stringify({
      subject: result.brief.subject,
      variation,
      mustChange: result.imageTask.mustChange,
      mustPreserve: result.imageTask.mustPreserve,
      literalCopy: result.brief.literalCopy,
    });
    result.generation = {
      ...result.generation,
      prompt: contractPrompt('shared direction'),
      items: result.delivery.mode === 'series'
        ? result.delivery.items.map((item) => ({ index: item.index, label: item.label, prompt: contractPrompt(item.variation) }))
        : [],
    };
  }
  return result;
}

function toolResponse(value, content = '') {
  return {
    choices: [{
      message: {
        content,
        tool_calls: [{
          id: 'planner-call',
          type: 'function',
          function: {
            name: 'submit_agent_execution_plan',
            arguments: JSON.stringify({ plan: value }),
          },
        }],
      },
    }],
  };
}

function visualContext(referenceIds, targetReferenceId = null, confidence = null) {
  return {
    references: referenceIds.map((referenceId) => ({
      referenceId,
      summary: referenceId === targetReferenceId ? 'A magazine cover with a central fashion subject.' : 'A visual reference image.',
      salientSubjects: referenceId === targetReferenceId ? ['fashion subject'] : [],
      visibleText: referenceId === targetReferenceId ? ['VOGUE'] : [],
      styleAndComposition: 'Editorial composition with a strong central hierarchy.',
      inferredRole: referenceId === targetReferenceId ? 'edit_target' : 'style_reference',
    })),
    targetSelectionReason: targetReferenceId ? 'The user asked to modify this supplied cover.' : null,
    targetSelectionConfidence: confidence,
  };
}

function assertStringEnums(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertStringEnums(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value.enum)) {
    value.enum.forEach((entry, index) => {
      assert.equal(typeof entry, 'string', `${path}.enum[${index}] must be a string`);
    });
  }
  Object.entries(value).forEach(([key, entry]) => assertStringEnums(entry, `${path}.${key}`));
}

test('planner prompt requires the structured tool and separates collage style from composite layout', () => {
  const messages = buildAgentExecutionPlannerMessages({
    userMessage: 'Generate four posters in a hand-cut collage style',
    manifests,
  });
  assert.match(messages[0].content, /must call submit_agent_execution_plan exactly once/i);
  assert.match(messages[0].content, /collage, hand-cut collage.*visual style or content/i);
  assert.match(messages[0].content, /composite only when each output file/i);
  assert.match(messages[0].content, /only analysis request/i);
  assert.match(messages[1].content, /planningGuidance/);
  assert.match(messages[1].content, /generationContract/);
  assert.equal(AGENT_EXECUTION_PLAN_TOOL.function.name, 'submit_agent_execution_plan');
  assert.deepEqual(AGENT_EXECUTION_PLAN_TOOL.function.parameters.required, ['plan']);
});

test('planner receives sanitized inline reference context and is the sole semantic intent decider', () => {
  const messages = buildAgentExecutionPlannerMessages({
    userMessage: '把它换成狗',
    manifests,
    referenceContext: {
      references: [{
        id: 'vogue-cover',
        src: 'https://private.example/original.png',
        plannerPreviewSrc: 'https://private.example/preview.png',
        label: 'Vogue Cover',
        source: 'canvas',
        canvasItemId: 'canvas-1',
        role: 'edit_target',
        annotationCount: 2,
      }],
      composerSegments: [
        { type: 'text', text: '把 ' },
        { type: 'reference', referenceId: 'vogue-cover' },
        { type: 'text', text: ' 换成狗' },
      ],
    },
    canvasContext: {
      itemCount: 1,
      selectedItemIds: ['canvas-1'],
      selectedItems: [{
        id: 'canvas-1',
        type: 'image',
        src: 'https://private.example/canvas.png',
        plannerPreviewSrc: 'https://private.example/canvas-preview.png',
        x: 10,
        y: 20,
        width: 300,
        height: 400,
      }],
      annotationContext: {
        targetImage: { id: 'canvas-1', src: 'https://private.example/target.png', x: 10, y: 20, width: 300, height: 400 },
        annotations: [],
        annotationItemIds: [],
        annotationCount: 0,
        ambiguousImageTarget: false,
        compositePreviewUrl: 'https://private.example/preview.png',
      },
    },
  });
  assert.match(messages[0].content, /only component that decides whether the user wants chat, analysis, a new image, or an edit/i);
  assert.match(messages[0].content, /runtime will not infer intent from keywords or regular expressions/i);
  assert.ok(Array.isArray(messages[1].content));
  const structuredPart = messages[1].content[0];
  assert.equal(structuredPart.type, 'text');
  const payload = JSON.parse(structuredPart.text.split('\n').slice(1).join('\n'));
  assert.deepEqual(payload.referenceContext, {
    references: [{
      id: 'vogue-cover',
      label: 'Vogue Cover',
      source: 'canvas',
      canvasItemId: 'canvas-1',
      role: 'edit_target',
      annotationCount: 2,
    }],
    composerSegments: [
      { type: 'text', text: '把 ' },
      { type: 'reference', referenceId: 'vogue-cover' },
      { type: 'text', text: ' 换成狗' },
    ],
  });
  assert.doesNotMatch(structuredPart.text, /private\.example/);
  assert.ok(messages[1].content.some((part) => part.type === 'image_url' && part.image_url.url === 'https://private.example/preview.png'));
  assert.ok(!messages[1].content.some((part) => part.type === 'image_url' && part.image_url.url === 'https://private.example/original.png'));
  const imageIndex = messages[1].content.findIndex((part) => part.type === 'image_url');
  assert.match(messages[1].content[imageIndex - 1].text, /Reference ID: vogue-cover/);
  assert.deepEqual(payload.canvasContext.selectedItems[0], {
    id: 'canvas-1',
    type: 'image',
    x: 10,
    y: 20,
    width: 300,
    height: 400,
  });
});

test('planner tool schema is Gemini-compatible while runtime validation enforces version 3', () => {
  const versionSchema = AGENT_EXECUTION_PLAN_TOOL.function.parameters.properties.plan.properties.version;
  assert.equal(versionSchema.type, 'integer');
  assert.equal(versionSchema.enum, undefined);
  assert.match(versionSchema.description, /must be 3/i);
  assertStringEnums(AGENT_EXECUTION_PLAN_TOOL.function.parameters);

  const options = {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
  };
  const valid = validateAgentExecutionPlan(plan({ version: 3 }), options);
  assert.ok(valid.plan);
  assert.equal(valid.plan.version, 3);

  const invalid = validateAgentExecutionPlan(plan({ version: 2 }), options);
  assert.equal(invalid.plan, null);
  assert.ok(invalid.validationErrors.some((entry) => entry.path === 'version' && entry.code === 'unsupported_version'));
});

test('planner v3 validates all task relations and canonical contract reuse', () => {
  const options = {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
    skillPromptStylesById: { 'magazine-poster': 'json-text' },
  };
  const initial = validateAgentExecutionPlan(plan(), options).plan;
  assert.ok(initial);
  const activeTaskContext = {
    topicId: 'topic-1',
    taskId: 'task-1',
    contractVersion: 1,
    contract: buildAgentTaskContract(initial),
    latestBatchId: 'batch-1',
    activeVersions: [],
  };
  for (const taskRelation of ['continue_task', 'rerun_task']) {
    const result = validateAgentExecutionPlan(plan({
      taskRelation,
      taskRelationReason: `The user requested ${taskRelation}.`,
    }), { ...options, activeTaskContext });
    assert.ok(result.plan, taskRelation);
  }
  const revised = validateAgentExecutionPlan(plan({
    taskRelation: 'revise_task',
    taskRelationReason: 'The requested subject changed.',
    brief: { ...plan().brief, subject: 'a different statue' },
  }), { ...options, activeTaskContext });
  assert.ok(revised.plan);

  const unchangedRevision = validateAgentExecutionPlan(plan({
    taskRelation: 'revise_task',
    taskRelationReason: 'No executable field changed.',
  }), { ...options, activeTaskContext });
  assert.equal(unchangedRevision.plan, null);
  assert.ok(unchangedRevision.validationErrors.some((entry) => entry.code === 'unchanged_task_contract'));

  const mismatchedContinuation = validateAgentExecutionPlan(plan({
    taskRelation: 'continue_task',
    taskRelationReason: 'Continue, but with a changed subject.',
    brief: { ...plan().brief, subject: 'a different statue' },
  }), { ...options, activeTaskContext });
  assert.equal(mismatchedContinuation.plan, null);
  assert.ok(mismatchedContinuation.validationErrors.some((entry) => entry.code === 'task_contract_mismatch'));

  const discussed = validateAgentExecutionPlan(plan({
    taskRelation: 'discuss_task',
    taskRelationReason: 'The user only asked a question about the task.',
    intent: 'chat',
    imageTask: undefined,
    presentation: undefined,
    generation: null,
    execution: { kind: 'none', requiresConfirmation: false, tool: null },
  }), { ...options, activeTaskContext });
  assert.ok(discussed.plan);
});

test('task contract comparison rebinds task-owned edit targets to stable references', () => {
  const activeTaskContext = {
    activeVersions: [{ referenceId: 'slot:one', slotId: 'slot-1', versionId: 'version-2' }],
  };
  const base = plan({
    imageTask: { ...plan().imageTask, operation: 'edit', targetReferenceId: 'slot-1' },
  });
  const candidate = plan({
    imageTask: { ...plan().imageTask, operation: 'edit', targetReferenceId: 'version-2' },
  });
  assert.equal(areAgentTaskContractsEqual(base, candidate, activeTaskContext), true);
  assert.equal(buildAgentTaskContract(candidate, activeTaskContext).imageTask.targetReferenceId, 'slot:one');
});

test('low task-relation confidence clarifies and cannot execute mutation', () => {
  const options = {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
    skillPromptStylesById: { 'magazine-poster': 'json-text' },
  };
  const rejected = validateAgentExecutionPlan(plan({ taskRelationConfidence: 'low' }), options);
  assert.equal(rejected.plan, null);
  assert.ok(rejected.validationErrors.some((entry) => entry.code === 'clarification_required'));
  assert.ok(rejected.validationErrors.some((entry) => entry.code === 'low_confidence_mutation'));

  const clarified = validateAgentExecutionPlan(plan({
    taskRelationConfidence: 'low',
    taskRelationReason: 'The user may want either a new image or an edit.',
    needsClarification: true,
    clarification: {
      dimension: 'image_operation',
      question: '你希望生成新图还是编辑现有图？',
      options: [
        { id: 'generate', label: '生成新图', answer: '生成一张新图片' },
        { id: 'edit', label: '编辑现有图', answer: '编辑我指定的图片' },
      ],
    },
    imageTask: undefined,
    presentation: undefined,
    generation: null,
    execution: { kind: 'none', requiresConfirmation: false, tool: null },
  }), options);
  assert.ok(clarified.plan);
});

test('active task context is capped at nine preview-only multimodal references', () => {
  const activeVersions = Array.from({ length: 11 }, (_, index) => ({
    referenceId: `slot:${index}`,
    batchId: 'batch-1',
    slotId: `slot-${index}`,
    versionId: `version-${index}`,
    src: `https://example.test/original-${index}.png`,
    plannerPreviewSrc: `https://example.test/preview-${index}.png`,
  }));
  const messages = buildAgentExecutionPlannerMessages({
    userMessage: '继续',
    activeTaskContext: {
      topicId: 'topic-1',
      taskId: 'task-1',
      contractVersion: 1,
      contract: buildAgentTaskContract(plan()),
      latestBatchId: 'batch-1',
      activeVersions,
    },
  });
  const payload = JSON.parse(messages[1].content[0].text.split('\n').slice(1).join('\n'));
  assert.equal(payload.activeTaskContext.activeVersions.length, 9);
  assert.deepEqual(messages[1].content.filter((part) => part.type === 'image_url').map((part) => part.image_url.url),
    activeVersions.slice(0, 9).map((entry) => entry.plannerPreviewSrc));
});

test('planner tool schema keeps image references and context entities in separate id namespaces', () => {
  const tool = buildAgentExecutionPlanTool({
    contextEntities: [{ id: 'canvas:scene', label: 'Scene' }],
    referenceContext: {
      references: [{ id: 'token:bottle', src: '/api/local-assets/bottle.png', plannerPreviewSrc: '/api/local-assets/bottle-preview.png', label: 'Bottle', source: 'upload', role: 'reference' }],
      composerSegments: [{ type: 'reference', referenceId: 'token:bottle' }],
    },
  });
  const schema = tool.function.parameters.properties.plan;
  assert.deepEqual(schema.properties.contextReferences.items.enum, ['canvas:scene']);
  assert.deepEqual(schema.properties.visualContext.properties.references.items.properties.referenceId.enum, ['token:bottle']);
  assert.deepEqual(schema.properties.imageTask.properties.targetReferenceId.enum, ['token:bottle']);
  assert.deepEqual(schema.properties.imageTask.properties.supportingReferenceIds.items.enum, ['token:bottle']);
  assert.deepEqual(tool.function.parameters.required, ['plan']);

  const noContextTool = buildAgentExecutionPlanTool({
    referenceContext: {
      references: [{ id: 'token:image', src: 'https://example.test/image.png', plannerPreviewSrc: 'https://example.test/image-preview.png', label: 'Image', source: 'upload', role: 'reference' }],
      composerSegments: [],
    },
  });
  assert.equal(noContextTool.function.parameters.properties.plan.properties.contextReferences.maxItems, 0);
});

test('planner parses a four-poster collage-style request as a standalone series', () => {
  const parsed = parseAgentExecutionPlan(JSON.stringify(plan()), {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
    userMessage: 'Generate four main visual posters',
  });
  assert.ok(parsed);
  assert.equal(parsed.delivery.mode, 'series');
  assert.equal(parsed.delivery.outputCount, 4);
  assert.deepEqual(parsed.delivery.variationAxes, ['layout']);
  assert.deepEqual(parsed.brief.style, ['surreal hand-cut collage']);
  assert.equal(executionPlanToImageDeliveryPlan(parsed).mode, 'series');
});

test('field-level validation fills safe optional fields without guessing semantic fields', () => {
  const draft = structuredClone(plan());
  delete draft.skillId;
  delete draft.clarification;
  delete draft.contextReferences;
  delete draft.brief.style;
  delete draft.brief.literalCopy;
  delete draft.brief.constraints;
  delete draft.delivery.panelCount;
  delete draft.delivery.sharedInvariants;
  delete draft.delivery.distinctPerItem;
  const result = validateAgentExecutionPlan(draft, {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
    manualSkillId: 'magazine-poster',
    userMessage: 'Generate four posters',
  });
  assert.ok(result.plan);
  assert.equal(result.plan.skillId, 'magazine-poster');
  assert.deepEqual(result.plan.brief.style, []);
  assert.equal(result.plan.delivery.mode, 'series');
  assert.ok(result.normalizedFields.includes('brief.style'));

  const missingMode = structuredClone(plan());
  delete missingMode.delivery.mode;
  const invalid = validateAgentExecutionPlan(missingMode, {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
  });
  assert.equal(invalid.plan, null);
  assert.ok(invalid.validationErrors.some((entry) => entry.path === 'delivery.mode' && entry.code === 'required'));
});

test('imageTask and presentation are model-authored optional fields with structural reference validation', () => {
  const imageTask = {
    operation: 'edit',
    targetReferenceId: 'vogue-cover',
    supportingReferenceIds: ['style-board'],
    instruction: '将封面人物替换为两只时尚的狗。',
    mustChange: ['人物主体替换为狗'],
    mustPreserve: ['杂志版式', '原有文字', '红色背景'],
  };
  const presentation = {
    title: 'Vogue Cover – Fashionable Dogs',
    completionSummary: '将人物替换为时尚的狗，并保留原有封面设计。',
  };
  const options = {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
    referenceIds: ['vogue-cover', 'style-board'],
  };
  const groundedVisualContext = visualContext(['vogue-cover', 'style-board'], 'vogue-cover', 'high');
  const editDelivery = { ...plan().delivery, mode: 'single', outputCount: 1 };
  const validated = validateAgentExecutionPlan(plan({ visualContext: groundedVisualContext, imageTask, presentation, delivery: editDelivery }), options);
  assert.ok(validated.plan);
  assert.deepEqual(validated.plan.imageTask, imageTask);
  assert.deepEqual(validated.plan.presentation, presentation);

  const brief = executionPlanToBrief(validated.plan, '换成狗');
  assert.match(brief.plainText, /将封面人物替换为两只时尚的狗。/);
  assert.match(brief.plainText, /人物主体替换为狗/);
  assert.match(brief.plainText, /杂志版式/);
  assert.deepEqual(brief.mustPreserve.slice(0, 3), ['杂志版式', '原有文字', '红色背景']);

  const missingTarget = validateAgentExecutionPlan(plan({
    visualContext: groundedVisualContext,
    imageTask: { ...imageTask, targetReferenceId: null },
  }), options);
  assert.equal(missingTarget.plan, null);
  assert.ok(missingTarget.validationErrors.some((entry) => entry.path === 'imageTask.targetReferenceId' && entry.code === 'required'));

  const unknownTarget = validateAgentExecutionPlan(plan({
    visualContext: groundedVisualContext,
    imageTask: { ...imageTask, targetReferenceId: 'missing' },
  }), options);
  assert.equal(unknownTarget.plan, null);
  assert.ok(unknownTarget.validationErrors.some((entry) => entry.path === 'imageTask.targetReferenceId' && entry.code === 'unknown_reference'));

  const duplicateTarget = validateAgentExecutionPlan(plan({
    visualContext: groundedVisualContext,
    imageTask: { ...imageTask, supportingReferenceIds: ['vogue-cover', 'style-board'] },
    delivery: editDelivery,
  }), options);
  assert.ok(duplicateTarget.plan);
  assert.deepEqual(duplicateTarget.plan.imageTask.supportingReferenceIds, ['style-board']);
  assert.ok(duplicateTarget.normalizedFields.includes('imageTask.supportingReferenceIds'));

  const missingContractArray = structuredClone(plan({ imageTask }));
  delete missingContractArray.imageTask.mustPreserve;
  const incompleteContract = validateAgentExecutionPlan(missingContractArray, options);
  assert.equal(incompleteContract.plan, null);
  assert.ok(incompleteContract.validationErrors.some((entry) => entry.path === 'imageTask.mustPreserve' && entry.code === 'required'));

  const multiOutputEdit = validateAgentExecutionPlan(plan({
    visualContext: groundedVisualContext,
    imageTask,
    delivery: { ...plan().delivery, outputCount: 2 },
  }), options);
  assert.equal(multiOutputEdit.plan, null);
  assert.ok(multiOutputEdit.validationErrors.some((entry) => entry.path === 'delivery.outputCount' && entry.code === 'edit_count_mismatch'));
});

test('image-bearing plans require complete grounded visual context and reject ambiguous edit execution', () => {
  const options = {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
    referenceIds: ['person-photo', 'building-photo'],
  };
  const imageTask = {
    operation: 'edit',
    targetReferenceId: 'person-photo',
    supportingReferenceIds: [],
    instruction: 'Replace the visible person with a dog.',
    mustChange: ['person becomes a dog'],
    mustPreserve: ['background', 'composition'],
  };

  const missingVisualContext = validateAgentExecutionPlan(plan({ imageTask }), options);
  assert.equal(missingVisualContext.plan, null);
  assert.ok(missingVisualContext.validationErrors.some((entry) => entry.path === 'visualContext' && entry.code === 'required'));

  const incompleteVisualContext = visualContext(['person-photo'], 'person-photo', 'high');
  const missingReference = validateAgentExecutionPlan(plan({
    visualContext: incompleteVisualContext,
    imageTask,
  }), options);
  assert.equal(missingReference.plan, null);
  assert.ok(missingReference.validationErrors.some((entry) => entry.code === 'missing_reference'));

  const lowConfidence = validateAgentExecutionPlan(plan({
    visualContext: visualContext(['person-photo', 'building-photo'], 'person-photo', 'low'),
    imageTask,
  }), options);
  assert.equal(lowConfidence.plan, null);
  assert.ok(lowConfidence.validationErrors.some((entry) => entry.code === 'ambiguous_target'));

  const clarificationPlan = plan({
    needsClarification: true,
    clarification: {
      dimension: 'edit_target',
      question: '你希望修改哪一张图片？',
      options: [
        { id: 'person-photo', label: '人物图', answer: '修改人物图' },
        { id: 'building-photo', label: '建筑图', answer: '修改建筑图' },
      ],
    },
    visualContext: {
      ...visualContext(['person-photo', 'building-photo']),
      targetSelectionReason: 'Both images remain plausible targets.',
      targetSelectionConfidence: 'low',
    },
    imageTask: undefined,
    presentation: undefined,
  });
  const clarified = validateAgentExecutionPlan(clarificationPlan, options);
  assert.ok(clarified.plan);
  assert.equal(clarified.plan.imageTask, undefined);
});

test('visual context rejects unknown and duplicate reference ids', () => {
  const options = {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
    referenceIds: ['known'],
  };
  const duplicate = visualContext(['known', 'known']);
  const duplicateResult = validateAgentExecutionPlan(plan({ visualContext: duplicate }), options);
  assert.equal(duplicateResult.plan, null);
  assert.ok(duplicateResult.validationErrors.some((entry) => entry.code === 'duplicate_reference'));

  const unknown = visualContext(['evidence-preview']);
  const unknownResult = validateAgentExecutionPlan(plan({ visualContext: unknown }), options);
  assert.equal(unknownResult.plan, null);
  assert.ok(unknownResult.validationErrors.some((entry) => entry.code === 'unknown_reference'));
});

test('executable image plans without imageTask or presentation fail closed', () => {
  const legacyPlan = plan();
  delete legacyPlan.imageTask;
  delete legacyPlan.presentation;
  const validated = validateAgentExecutionPlan(legacyPlan, {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
  });
  assert.equal(validated.plan, null);
  assert.ok(validated.validationErrors.some((entry) => entry.path === 'imageTask' && entry.code === 'required'));
  assert.ok(validated.validationErrors.some((entry) => entry.path === 'presentation' && entry.code === 'required'));
});

test('image plans require supplier-ready generation prompts with skill-compatible formats', () => {
  const options = {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
    skillPromptStylesById: { 'magazine-poster': 'json-text' },
  };
  const missing = plan();
  delete missing.generation;
  const missingResult = validateAgentExecutionPlan(missing, options);
  assert.equal(missingResult.plan, null);
  assert.ok(missingResult.validationErrors.some((entry) => entry.path === 'generation' && entry.code === 'required'));

  const wrongFormat = validateAgentExecutionPlan(plan({
    generation: { promptFormat: 'text', prompt: 'Create the requested deliverables and preserve Literal copy and explicit constraints', items: [] },
  }), options);
  assert.equal(wrongFormat.plan, null);
  assert.ok(wrongFormat.validationErrors.some((entry) => entry.code === 'skill_prompt_style_mismatch'));

  const incompleteSeries = validateAgentExecutionPlan(plan({
    generation: { ...plan().generation, items: plan().generation.items.slice(0, 3) },
  }), options);
  assert.equal(incompleteSeries.plan, null);
  assert.ok(incompleteSeries.validationErrors.some((entry) => entry.path === 'generation.items' && entry.code === 'item_count_mismatch'));

  const nonImage = validateAgentExecutionPlan(plan({
    intent: 'analysis',
    generation: plan().generation,
    execution: { kind: 'none', requiresConfirmation: false, tool: null },
  }), options);
  assert.equal(nonImage.plan, null);
  assert.ok(nonImage.validationErrors.some((entry) => entry.path === 'generation' && entry.code === 'intent_mismatch'));

  const indirectImage = validateAgentExecutionPlan(plan({
    execution: { kind: 'agent_loop', requiresConfirmation: false, tool: 'generate_image' },
  }), options);
  assert.equal(indirectImage.plan, null);
  assert.ok(indirectImage.validationErrors.some((entry) => entry.code === 'image_execution_kind_mismatch'));
});

test('non-clarifying plans ignore empty clarification placeholders from tool schemas', () => {
  const result = validateAgentExecutionPlan(plan({
    needsClarification: false,
    clarification: {
      dimension: '',
      question: '',
      options: [
        { id: '', label: '', answer: '' },
        { id: '', label: '', answer: '' },
      ],
    },
  }), {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
    skillPromptStylesById: { 'magazine-poster': 'json-text' },
  });
  assert.ok(result.plan);
  assert.equal(result.plan.clarification, null);
  assert.ok(result.normalizedFields.includes('clarification'));
  assert.doesNotMatch(JSON.stringify(result.validationErrors), /clarification\./);
});

test('single planner request materializes omitted prompt constraints and deterministic image tool', async () => {
  let calls = 0;
  const draft = plan({
    delivery: {
      ...plan().delivery,
      mode: 'single',
      outputCount: 1,
      panelCount: null,
      items: [],
    },
    generation: {
      promptFormat: 'json-text',
      prompt: JSON.stringify({
        subject: 'fragmented Greek statue',
        direction: 'Create a cohesive editorial poster while retaining its intended copy and constraints.',
        visible_copy: 'disassembled gods',
      }),
      items: [],
    },
    execution: { kind: 'image_pipeline', requiresConfirmation: false },
  });
  const result = await planAgentExecutionRequest({
    userMessage: '生成这张编辑海报',
    messages: [{ role: 'user', content: '生成这张编辑海报' }],
    manifests,
    model: 'planner-model',
    providerId: 'provider',
    chatFn: async () => {
      calls += 1;
      return toolResponse(draft);
    },
  });

  assert.equal(calls, 1);
  assert.ok(result.plan);
  assert.equal(result.plan.execution.tool, 'generate_image');
  assert.ok(result.normalizedFields.includes('execution.tool'));
  assert.ok(result.normalizedFields.includes('generation.prompt'));
  const parsedPrompt = JSON.parse(result.plan.generation.prompt);
  assert.equal(parsedPrompt.subject, 'fragmented Greek statue');
  assert.deepEqual(parsedPrompt.agent_requirements.must_change, draft.imageTask.mustChange);
  assert.deepEqual(parsedPrompt.agent_requirements.must_preserve, draft.imageTask.mustPreserve);
  assert.deepEqual(parsedPrompt.agent_requirements.literal_copy, draft.brief.literalCopy);
});

test('text prompt contracts avoid duplicate semantic constraints and preserve literal-copy casing', () => {
  const imageTask = {
    operation: 'generate',
    targetReferenceId: null,
    supportingReferenceIds: [],
    instruction: 'Create a fashion magazine cover.',
    mustChange: ['Replace person with dogs'],
    mustPreserve: ['Keep the red background'],
  };
  const validated = validateAgentExecutionPlan(plan({
    skillId: null,
    imageTask,
    brief: {
      deliverable: 'one magazine cover',
      subject: 'fashionable dogs',
      style: ['editorial'],
      literalCopy: ['VOGUE'],
      constraints: [],
    },
    delivery: {
      ...plan().delivery,
      mode: 'single',
      outputCount: 1,
      panelCount: null,
      items: [],
    },
    generation: {
      promptFormat: 'text',
      prompt: 'Replace PERSON with DOGS. Add the exact cover text vogue.',
      items: [],
    },
    execution: { kind: 'image_pipeline', requiresConfirmation: false },
  }));

  assert.ok(validated.plan);
  const finalPrompt = validated.plan.generation.prompt;
  assert.equal((finalPrompt.match(/Replace person with dogs/gi) || []).length, 1);
  assert.match(finalPrompt, /Keep the red background/);
  assert.match(finalPrompt, /Literal copy \(reproduce exactly\):\n- VOGUE/);
  assert.equal(validated.plan.execution.tool, 'generate_image');
});

test('series prompts receive complete per-item contracts while invalid JSON objects still fail closed', () => {
  const incompleteJsonPrompt = (label) => JSON.stringify({ subject: label, composition: 'editorial cover' });
  const seriesDraft = plan({
    generation: {
      promptFormat: 'json-text',
      prompt: incompleteJsonPrompt('shared direction'),
      items: plan().delivery.items.map((item) => ({
        index: item.index,
        label: item.label,
        prompt: incompleteJsonPrompt(item.label),
      })),
    },
  });
  const seriesResult = validateAgentExecutionPlan(seriesDraft, {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
    skillPromptStylesById: { 'magazine-poster': 'json-text' },
  });
  assert.ok(seriesResult.plan);
  for (const item of seriesResult.plan.generation.items) {
    const parsed = JSON.parse(item.prompt);
    assert.deepEqual(parsed.agent_requirements.must_change, seriesDraft.imageTask.mustChange);
    assert.deepEqual(parsed.agent_requirements.must_preserve, seriesDraft.imageTask.mustPreserve);
    assert.deepEqual(parsed.agent_requirements.literal_copy, seriesDraft.brief.literalCopy);
  }

  const invalidArray = validateAgentExecutionPlan(plan({
    delivery: {
      ...plan().delivery,
      mode: 'single',
      outputCount: 1,
      panelCount: null,
      items: [],
    },
    generation: { promptFormat: 'json-text', prompt: '[]', items: [] },
  }), {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
    skillPromptStylesById: { 'magazine-poster': 'json-text' },
  });
  assert.equal(invalidArray.plan, null);
  assert.ok(invalidArray.validationErrors.some((entry) => entry.path === 'generation.prompt' && entry.code === 'invalid_json_text'));
});

test('explicitly mismatched deterministic tools remain invalid', () => {
  const result = validateAgentExecutionPlan(plan({
    execution: { kind: 'image_pipeline', requiresConfirmation: false, tool: 'start_skill_job' },
  }), {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image', 'start_skill_job'] },
    skillPromptStylesById: { 'magazine-poster': 'json-text' },
  });
  assert.equal(result.plan, null);
  assert.ok(result.validationErrors.some((entry) => entry.path === 'execution.tool' && entry.code === 'execution_tool_mismatch'));
});

test('planner validates composite scope, skill ids, tools, contexts, and batch limits locally', () => {
  const options = {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
  };
  assert.equal(parseAgentExecutionPlan(JSON.stringify(plan({
    delivery: { ...plan().delivery, mode: 'composite', outputCount: 1, panelCount: null, items: [] },
  })), options), null);
  assert.equal(parseAgentExecutionPlan(JSON.stringify(plan({ skillId: 'missing-skill' })), options), null);
  assert.equal(parseAgentExecutionPlan(JSON.stringify(plan({ contextReferences: ['missing-context'] })), {
    ...options,
    contextEntityIds: ['known-context'],
  }), null);
  assert.equal(parseAgentExecutionPlan(JSON.stringify(plan({
    execution: { requiresConfirmation: true, tool: 'delete_everything' },
  })), options), null);
  assert.equal(parseAgentExecutionPlan(JSON.stringify(plan({
    delivery: {
      ...plan().delivery,
      outputCount: 101,
      items: Array.from({ length: 101 }, (_, index) => ({ index: index + 1, label: `Item ${index + 1}`, subject: 'subject', variation: 'variation' })),
    },
  })), options), null);
  assert.equal(parseAgentExecutionPlan(JSON.stringify(plan({
    delivery: { ...plan().delivery, items: plan().delivery.items.slice(0, 3) },
  })), options), null);
});

test('planner has no local semantic fallback, including explicit one-file panel wording', () => {
  const semanticOnly = buildFallbackAgentExecutionPlan({
    userMessage: '生成4张不同版式的海报，采用 hand-cut collage 拼贴艺术风格',
    manifests,
  });
  assert.equal(semanticOnly, null);

  const explicit = buildFallbackAgentExecutionPlan({
    userMessage: '做一张四宫格，每格一个方向',
    manifests,
  });
  assert.equal(explicit, null);
});

test('required tool arguments win over compatibility text and preserve magazine-poster series semantics', async () => {
  let request;
  const result = await planAgentExecutionRequest({
    userMessage: 'Generate four main visual posters in a surreal hand-cut collage style',
    messages: [{ role: 'user', content: 'Generate four main visual posters in a surreal hand-cut collage style' }],
    manifests,
    model: 'planner-model',
    providerId: 'provider',
    chatFn: async (value) => {
      request = value;
      return toolResponse(plan(), JSON.stringify({ intent: 'chat' }));
    },
  });
  assert.equal(result.source, 'model');
  assert.equal(result.sourceDetail, 'tool_call');
  assert.equal(result.attempts, 1);
  assert.equal(result.plan.skillId, 'magazine-poster');
  assert.equal(result.plan.delivery.mode, 'series');
  assert.equal(result.plan.delivery.outputCount, 4);
  assert.equal(result.plan.delivery.panelCount, null);
  assert.deepEqual(result.plan.delivery.variationAxes, ['layout']);
  assert.deepEqual(request.toolChoice, { type: 'function', function: { name: 'submit_agent_execution_plan' } });
  assert.equal(request.tools[0].function.name, 'submit_agent_execution_plan');
});

test('model-authored edit intent survives request planning without local reinterpretation', async () => {
  const imageTask = {
    operation: 'edit',
    targetReferenceId: 'vogue-cover',
    supportingReferenceIds: [],
    instruction: '将封面人物替换为两只时尚的狗。',
    mustChange: ['人物主体替换为狗'],
    mustPreserve: ['杂志版式', '原有文字', '红色背景'],
  };
  const presentation = {
    title: 'Vogue Cover – Fashionable Dogs',
    completionSummary: '将人物替换为时尚的狗，并保留原有封面设计。',
  };
  const result = await planAgentExecutionRequest({
    userMessage: '换成狗',
    messages: [{ role: 'user', content: '换成狗' }],
    manifests,
    referenceContext: {
      references: [{ id: 'vogue-cover', src: 'https://example.test/vogue.png', plannerPreviewSrc: 'https://example.test/vogue-preview.png', label: 'Vogue Cover', source: 'canvas', role: 'edit_target' }],
      composerSegments: [
        { type: 'reference', referenceId: 'vogue-cover' },
        { type: 'text', text: ' 换成狗' },
      ],
    },
    model: 'planner-model',
    providerId: 'provider',
    chatFn: async () => toolResponse(plan({
      visualContext: visualContext(['vogue-cover'], 'vogue-cover', 'high'),
      imageTask,
      presentation,
      delivery: { ...plan().delivery, mode: 'single', outputCount: 1 },
    })),
  });
  assert.equal(result.source, 'model');
  assert.deepEqual(result.plan.imageTask, imageTask);
  assert.deepEqual(result.plan.presentation, presentation);
});

test('planner rejects one invalid structured draft without a repair request', async () => {
  let calls = 0;
  const invalid = structuredClone(plan());
  delete invalid.delivery.mode;
  delete invalid.execution.tool;
  const result = await planAgentExecutionRequest({
    userMessage: 'Generate four posters',
    messages: [{ role: 'user', content: 'Generate four posters' }],
    manifests,
    model: 'planner-model',
    providerId: 'provider',
    chatFn: async () => {
      calls += 1;
      return toolResponse(invalid);
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.plan, null);
  assert.equal(result.sourceDetail, 'planner_failed');
  assert.equal(result.repairAttempted, false);
  assert.equal(result.attempts, 1);
  assert.ok(result.validationErrors.some((entry) => entry.path === 'delivery.mode'));
  assert.ok(result.normalizedFields.includes('execution.tool'));
});

test('planner never retries a transport interruption', async () => {
  let calls = 0;
  const result = await planAgentExecutionRequest({
    userMessage: 'Generate one poster',
    messages: [{ role: 'user', content: 'Generate one poster' }],
    manifests,
    model: 'planner-model',
    providerId: 'provider',
    chatFn: async () => {
      calls += 1;
      const error = new Error('response aborted');
      error.name = 'ResponseAborted';
      throw error;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.plan, null);
  assert.equal(result.failureReason, 'transport');
  assert.equal(result.attempts, 1);
  assert.equal(result.diagnostics[0].attempt, 1);
  assert.equal(result.diagnostics[0].providerId, 'provider');
});

test('planner classifies a single request timeout without retrying', async () => {
  let calls = 0;
  const result = await planAgentExecutionRequest({
    userMessage: 'Generate one poster',
    messages: [{ role: 'user', content: 'Generate one poster' }],
    manifests,
    model: 'planner-model',
    providerId: 'provider',
    chatFn: async () => {
      calls += 1;
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.failureReason, 'timeout');
  assert.equal(result.attempts, 1);
  assert.equal(result.diagnostics.length, 1);
});

test('planner classifies unsupported and unreadable multimodal inputs without producing a plan', async () => {
  const referenceContext = {
    references: [{
      id: 'photo',
      src: 'https://example.test/photo.png',
      plannerPreviewSrc: 'https://example.test/photo-preview.png',
      label: 'Photo',
      source: 'upload',
      role: 'reference',
    }],
    composerSegments: [{ type: 'reference', referenceId: 'photo' }],
  };
  const unsupported = await planAgentExecutionRequest({
    userMessage: '分析这张图',
    messages: [{ role: 'user', content: '分析这张图' }],
    manifests,
    referenceContext,
    model: 'text-only-model',
    providerId: 'provider',
    chatFn: async () => {
      throw new Error('Unsupported modality: image input is not supported');
    },
  });
  assert.equal(unsupported.plan, null);
  assert.equal(unsupported.failureReason, 'vision_unsupported');

  let unreadableCalls = 0;
  const unreadable = await planAgentExecutionRequest({
    userMessage: '分析这张图',
    messages: [{ role: 'user', content: '分析这张图' }],
    manifests,
    referenceContext,
    model: 'vision-model',
    providerId: 'provider',
    chatFn: async () => {
      unreadableCalls += 1;
      throw new TypeError('Image fetch failed while downloading the supplied image');
    },
  });
  assert.equal(unreadableCalls, 1);
  assert.equal(unreadable.plan, null);
  assert.equal(unreadable.failureReason, 'vision_unavailable');
});

test('planner does not call the model for an already-aborted request', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(() => planAgentExecutionRequest({
      userMessage: 'Generate one poster',
      messages: [{ role: 'user', content: 'Generate one poster' }],
      manifests,
      model: 'planner-model',
      providerId: 'provider',
      signal: controller.signal,
      chatFn: async () => {
        calls += 1;
        return toolResponse(plan());
      },
    }), /abort/i);
  assert.equal(calls, 0);
});

test('planner does not retry a typed local reference image failure', async () => {
  let calls = 0;
  const result = await planAgentExecutionRequest({
    userMessage: '分析这张图',
    messages: [{ role: 'user', content: '分析这张图' }],
    manifests,
    referenceContext: {
      references: [{ id: 'photo', src: '/api/local-assets/uploads/original.png', plannerPreviewSrc: '/api/local-assets/uploads/missing.png', label: 'Photo', source: 'upload', role: 'reference' }],
      composerSegments: [{ type: 'reference', referenceId: 'photo' }],
    },
    model: 'vision-model',
    providerId: 'provider',
    chatFn: async () => {
      calls += 1;
      return toolResponse(plan());
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.plan, null);
  assert.equal(result.failureReason, 'vision_unavailable');
  assert.equal(result.attempts, 0);
  assert.deepEqual(result.diagnostics, []);
});

test('planner fails closed after one invalid attempt without local semantic fallback', async () => {
  let calls = 0;
  const chatFn = async () => {
    calls += 1;
    return { choices: [{ message: { content: 'invalid' } }] };
  };
  const failed = await planAgentExecutionRequest({
    userMessage: 'Generate four different collage posters',
    messages: [{ role: 'user', content: 'Generate four different collage posters' }],
    manifests,
    model: 'planner-model',
    providerId: 'provider',
    chatFn,
  });
  assert.equal(failed.plan, null);
  assert.equal(failed.source, 'fallback');
  assert.equal(failed.sourceDetail, 'planner_failed');
  assert.equal(failed.attempts, 1);
  assert.equal(calls, 1);

  const explicitCompositeFailure = await planAgentExecutionRequest({
    userMessage: '做一张四宫格',
    messages: [{ role: 'user', content: '做一张四宫格' }],
    manifests,
    model: 'planner-model',
    providerId: 'provider',
    chatFn,
  });
  assert.equal(explicitCompositeFailure.sourceDetail, 'planner_failed');
  assert.equal(explicitCompositeFailure.plan, null);
});

test('planner distinguishes unknown canvas context ids from unknown image reference ids', async () => {
  const unknownContextPlan = plan({ contextReferences: ['token:image'] });
  const invalidContext = await planAgentExecutionRequest({
    userMessage: '生成海报',
    messages: [{ role: 'user', content: '生成海报' }],
    manifests,
    contextEntities: [{ id: 'canvas:scene', label: 'Scene' }],
    referenceContext: {
      references: [{ id: 'token:image', src: 'https://example.test/image.png', plannerPreviewSrc: 'https://example.test/image-preview.png', label: 'Image', source: 'upload', role: 'reference' }],
      composerSegments: [{ type: 'reference', referenceId: 'token:image' }],
    },
    model: 'planner-model',
    providerId: 'provider',
    chatFn: async () => toolResponse(unknownContextPlan),
  });
  assert.equal(invalidContext.plan, null);
  assert.equal(invalidContext.failureReason, 'invalid_context');

  const bothNamespacesInvalid = plan({
    contextReferences: ['missing-context'],
    visualContext: visualContext(['token:image'], 'token:image', 'high'),
    imageTask: {
      operation: 'edit',
      targetReferenceId: 'missing-image',
      supportingReferenceIds: [],
      instruction: 'Edit the selected image.',
      mustChange: ['subject'],
      mustPreserve: ['composition'],
    },
  });
  const invalidBoth = await planAgentExecutionRequest({
    userMessage: '编辑图片',
    messages: [{ role: 'user', content: '编辑图片' }],
    manifests,
    contextEntities: [{ id: 'canvas:scene', label: 'Scene' }],
    referenceContext: {
      references: [{ id: 'token:image', src: 'https://example.test/image.png', plannerPreviewSrc: 'https://example.test/image-preview.png', label: 'Image', source: 'upload', role: 'reference' }],
      composerSegments: [{ type: 'reference', referenceId: 'token:image' }],
    },
    model: 'planner-model',
    providerId: 'provider',
    chatFn: async () => toolResponse(bothNamespacesInvalid),
  });
  assert.equal(invalidBoth.plan, null);
  assert.equal(invalidBoth.failureReason, 'invalid_plan');
});
