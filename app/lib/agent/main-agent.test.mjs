import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAIN_AGENT_SYSTEM_PROMPT,
  buildMainAgentMessages,
} from './main-agent.mjs';

test('main agent prompt defines the agent as a skill orchestration hub', () => {
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /ZO Design 的主 Agent/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /手动选择的 Skill/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不得虚构不存在的 Skill/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不向用户暴露内部思维链/);
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
  assert.deepEqual(messages.at(-1).content[1], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,AAAA' },
  });
});

test('main agent messages do not load a skill when none was selected', () => {
  const messages = buildMainAgentMessages({
    messages: [{ role: 'user', content: '你好' }],
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].content, '你好');
});
