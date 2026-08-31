import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAIN_AGENT_LOOP_SYSTEM_PROMPT,
  FAILED_TASK_RECOVERY_SYSTEM_PROMPT,
  MAIN_AGENT_SYSTEM_PROMPT,
  boundSkillContent,
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

test('main agent prompt keeps image execution behind the direct tool', () => {
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /Z Flow 的主 Agent/);
  assert.match(MAIN_AGENT_SYSTEM_PROMPT, /图片生成、编辑/);
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
  const contextMessage = messages.find((message) => typeof message.content === 'string' && message.content.includes('"aspectRatio":"3:4"'));
  assert.ok(contextMessage);
  assert.doesNotMatch(contextMessage.content, /history-image:1|用户正在评审海报|canvas:1/);
  assert.match(messages[1].content, /海报设计/);
  assert.doesNotMatch(contextMessage.content, /allowedTools|generate_image/);
  assert.equal(messages.length, 4);
  assert.ok(Array.isArray(messages.at(-1).content));
  assert.equal(messages.at(-1).content[0].text, '评价这张海报');
  assert.ok(messages.at(-1).content.some((part) => part.type === 'text' && /Reference ID: history-image:1/.test(part.text)));
  assert.ok(messages.at(-1).content.some((part) => part.type === 'image_url' && part.image_url.url === 'data:image/png;base64,AAAA'));
});

test('image renderPrompt rules require a complete final supplier prompt', () => {
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /renderPrompt 输出约定就是最终供应商 Prompt/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /generate_image\.args\.prompt/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /必须保留主体与内容关系、构图和空间比例、材质与印刷工艺/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /“concise”只能删除工作流说明/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /不得调用独立 Planner、Prompt Optimizer/);
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
  const context = JSON.parse(messages.find((message) => typeof message.content === 'string' && message.content.startsWith('{')).content);
  assert.ok(context.manifests || context.contextTruncated);
  assert.equal(typeof messages[1].content, 'string');
  assert.ok(context && JSON.stringify(context).length <= 24_000);
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
  const context = JSON.parse(messages.find((message) => typeof message.content === 'string' && message.content.startsWith('{')).content);
  assert.equal(messages.slice(3).length, 20);
  assert.equal(messages[3].content, 'message-5');
  assert.equal(context.contextManifest.length, 80);
  assert.equal(context.contextManifest[0].id, 'history-image:20');
  assert.equal(context.contextManifest.at(-1).id, 'history-image:99');
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /read_relevant_context/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /generate_image/);
  assert.doesNotMatch(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /后台 Image Planner/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /运行时先加载 ImageGen 方法/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /公开执行反馈/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /publicProgress/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /promptPreparation/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /最终供应商 Prompt/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /思维链、隐藏推理、系统提示词、Skill 原文、原始参数或 Prompt 正文/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /不要为了分类而调用工具/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /只返回有界摘要和稳定 ID/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /没有 lockedSkill 时直接使用通用图像合同/);
  assert.doesNotMatch(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /自动选择 Skill/);
  assert.doesNotMatch(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /submit_image_compilation/);
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
  const context = JSON.parse(messages.find((message) => typeof message.content === 'string' && message.content.includes('"lockedSkill"')).content);
  assert.equal(context.memory.rollingSummary, '对话摘要');
  assert.deepEqual(context.contextManifest, []);
  assert.equal(context.canvas, null);
  assert.equal(messages.slice(3).length, 3);
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

