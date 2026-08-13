import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAIN_AGENT_LOOP_SYSTEM_PROMPT,
  FAILED_TASK_RECOVERY_SYSTEM_PROMPT,
  MAIN_AGENT_SYSTEM_PROMPT,
  buildFailedTaskRecoveryMessages,
  buildMainAgentMessages,
  buildMainAgentLoopMessages,
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

test('Main Agent Loop combines routing, bounded memory, manifests, and current visual input', () => {
  const messages = buildMainAgentLoopMessages({
    messages: [{ role: 'user', content: '评价之前的海报' }],
    referenceImages: ['data:image/png;base64,AAAA'],
    manifests,
    manualSkillId: null,
    memory: { rollingSummary: '用户正在评审海报。', preferences: ['克制'] },
    contextEntities: [{ id: 'history-image:1', kind: 'generated_image', label: '海报 1', summary: '红色海报' }],
  });
  assert.equal(messages[0].content, MAIN_AGENT_LOOP_SYSTEM_PROMPT);
  assert.match(messages[1].content, /history-image:1/);
  assert.match(messages[1].content, /用户正在评审海报/);
  assert.match(messages[1].content, /海报设计/);
  assert.doesNotMatch(messages[1].content, /allowedTools|generate_image/);
  assert.ok(Array.isArray(messages.at(-1).content));
  assert.equal(messages.at(-1).content.at(-1).image_url.url, 'data:image/png;base64,AAAA');
});

test('failed task recovery gate contains only compact text metadata', () => {
  const messages = buildFailedTaskRecoveryMessages({
    userMessage: '继续刚才失败的任务',
    recoveryRecord: { taskId: 'task-1', originalRequest: '生成一张海报' },
    manifests,
  });
  assert.equal(messages[0].content, FAILED_TASK_RECOVERY_SYSTEM_PROMPT);
  assert.equal(messages.length, 2);
  assert.equal(typeof messages[1].content, 'string');
  assert.match(messages[1].content, /task-1/);
  assert.doesNotMatch(messages[1].content, /data:image|contextManifest|recentRawConversation/);
  assert.doesNotMatch(messages[0].content, /route 必须|Skill 优先/);
});

test('Main Agent Loop keeps oversized context JSON valid and preserves routing metadata', () => {
  const messages = buildMainAgentLoopMessages({
    messages: [{ role: 'user', content: '继续处理' }],
    manifests: Array.from({ length: 200 }, (_, index) => ({
      id: `skill-${index}`,
      name: 'x'.repeat(180),
      description: 'd'.repeat(800),
      triggerHints: ['h'.repeat(120)],
      enabled: true,
    })),
    memory: {
      rollingSummary: 's'.repeat(6000),
      facts: Array.from({ length: 24 }, () => 'f'.repeat(500)),
      preferences: Array.from({ length: 16 }, () => 'p'.repeat(500)),
    },
    contextEntities: Array.from({ length: 200 }, (_, index) => ({
      id: `history-image:${index}`,
      kind: 'generated_image',
      label: 'l'.repeat(200),
      summary: 'c'.repeat(500),
      aliases: ['a'.repeat(120)],
    })),
  });
  const context = JSON.parse(messages[1].content);
  assert.ok(context.manifests || context.contextTruncated);
  assert.equal(typeof messages[1].content, 'string');
  assert.ok(messages[1].content.length <= 24_000);
});

test('Main Agent Loop keeps the latest twenty messages and eighty context entities', () => {
  const messages = buildMainAgentLoopMessages({
    messages: Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index}`,
    })),
    contextEntities: Array.from({ length: 100 }, (_, index) => ({
      id: `history-image:${index}`,
      kind: 'generated_image',
      label: `image-${index}`,
      summary: `summary-${index}`,
    })),
  });
  const context = JSON.parse(messages[1].content);
  assert.equal(messages.slice(2).length, 20);
  assert.equal(messages[2].content, 'message-5');
  assert.equal(context.contextManifest.length, 80);
  assert.equal(context.contextManifest[0].id, 'history-image:20');
  assert.equal(context.contextManifest.at(-1).id, 'history-image:99');
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /一次批量调用 read_context_entity/);
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
