import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_EXECUTION_PLAN_TOOL,
  buildAgentExecutionPlannerMessages,
  buildFallbackAgentExecutionPlan,
  executionPlanToImageDeliveryPlan,
  parseAgentExecutionPlan,
  planAgentExecutionRequest,
  validateAgentExecutionPlan,
} from './execution-planner.mjs';

const manifests = [{
  id: 'magazine-poster',
  name: 'Magazine Poster',
  description: 'Editorial typography, magazine covers, and art-directed collage posters',
  triggerHints: ['editorial poster', 'collage editorial poster'],
  planningGuidance: 'Use for typography-led cultural and collage editorial posters.',
  allowedTools: ['generate_image'],
  executionMode: 'image_pipeline',
  promptStyle: 'json-text',
  enabled: true,
}];

function plan(overrides = {}) {
  return {
    version: 1,
    intent: 'image',
    skillId: 'magazine-poster',
    confidence: 'high',
    needsClarification: false,
    clarification: null,
    contextReferences: [],
    brief: {
      deliverable: 'four standalone posters',
      subject: 'fragmented Greek statue',
      style: ['surreal hand-cut collage'],
      literalCopy: ['DISASSEMBLED GODS', 'Truths are torn, not told'],
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
    execution: { kind: 'image_pipeline', requiresConfirmation: true, tool: 'generate_image' },
    ...overrides,
  };
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
  assert.match(messages[1].content, /planningGuidance/);
  assert.equal(AGENT_EXECUTION_PLAN_TOOL.function.name, 'submit_agent_execution_plan');
  assert.deepEqual(AGENT_EXECUTION_PLAN_TOOL.function.parameters.required, ['plan']);
});

test('planner tool schema is Gemini-compatible while runtime validation enforces version 1', () => {
  const versionSchema = AGENT_EXECUTION_PLAN_TOOL.function.parameters.properties.plan.properties.version;
  assert.equal(versionSchema.type, 'integer');
  assert.equal(versionSchema.enum, undefined);
  assert.match(versionSchema.description, /must be 1/i);
  assertStringEnums(AGENT_EXECUTION_PLAN_TOOL.function.parameters);

  const options = {
    allowedSkillIds: ['magazine-poster'],
    skillToolsById: { 'magazine-poster': ['generate_image'] },
  };
  const valid = validateAgentExecutionPlan(plan({ version: 1 }), options);
  assert.ok(valid.plan);
  assert.equal(valid.plan.version, 1);

  const invalid = validateAgentExecutionPlan(plan({ version: 2 }), options);
  assert.equal(invalid.plan, null);
  assert.ok(invalid.validationErrors.some((entry) => entry.path === 'version' && entry.code === 'unsupported_version'));
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

test('hard fallback ignores collage and poster semantics but recognizes explicit one-file panels', () => {
  const semanticOnly = buildFallbackAgentExecutionPlan({
    userMessage: '生成4张不同版式的海报，采用 hand-cut collage 拼贴艺术风格',
    manifests,
  });
  assert.equal(semanticOnly, null);

  const explicit = buildFallbackAgentExecutionPlan({
    userMessage: '做一张四宫格，每格一个方向',
    manifests,
  });
  assert.ok(explicit);
  assert.equal(explicit.delivery.mode, 'composite');
  assert.equal(explicit.delivery.outputCount, 1);
  assert.equal(explicit.delivery.panelCount, 4);
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

test('planner repairs one invalid structured draft and does not silently fall back', async () => {
  let calls = 0;
  const invalid = structuredClone(plan());
  delete invalid.delivery.mode;
  const result = await planAgentExecutionRequest({
    userMessage: 'Generate four posters',
    messages: [{ role: 'user', content: 'Generate four posters' }],
    manifests,
    model: 'planner-model',
    providerId: 'provider',
    chatFn: async (request) => {
      calls += 1;
      if (calls === 1) return toolResponse(invalid);
      assert.match(request.messages.at(-1).content, /delivery\.mode/);
      return toolResponse(plan());
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.source, 'model');
  assert.equal(result.sourceDetail, 'repaired_tool_call');
  assert.equal(result.repairAttempted, true);
  assert.equal(result.plan.delivery.mode, 'series');
});

test('planner fails closed after two invalid attempts and only hard literals may fall back', async () => {
  const chatFn = async () => ({ choices: [{ message: { content: 'invalid' } }] });
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
  assert.equal(failed.attempts, 2);

  const hardFallback = await planAgentExecutionRequest({
    userMessage: '做一张四宫格',
    messages: [{ role: 'user', content: '做一张四宫格' }],
    manifests,
    model: 'planner-model',
    providerId: 'provider',
    chatFn,
  });
  assert.equal(hardFallback.sourceDetail, 'hard_literal');
  assert.equal(hardFallback.plan.delivery.mode, 'composite');
});