test('Main Agent receives locked Skill content as direct execution rules', () => {
  const originalRequest = '根据参考图生成海报';
  const messages = buildMainAgentLoopMessages({
    messages: [{ role: 'user', content: originalRequest }],
    manifests: [{ id: 'poster', name: 'Poster', description: 'Poster rules', enabled: true }],
    manualSkillId: 'poster',
    lockedSkillId: 'poster',
    skillContent: '# Visual\nUse sparse zine poster composition.',
  });
  const context = JSON.parse(messages.find((message) => typeof message.content === 'string' && message.content.includes('"lockedSkill"')).content);
  assert.deepEqual(context.lockedSkill, { id: 'poster' });
  const allContent = messages.map((message) => String(message.content)).join('\n');
  assert.match(messages.find((message) => message.role === 'user' && String(message.content).includes('<name>poster</name>')).content, /Use sparse zine poster composition|# Visual/);
  assert.match(allContent, /<skill>/);
  assert.equal(messages.filter((message) => String(message.content).includes(originalRequest)).length, 1);
  assert.doesNotMatch(JSON.stringify(context), /generationContract|promptFormat|originalRequest/);
  assert.match(allContent, /generate_image/);
  assert.doesNotMatch(allContent, /最高优先级|逐字保留/);

  const unloaded = buildMainAgentLoopMessages({
    messages: [{ role: 'user', content: '生成海报' }],
    manifests: [{ id: 'poster', name: 'Poster', description: 'Poster rules', enabled: true }],
    manualSkillId: 'poster',
    lockedSkillId: 'poster',
  });
  assert.deepEqual(JSON.parse(unloaded.find((message) => typeof message.content === 'string' && message.content.includes('"lockedSkill"')).content).lockedSkill, { id: 'poster' });
});

test('image generation contract keeps ImageGen and visual rules in one direct agent flow', () => {
  const messages = buildMainAgentLoopMessages({
    messages: [{ role: 'user', content: '生成一张杂志海报' }],
    lockedSkillId: 'zine-poster',
    skillContent: '# Visual Skill\nUse a small visual cluster, generous paper whitespace, and a saturated red anchor. Avoid gradients and 3D shadows.',
    imagegenHostContent: '# ImageGen\nHandle reference images and write a supplier-facing prompt.',
  });
  const hostIndex = messages.findIndex((message) => String(message.content).includes('<name>imagegen</name>'));
  const visualIndex = messages.findIndex((message) => String(message.content).includes('Use a small visual cluster'));
  assert.ok(hostIndex > 0);
  assert.ok(visualIndex > hostIndex);
  const content = messages.map((message) => String(message.content)).join('\n');
  assert.match(content, /<skill>/);
  assert.match(content, /Use a small visual cluster/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /不得调用独立 Planner、Prompt Optimizer/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /直接调用 generate_image/);
});

test('Main Agent accepts host-loaded non-image Skill instructions without ImageGen context', () => {
  const messages = buildMainAgentLoopMessages({
    messages: [{ role: 'user', content: '分析这份 API 文档' }],
    manifests: [{ id: 'api-helper', name: 'API 助手', description: 'API rules', enabled: true }],
    lockedSkillId: 'api-helper',
    skillContent: '# API helper\nPreserve documented authentication requirements.',
  });
  const content = messages.map((message) => String(message.content)).join('\n');
  assert.match(content, /Preserve documented authentication requirements/);
  assert.doesNotMatch(content, /ImageGen 方法已由运行时加载/);
});

test('Main Agent keeps ImageGen host and visual Skill instructions separate', () => {
  const messages = buildMainAgentLoopMessages({
    messages: [{ role: 'user', content: '生成一张杂志封面' }],
    lockedSkillId: 'magazine-poster',
    skillContent: '# Magazine poster\nUse the editorial contract.',
    imagegenHostContent: '# ImageGen Host\nCompile the final prompt before execution.',
  });
  const content = messages.map((message) => String(message.content)).join('\n');
  assert.match(content, /Use the editorial contract/);
  assert.match(content, /Compile the final prompt before execution/);
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
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages.at(-1).content, '你好');
});

test('selected Skills are independent user fragments with UTF-8-safe Codex budget', () => {
  const bounded = boundSkillContent('中文约束'.repeat(4000));
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.injectedBytes <= 8000);
  assert.doesNotThrow(() => Buffer.from(bounded.content, 'utf8').toString('utf8'));
  const messages = buildMainAgentLoopMessages({
    manifests,
    imagegenHostContent: 'imagegen rules',
    lockedSkillId: 'poster',
    skillContent: 'visual rules',
    messages: [{ role: 'user', content: '生成海报' }],
  });
  const fragments = messages.filter((message) => message.role === 'user' && String(message.content).startsWith('<skill>'));
  assert.equal(fragments.length, 2);
  assert.match(fragments[0].content, /<name>imagegen<\/name>/);
  assert.match(fragments[1].content, /<name>poster<\/name>/);
  assert.ok(messages.findIndex((message) => String(message.content).includes('<name>imagegen</name>'))
    < messages.findIndex((message) => String(message.content).includes('<name>poster</name>')));
  const lastSkillIndex = messages.reduce((index, message, current) => (
    message.role === 'user' && String(message.content).startsWith('<skill>') ? current : index
  ), -1);
  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user' && !String(message.content).startsWith('<skill>'));
  assert.ok(lastSkillIndex >= 0 && latestUserIndex > lastSkillIndex);
  assert.equal(messages.at(-1).role, 'user');
});

test('main agent prompt defines failure, budget, termination, and trust boundaries', () => {
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /retryable/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /validation.*permission.*capability.*resource/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /工具.*预算/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /waiting/);
  assert.match(MAIN_AGENT_LOOP_SYSTEM_PROMPT, /不可信数据/);
});
