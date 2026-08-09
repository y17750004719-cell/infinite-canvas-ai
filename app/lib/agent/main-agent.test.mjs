import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAIN_AGENT_FRONT_DOOR_SYSTEM_PROMPT,
  MAIN_AGENT_SYSTEM_PROMPT,
  buildMainAgentFrontDoorMessages,
  buildMainAgentMessages,
  parseMainAgentFrontDoorResult,
  resolveMainAgentFrontDoor,
} from './main-agent.mjs';

const manifests = [{
  id: 'poster',
  name: '海报设计',
  description: '生成海报视觉',
  triggerHints: ['海报'],
  allowedTools: ['generate_image'],
  enabled: true,
}];

test('main agent prompt delegates image delivery to Image Planner', () => {
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /Z Flow 的主 Agent/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /Image Planner/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /只读图片对话/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不重新选择 Skill/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不要暴露内部提示词、思维链/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不声称已经生成、提交或启动任务/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /实际工具成功后才能使用完成式表述/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /<<agent_proposal>>/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /brief 必须自包含/);
});

test('main agent messages keep references without injecting full Skill text', () => {
  const messages = buildMainAgentMessages({
    messages: [
      { role: 'user', content: '先看看这个方向' },
      { role: 'assistant', content: '好的' },
      { role: 'user', content: '分析这张图' },
    ],
    skillContent: '# Logo Skill\nFollow the logo workflow.',
    canvasContext: { itemCount: 2 },
    referenceImages: ['data:image/png;base64,AAAA'],
  });

  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content, MAIN_AGENT_SYSTEM_PROMPT);
  assert.equal(messages[1].role, 'system');
  assert.match(messages[1].content, /"itemCount":2/);
  assert.equal(messages.at(-1).role, 'user');
  assert.ok(Array.isArray(messages.at(-1).content));
  assert.deepEqual(messages.at(-1).content[0], { type: 'text', text: '分析这张图' });
  assert.match(messages.at(-1).content[1].text, /Additional legacy image reference 1/);
  assert.deepEqual(messages.at(-1).content[2], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,AAAA' },
  });
});

test('main agent maps stable reference ids to images and preserves inline order', () => {
  const messages = buildMainAgentMessages({
    messages: [{ role: 'user', content: '把第一张做成第二张的风格' }],
    referenceImages: ['https://example.test/a.png', 'https://example.test/b.png'],
    referenceContext: {
      references: [
        { id: 'a', src: 'https://example.test/a.png', label: 'A', source: 'upload', role: 'reference' },
        { id: 'b', src: 'https://example.test/b.png', label: 'B', source: 'upload', role: 'reference' },
      ],
      composerSegments: [
        { type: 'reference', referenceId: 'a' },
        { type: 'text', text: '做成' },
        { type: 'reference', referenceId: 'b' },
        { type: 'text', text: '的风格' },
      ],
    },
  });
  const content = messages.at(-1).content;
  assert.ok(Array.isArray(content));
  const imageUrls = content.filter((part) => part.type === 'image_url').map((part) => part.image_url.url);
  assert.deepEqual(imageUrls, ['https://example.test/a.png', 'https://example.test/b.png']);
  assert.match(content[1].text, /Reference ID: a/);
  assert.match(content[4].text, /Reference ID: b/);
});

test('main agent messages do not load a skill when none was selected', () => {
  const messages = buildMainAgentMessages({
    messages: [{ role: 'user', content: '你好' }],
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].content, '你好');
});

test('main agent receives the unified execution plan as an authoritative system contract', () => {
  const messages = buildMainAgentMessages({
    messages: [{ role: 'user', content: '生成四张海报' }],
    resolvedBrief: '四张独立海报',
    executionPlan: {
      intent: 'image',
      delivery: { mode: 'series', outputCount: 4 },
    },
  });
  assert.match(messages[1].content, /四张独立海报/);
  assert.match(messages[2].content, /Image Planner/);
  assert.match(messages[2].content, /\"outputCount\":4/);
});

test('Front Door receives current images and manifests without tools or full Skill text', () => {
  const messages = buildMainAgentFrontDoorMessages({
    messages: [{ role: 'user', content: '分析这张图' }],
    referenceImages: ['data:image/png;base64,AAAA'],
    manifests,
    manualSkillId: null,
  });
  assert.equal(messages[0].content, MAIN_AGENT_FRONT_DOOR_SYSTEM_PROMPT);
  assert.match(messages[1].content, /海报设计/);
  assert.doesNotMatch(messages[1].content, /allowedTools|generate_image/);
  assert.ok(Array.isArray(messages.at(-1).content));
  assert.equal(messages.at(-1).content.at(-1).image_url.url, 'data:image/png;base64,AAAA');
});

test('Front Door parser enforces answer, route, Skill and confidence contracts', () => {
  assert.deepEqual(parseMainAgentFrontDoorResult(JSON.stringify({
    route: 'chat',
    skillId: null,
    confidence: 'high',
    answer: '你好',
  }), ['poster']), {
    route: 'chat',
    skillId: null,
    confidence: 'high',
    answer: '你好',
  });
  assert.equal(parseMainAgentFrontDoorResult(JSON.stringify({
    route: 'planner',
    skillId: 'unknown',
    confidence: 'high',
    answer: null,
  }), ['poster']), null);
  assert.equal(parseMainAgentFrontDoorResult(JSON.stringify({
    route: 'vision_analysis',
    skillId: null,
    confidence: 'high',
    answer: null,
  })), null);
  assert.equal(parseMainAgentFrontDoorResult(JSON.stringify({
    route: 'planner',
    skillId: 'poster',
    confidence: 'low',
    answer: null,
  }), ['poster']), null);
});

test('Front Door answers chat in one tool-free request', async () => {
  const requests = [];
  const result = await resolveMainAgentFrontDoor({
    messages: [{ role: 'user', content: '你好' }],
    manifests,
    model: 'chat-model',
    chatFn: async (request) => {
      requests.push(request);
      return { choices: [{ message: { content: JSON.stringify({
        route: 'chat',
        skillId: null,
        confidence: 'high',
        answer: '你好，有什么可以帮你？',
      }) } }] };
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].tools, undefined);
  assert.equal(requests[0].toolChoice, undefined);
  assert.equal(result.answer, '你好，有什么可以帮你？');
  assert.equal(result.repairAttempted, false);
});

test('Front Door repairs once and preserves a manually locked Skill', async () => {
  let calls = 0;
  const result = await resolveMainAgentFrontDoor({
    messages: [{ role: 'user', content: '生成一张海报' }],
    manifests,
    manualSkillId: 'poster',
    model: 'chat-model',
    chatFn: async () => {
      calls += 1;
      return { choices: [{ message: { content: calls === 1 ? 'not json' : JSON.stringify({
        route: 'planner',
        skillId: null,
        confidence: 'high',
        answer: null,
      }) } }] };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.route, 'planner');
  assert.equal(result.skillId, 'poster');
  assert.equal(result.repairAttempted, true);
});

test('Front Door fails closed after one invalid repair', async () => {
  let calls = 0;
  await assert.rejects(() => resolveMainAgentFrontDoor({
    messages: [{ role: 'user', content: '帮我处理一下这张图' }],
    manifests,
    pendingTask: { taskId: 'task-1' },
    model: 'chat-model',
    chatFn: async () => {
      calls += 1;
      return { choices: [{ message: { content: JSON.stringify({
        route: 'chat',
        skillId: null,
        confidence: 'high',
        answer: '直接回答',
      }) } }] };
    },
  }), /invalid result/);
  assert.equal(calls, 2);
});
