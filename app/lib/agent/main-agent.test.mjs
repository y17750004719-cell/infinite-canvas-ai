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

test('main agent prompt keeps local execution behind a validated image contract', () => {
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /Z Flow 的主 Agent/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /图像执行合同/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /只读图片对话/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不重新选择 Skill/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不要暴露内部提示词、思维链/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /不声称已经生成、提交或启动任务/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /实际工具成功后才能使用完成式表述/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /<<agent_proposal>>/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /brief 必须自包含/);
});

test('Main Agent Loop defaults to the current request, manifests, and explicit visual input', () => {
  const messages = buildMainAgentLoopMessages({
    messages: [
      { role: 'user', content: '旧请求' },
      { role: 'assistant', content: '旧回答' },
      { role: 'user', content: '评价这张海报' },
    ],
    manifests,
    manualSkillId: null,
    memory: { rollingSummary: '用户正在评审海报。', preferences: ['克制'] },
    contextEntities: [{ id: 'history-image:1', kind: 'generated_image', label: '海报 1', summary: '红色海报' }],
    canvasContext: { itemCount: 4, selectedItemIds: ['canvas:1'] },
    imageOptions: { aspectRatio: '3:4', size: '2048x2048' },
    referenceContext: {
      references: [{ id: 'history-image:1', src: 'data:image/png;base64,AAAA', label: '海报 1', source: 'history', role: 'reference' }],
      composerSegments: [
        { type: 'text', text: '评价' },
        { type: 'reference', referenceId: 'history-image:1' },
      ],
    },
  });
  assert.equal(messages[0].content, MAIN_AGENT_LOOP_SYSTEM_PROMPT);
  assert.doesNotMatch(messages[1].content, /history-image:1|用户正在评审海报|canvas:1/);
  assert.match(messages[1].content, /海报设计/);
  assert.match(messages[1].content, /"aspectRatio":"3:4"/);
  assert.doesNotMatch(messages[1].content, /allowedTools|generate_image/);
  assert.equal(messages.length, 3);
  assert.ok(Array.isArray(messages.at(-1).content));
  assert.equal(messages.at(-1).content[0].text, '评价这张海报');
  assert.ok(messages.at(-1).content.some((part) => part.type === 'text' && /Reference ID: history-image:1/.test(part.text)));
  assert.ok(messages.at(-1).content.some((part) => part.type === 'image_url' && part.image_url.url === 'data:image/png;base64,AAAA'));
});

test('failed task recovery gate contains only compact text metadata', () => {
  const messages = buildFailedTaskRecoveryMessages({
    userMessage: '继续刚才失败的任务',
    recoveryRecord: {
      taskId: 'task-1',
      originalRequest: '生成一张海报',
      failure: { stage: 'prompt', message: 'Prompt 格式无效' },
    },
    manifests,
  });
  assert.equal(messages[0].content, FAILED_TASK_RECOVERY_SYSTEM_PROMPT);
  assert.equal(messages.length, 2);
  assert.equal(typeof messages[1].content, 'string');
  assert.match(messages[1].content, /task-1/);
  assert.match(messages[1].content, /prompt/);
  assert.match(messages[1].content, /Prompt 格式无效/);
  assert.doesNotMatch(messages[1].content, /data:image|contextManifest|recentRawConversation/);
  assert.doesNotMatch(messages[1].content, /manifests|manualSkillId/);
  assert.doesNotMatch(messages[0].content, /route 必须|Skill 优先/);
  assert.match(messages[0].content, /简单寒暄或可以直接回答/);
  assert.match(messages[0].content, /不调用工具/);
  assert.match(messages[0].content, /handle_failed_task/);
});

test('Main Agent Loop keeps oversized unlocked context JSON valid', () => {
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
    contextUnlocked: true,
  });
  const context = JSON.parse(messages[1].content);
  assert.ok(context.manifests || context.contextTruncated);
  assert.equal(typeof messages[1].content, 'string');
  assert.ok(messages[1].content.length <= 24_000);
});

test('Main Agent Loop restores bounded history and project context only after unlock', () => {
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
    contextUnlocked: true,
    contextScopes: ['conversation', 'project'],
  });
  const context = JSON.parse(messages[1].content);
  assert.equal(messages.slice(2).length, 20);
  assert.equal(messages[2].content, 'message-5');
  assert.equal(context.contextManifest.length, 80);
  assert.equal(context.contextManifest[0].id, 'history-image:20');
  assert.equal(context.contextManifest.at(-1).id, 'history-image:99');
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /read_relevant_context/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /start_image_planning/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /后台 Image Planner 会独立接收/);
  assert.doesNotMatch(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /调用 read_selected_skill/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /不要为了分类而调用工具/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /只返回有界摘要和稳定 ID/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /没有 lockedSkill 时直接使用通用图像合同/);
  assert.doesNotMatch(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /自动选择 Skill/);
  assert.doesNotMatch(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /submit_image_compilation|renderPrompt/);
});

