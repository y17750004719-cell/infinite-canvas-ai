import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAIN_AGENT_SYSTEM_PROMPT,
  buildMainAgentMessages,
} from './main-agent.mjs';

test('main agent prompt defines the agent as a skill orchestration hub', () => {
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /Z Flow 的主 Agent/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /手动选择的 Skill/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不得虚构不存在的 Skill/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不向用户暴露内部思维链/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /清晰需求默认直接执行/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /交付数量/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不得默认回退为 1 张/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /选择其中一个/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /风格统一但内容独立/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /同一 Brief 生成多个随机变体/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /格数不是输出文件数/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不得把外层数量写进单图 Prompt/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /交付合同/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /可扩展候选池/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /一套类似作品/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不得为了.*颜色.*材质.*灯光.*构图/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /自由发挥/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /没有真实变更型工具调用/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /禁止使用“已启动”“正在生成”“已提交”“已生成”/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /<<agent_proposal>>/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /brief 必须自包含/);
});

test('main agent messages keep one consistent system and skill hierarchy with references', () => {
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
  assert.match(messages[1].content, /Logo Skill/);
  assert.equal(messages[2].role, 'system');
  assert.match(messages[2].content, /"itemCount":2/);
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
  assert.match(messages[2].content, /统一 Planner/);
  assert.match(messages[2].content, /\"outputCount\":4/);
});
