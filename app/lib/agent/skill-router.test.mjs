import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSkillRouterMessages,
  filterSkillCandidates,
  parseAgentRoutingDecision,
  routeAgentRequest,
} from './skill-router.mjs';

const manifests = [
  {
    id: 'logo',
    name: 'Logo 与品牌',
    description: '设计品牌标志和基础视觉方向',
    triggerHints: ['logo', '标志', '品牌名称'],
    allowedTools: ['generate_image'],
    enabled: true,
  },
  {
    id: 'brand',
    name: '品牌识别系统',
    description: '生成品牌策略、VI 与品牌物料',
    triggerHints: ['品牌', 'VI', '品牌物料'],
    allowedTools: ['generate_image', 'start_skill_job'],
    enabled: true,
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `extra-${index}`,
    name: `额外技能 ${index}`,
    description: `处理海报设计 ${index}`,
    triggerHints: ['海报'],
    allowedTools: [],
    enabled: true,
  })),
];

test('candidate filtering returns at most five relevant manifest summaries', () => {
  const candidates = filterSkillCandidates('为品牌设计一张海报', manifests);
  assert.equal(candidates.length, 5);
  assert.ok(candidates.every((item) => !('allowedTools' in item)));
  assert.ok(candidates.some((item) => item.id === 'brand'));
});

test('router messages expose only candidate summaries and require strict JSON', () => {
  const candidates = filterSkillCandidates('设计 logo', manifests);
  const messages = buildSkillRouterMessages({
    userMessage: '设计 logo',
    candidates,
    hasReferenceImages: false,
  });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Return exactly one JSON object/);
  assert.match(messages[1].content, /Logo 与品牌/);
  assert.doesNotMatch(messages[1].content, /allowedTools/);
});

test('routing parser rejects unknown skills and normalizes low-confidence choices', () => {
  const known = parseAgentRoutingDecision(JSON.stringify({
    version: 1,
    intent: 'image',
    skillId: 'logo',
    confidence: 0.9,
    needsClarification: false,
  }), ['logo']);
  assert.equal(known.skillId, 'logo');

  assert.equal(parseAgentRoutingDecision(JSON.stringify({
    version: 1,
    intent: 'chat',
    skillId: 'unknown',
    confidence: 0.9,
    needsClarification: false,
  }), ['logo']), null);

  const lowConfidence = parseAgentRoutingDecision(JSON.stringify({
    version: 1,
    intent: 'chat',
    skillId: 'logo',
    confidence: 0.2,
    needsClarification: false,
  }), ['logo']);
  assert.equal(lowConfidence.skillId, null);

  const missingWorkflowSkill = parseAgentRoutingDecision(JSON.stringify({
    version: 1,
    intent: 'skill_action',
    skillId: null,
    confidence: 0.9,
    needsClarification: false,
  }), ['brand']);
  assert.equal(missingWorkflowSkill.intent, 'chat');
  assert.equal(missingWorkflowSkill.skillId, null);

  const lowConfidenceWorkflow = parseAgentRoutingDecision(JSON.stringify({
    version: 1,
    intent: 'skill_action',
    skillId: 'brand',
    confidence: 0.2,
    needsClarification: false,
  }), ['brand']);
  assert.equal(lowConfidenceWorkflow.intent, 'chat');
  assert.equal(lowConfidenceWorkflow.skillId, null);
});

test('manual skill bypasses the router model and remains selected', async () => {
  let calls = 0;
  const result = await routeAgentRequest({
    userMessage: '随便聊聊',
    manifests,
    manualSkillId: 'logo',
    chatFn: async () => {
      calls += 1;
      return null;
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.skillId, 'logo');
  assert.equal(result.intent, 'chat');
  assert.equal(result.source, 'manual');
});

test('automatic router validates model JSON and falls back safely on failure', async () => {
  const selected = await routeAgentRequest({
    userMessage: '帮我设计一个 logo',
    manifests,
    routerModel: 'fast-router',
    chatFn: async () => ({
      choices: [{ message: { content: JSON.stringify({
        version: 1,
        intent: 'image',
        skillId: 'logo',
        confidence: 0.95,
        needsClarification: false,
      }) } }],
    }),
  });
  assert.equal(selected.skillId, 'logo');
  assert.equal(selected.source, 'auto');

  const fallback = await routeAgentRequest({
    userMessage: '开始批量生成全部品牌物料',
    manifests,
    routerModel: 'fast-router',
    chatFn: async () => { throw new Error('router unavailable'); },
  });
  assert.equal(fallback.intent, 'chat');
  assert.equal(fallback.skillId, null);
});