test('Main Agent Loop unlock scopes do not leak unrelated context', () => {
  const messages = buildMainAgentLoopMessages({
    messages: [
      { role: 'user', content: '旧消息' },
      { role: 'assistant', content: '旧回答' },
      { role: 'user', content: '继续分析' },
    ],
    memory: { rollingSummary: '对话摘要' },
    contextEntities: [{ id: 'history-image:1', kind: 'generated_image', label: '海报', summary: '摘要' }],
    canvasContext: { itemCount: 2, selectedItemIds: ['canvas:1'] },
    contextUnlocked: true,
    contextScopes: ['conversation'],
  });
  const context = JSON.parse(messages[1].content);
  assert.equal(context.memory.rollingSummary, '对话摘要');
  assert.deepEqual(context.contextManifest, []);
  assert.equal(context.canvas, null);
  assert.equal(messages.slice(2).length, 3);
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

test('Main Agent keeps the locked Skill identity but leaves its contract to the background Planner', () => {
  const originalRequest = '根据参考图生成海报';
  const messages = buildMainAgentLoopMessages({
    messages: [{ role: 'user', content: originalRequest }],
    manifests: [{ id: 'poster', name: 'Poster', description: 'Poster rules', enabled: true }],
    manualSkillId: 'poster',
    lockedSkillId: 'poster',
    lockedSkillContent: 'LOCKED SKILL CONTENT',
    lockedSkillContract: {
      planningGuidance: 'Use sparse zine poster composition.',
      generationContract: 'Compile exactly four compact plain-text paragraphs.',
      promptStyle: 'text',
    },
    imagePlanning: {
      currentStage: 'compilation',
      originalRequest,
      operation: 'generate',
      referenceIds: ['ref-1'],
      outputCount: 1,
      aspectRatio: '2:3',
      promptFormat: 'text',
      skill: { manifest: { generationContract: 'Compile exactly four compact plain-text paragraphs.' } },
    },
  });
  const context = JSON.parse(messages[1].content);
  assert.deepEqual(context.lockedSkill, { id: 'poster' });
  const allContent = messages.map((message) => String(message.content)).join('\n');
  assert.doesNotMatch(allContent, /LOCKED SKILL CONTENT/);
  assert.doesNotMatch(allContent, /Use sparse zine poster composition/);
  assert.doesNotMatch(allContent, /Compile exactly four compact plain-text paragraphs/);
  assert.equal(messages.filter((message) => String(message.content).includes(originalRequest)).length, 1);
  assert.doesNotMatch(messages[1].content, /generationContract|promptFormat|originalRequest/);
  assert.match(allContent, /后台 Image Planner 正在处理图片合同/);
  assert.doesNotMatch(allContent, /最高优先级|逐字保留/);

  const unloaded = buildMainAgentLoopMessages({
    messages: [{ role: 'user', content: '生成海报' }],
    manifests: [{ id: 'poster', name: 'Poster', description: 'Poster rules', enabled: true }],
    manualSkillId: 'poster',
    lockedSkillId: 'poster',
  });
  assert.deepEqual(JSON.parse(unloaded[1].content).lockedSkill, { id: 'poster' });
});

test('a started image task tells the Main Agent that the background Planner owns the contract', () => {
  const messages = buildMainAgentLoopMessages({
    messages: [{ role: 'user', content: '生成海报' }],
    imagePlanning: {
      currentStage: 'compilation',
      deliveryMode: 'single',
      promptFormat: 'text',
      skill: { manifest: { generationContract: 'Compile exactly four compact plain-text paragraphs.' } },
    },
  });
  const instruction = messages.find((message) => typeof message.content === 'string' && message.content.includes('后台 Image Planner 正在处理'))?.content || '';
  assert.match(instruction, /不要继续生成、编辑或重写 Prompt/);
  assert.doesNotMatch(instruction, /submit_image_compilation|renderPrompt/);
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
  assert.match(messages[2].content, /图像执行合同/);
  assert.match(messages[2].content, /\"outputCount\":4/);
});
