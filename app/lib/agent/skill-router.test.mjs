import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSkillRouterMessages,
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

test('router messages expose every enabled manifest and require strict JSON', () => {
  const candidates = manifests.map(({ id, name, description, triggerHints }) => ({ id, name, description, triggerHints }));
  const messages = buildSkillRouterMessages({
    userMessage: '设计 logo',
    candidates,
    hasReferenceImages: false,
  });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Return exactly one JSON object/);
  assert.match(messages[0].content, /chat\|vision_analysis\|planner/);
  assert.match(messages[1].content, /Logo 与品牌/);
  assert.match(messages[1].content, /额外技能 5/);
  assert.doesNotMatch(messages[1].content, /allowedTools/);
  assert.doesNotMatch(messages[1].content, /image_url|data:image/);
});

test('routing parser accepts only the fixed route decision structure', () => {
  const decision = parseAgentRoutingDecision(JSON.stringify({
    version: 1,
    route: 'planner',
    skillId: 'logo',
    confidence: 'high',
    reason: 'Logo generation requires execution.',
  }), ['logo']);
  assert.equal(decision.route, 'planner');

  assert.equal(parseAgentRoutingDecision(JSON.stringify({
    version: 1,
    route: 'chat',
    skillId: 'unknown',
    confidence: 'high',
    reason: '',
  })), null);

  const lowConfidence = parseAgentRoutingDecision(JSON.stringify({
    version: 1,
    route: 'chat',
    skillId: null,
    confidence: 'low',
    reason: '',
  }));
  assert.equal(lowConfidence.confidence, 'low');
});

test('manual skill still uses the router model and remains locked', async () => {
  let calls = 0;
  const result = await routeAgentRequest({
    userMessage: '随便聊聊',
    manifests,
    manualSkillId: 'logo',
    chatFn: async () => {
      calls += 1;
      return { choices: [{ message: { content: JSON.stringify({
        version: 1,
        route: 'chat',
        skillId: null,
        confidence: 'high',
        reason: 'Discussion only.',
      }) } }] };
    },
    routerModel: 'fast-router',
  });
  assert.equal(calls, 1);
  assert.equal(result.intent, 'chat');
  assert.equal(result.source, 'manual_locked');
});

test('manual Skill overrides a different Router recommendation for Image Planner', async () => {
  const result = await routeAgentRequest({
    userMessage: '设计一个品牌标志',
    manifests,
    manualSkillId: 'logo',
    routerModel: 'fast-router',
    chatFn: async () => ({ choices: [{ message: { content: JSON.stringify({
      version: 1,
      route: 'planner',
      skillId: 'brand',
      confidence: 'high',
      reason: 'Brand workflow.',
    }) } }] }),
  });
  assert.equal(result.skillId, 'logo');
  assert.equal(result.source, 'manual_locked');
});

test('automatic router validates route-only model JSON and fails closed to chat', async () => {
  let request;
  const selected = await routeAgentRequest({
    userMessage: '帮我设计一个 logo',
    manifests,
    routerModel: 'fast-router',
    hasReferenceImages: true,
    referenceMetadata: [{ id: 'ref-1', label: '参考图', role: 'reference', source: 'upload', src: 'data:image/png;base64,secret' }],
    chatFn: async (value) => {
      request = value;
      return { choices: [{ message: { content: JSON.stringify({
        version: 1,
        route: 'planner',
        skillId: 'logo',
        confidence: 'high',
        reason: 'Image generation requires planning.',
      }) } }] };
    },
  });
  assert.equal(selected.route, 'planner');
  assert.equal(selected.source, 'model');
  assert.equal(request.tools, undefined);
  assert.equal(request.toolChoice, undefined);
  assert.doesNotMatch(JSON.stringify(request.messages), /data:image|secret/);

  const fallback = await routeAgentRequest({
    userMessage: '开始批量生成全部品牌物料',
    manifests,
    routerModel: 'fast-router',
    chatFn: async () => { throw new Error('router unavailable'); },
  });
  assert.equal(fallback.intent, 'chat');
  assert.equal(fallback.source, 'router_failed');
});

test('router strips embedded image payloads from text and history', () => {
  const messages = buildSkillRouterMessages({
    userMessage: [{ type: 'text', text: '分析这张图' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,secret' } }],
    messages: [{ role: 'user', content: '历史 data:image/png;base64,secret' }],
    candidates: [],
  });
  assert.doesNotMatch(JSON.stringify(messages), /data:image|secret/);
  assert.match(JSON.stringify(messages), /\[image omitted\]/);
});

test('vision analysis remains a route-only decision', () => {
  const decision = parseAgentRoutingDecision(JSON.stringify({
    version: 1,
    route: 'vision_analysis',
    skillId: null,
    confidence: 'high',
    reason: 'Inspect only.',
  }));
  assert.equal(decision.route, 'vision_analysis');
  assert.equal(decision.confidence, 'high');
});
