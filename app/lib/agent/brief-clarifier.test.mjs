import test from 'node:test';
import assert from 'node:assert/strict';

let clarifier = {};
try {
  clarifier = await import('./brief-clarifier.mjs');
} catch {
  // The first TDD run intentionally exercises the missing implementation.
}

const parseBriefClarifierResult = clarifier.parseBriefClarifierResult || (() => null);
const shouldAskClarification = clarifier.shouldAskClarification || (() => false);
const buildBriefClarifierMessages = clarifier.buildBriefClarifierMessages || (() => []);
const applyClarificationResponse = clarifier.applyClarificationResponse || (() => null);
const isPotentialDesignExecutionRequest = clarifier.isPotentialDesignExecutionRequest || (() => false);

test('brief clarifier exports the required public helpers', () => {
  assert.equal(typeof clarifier.parseBriefClarifierResult, 'function');
  assert.equal(typeof clarifier.shouldAskClarification, 'function');
  assert.equal(typeof clarifier.buildBriefClarifierMessages, 'function');
  assert.equal(typeof clarifier.applyClarificationResponse, 'function');
  assert.equal(typeof clarifier.isPotentialDesignExecutionRequest, 'function');
});

test('recognizes vague design execution language without hijacking analysis or planning chat', () => {
  assert.equal(isPotentialDesignExecutionRequest('帮我做个高级一点的东西'), true);
  assert.equal(isPotentialDesignExecutionRequest('帮我设计一个更有视觉冲击力的方案'), true);
  assert.equal(isPotentialDesignExecutionRequest('帮我分析这个设计为什么不好'), false);
  assert.equal(isPotentialDesignExecutionRequest('帮我做个开发计划'), false);
});

test('parses ready and critical ask results with one question and two to four options', () => {
  const ready = parseBriefClarifierResult(JSON.stringify({
    version: 1,
    status: 'ready',
    workingBrief: '制作一张极简香水海报，冷白色，竖版 3:4。',
  }));
  assert.equal(ready?.status, 'ready');
  assert.match(ready?.workingBrief || '', /极简香水海报/);

  const ask = parseBriefClarifierResult(JSON.stringify({
    version: 1,
    status: 'ask',
    workingBrief: '用户希望制作一个设计，但没有说明交付物。',
    ambiguity: {
      dimension: 'deliverable',
      critical: true,
      reason: '不同交付物会使用完全不同的版式与内容结构。',
    },
    question: '你希望制作哪种设计？',
    options: [
      { id: 'poster', label: '海报', answer: '制作一张海报' },
      { id: 'packaging', label: '包装', answer: '制作一套包装视觉' },
    ],
  }));
  assert.equal(ask?.status, 'ask');
  assert.equal(ask?.options?.length, 2);
  assert.equal(ask?.ambiguity?.critical, true);

  assert.equal(parseBriefClarifierResult(JSON.stringify({
    version: 1,
    status: 'ask',
    workingBrief: '缺少颜色。',
    ambiguity: { dimension: 'color', critical: false, reason: '可以提高效果。' },
    question: '喜欢什么颜色？',
    options: [{ id: 'blue', label: '蓝色', answer: '使用蓝色' }],
  })), null);
});

test('clear executable image requests do not ask merely for optional art direction', () => {
  const modelAsk = {
    version: 1,
    status: 'ask',
    workingBrief: '生成一张猫的插画。',
    ambiguity: {
      dimension: 'style',
      critical: true,
      reason: '补充风格可以提高生成质量。',
    },
    question: '你喜欢什么风格？',
    options: [
      { id: 'flat', label: '扁平', answer: '扁平风格' },
      { id: 'paint', label: '绘画', answer: '绘画风格' },
    ],
  };
  assert.equal(shouldAskClarification({ result: modelAsk, userMessage: '生成一张猫的插画', askedDimensions: [], referenceImageCount: 0 }), false);
  assert.equal(shouldAskClarification({ result: modelAsk, userMessage: '设计一张极简香水海报，冷白色，3:4', askedDimensions: [], referenceImageCount: 0 }), false);

  const subjectAsk = {
    ...modelAsk,
    ambiguity: { dimension: 'subject', critical: true, reason: '主体不同会改变画面。' },
    question: '插画的主体是什么？',
  };
  assert.equal(shouldAskClarification({ result: subjectAsk, userMessage: '生成一张猫的插画', askedDimensions: [], referenceImageCount: 0 }), false);
});

test('does not accept hallucinated conflicts or copy requirements as clarification reasons', () => {
  const base = {
    version: 1,
    status: 'ask',
    workingBrief: '设计一张现代产品海报。',
    question: '请确认方向。',
    options: [
      { id: 'one', label: '方向一', answer: '方向一' },
      { id: 'two', label: '方向二', answer: '方向二' },
    ],
  };
  assert.equal(shouldAskClarification({
    result: {
      ...base,
      ambiguity: { dimension: 'direction_conflict', critical: true, reason: '方向会改变画面。' },
    },
    userMessage: '设计一张现代简约的产品海报',
  }), false);
  assert.equal(shouldAskClarification({
    result: {
      ...base,
      ambiguity: { dimension: 'literal_copy', critical: true, reason: '文字必须准确。' },
    },
    userMessage: '设计一张现代简约的产品海报',
  }), false);
});

test('explicit creative delegation and answered dimensions prevent follow-up questions', () => {
  const directionAsk = {
    version: 1,
    status: 'ask',
    workingBrief: '制作咖啡包装效果图。',
    ambiguity: { dimension: 'direction_conflict', critical: true, reason: '方向会改变整体视觉。' },
    question: '希望采用什么视觉方向？',
    options: [
      { id: 'modern', label: '现代', answer: '现代风格' },
      { id: 'retro', label: '复古', answer: '复古风格' },
    ],
  };
  assert.equal(shouldAskClarification({ result: directionAsk, userMessage: '你决定风格，做一张咖啡包装效果图', askedDimensions: [], referenceImageCount: 0 }), false);
  assert.equal(shouldAskClarification({ result: directionAsk, userMessage: '继续制作咖啡包装效果图', askedDimensions: ['direction_conflict'], referenceImageCount: 0 }), false);
});

test('critical missing deliverables and conflicting directions may ask once', () => {
  const missingDeliverable = {
    version: 1,
    status: 'ask',
    workingBrief: '用户希望获得高级设计，但交付物和主体都不明确。',
    ambiguity: { dimension: 'deliverable', critical: true, reason: '不知道交付物就无法决定画面结构。' },
    question: '你希望制作哪种设计？',
    options: [
      { id: 'poster', label: '海报', answer: '制作海报' },
      { id: 'packaging', label: '包装', answer: '制作包装' },
    ],
  };
  assert.equal(shouldAskClarification({ result: missingDeliverable, userMessage: '帮我做个高级一点的东西', askedDimensions: [], referenceImageCount: 0 }), true);

  const conflict = {
    ...missingDeliverable,
    workingBrief: '设计产品海报，同时要求黑金奢华与清新自然。',
    ambiguity: { dimension: 'direction_conflict', critical: true, reason: '两种主方向互相冲突，会得到明显不同的画面。' },
    question: '这次希望以哪个方向为主？',
  };
  assert.equal(shouldAskClarification({ result: conflict, userMessage: '设计产品海报，用黑金，也要清新自然', askedDimensions: [], referenceImageCount: 0 }), true);
});

test('ordinal and deictic references are not treated as concrete subjects', () => {
  const subjectAsk = {
    version: 1,
    status: 'ask',
    workingBrief: '按照第 3 项生成图片。',
    ambiguity: { dimension: 'subject', critical: true, reason: '引用对象尚未解析，无法确定主体。' },
    question: '你指的是哪个方案？',
    options: [
      { id: 'one', label: '方案一', answer: '方案一' },
      { id: 'three', label: '方案三', answer: '方案三' },
    ],
  };
  assert.equal(shouldAskClarification({ result: subjectAsk, userMessage: '按照3生成图片' }), true);
  assert.equal(shouldAskClarification({ result: subjectAsk, userMessage: '就用刚才那个' }), true);
});

test('reference priority questions require multiple references', () => {
  const result = {
    version: 1,
    status: 'ask',
    workingBrief: '参考上传图片制作产品海报。',
    ambiguity: { dimension: 'reference_priority', critical: true, reason: '多张参考图表达了不同产品，无法确定主参考。' },
    question: '哪张图片作为主要参考？',
    options: [
      { id: 'first', label: '第一张', answer: '使用第一张作为主参考' },
      { id: 'second', label: '第二张', answer: '使用第二张作为主参考' },
    ],
  };
  assert.equal(shouldAskClarification({ result, userMessage: '参考这张图制作同风格产品图', referenceImageCount: 1 }), false);
  assert.equal(shouldAskClarification({ result, userMessage: '参考这些图制作产品海报', referenceImageCount: 3 }), true);
});

test('clarifier prompt makes execution the default and includes prior answers', () => {
  const messages = buildBriefClarifierMessages({
    userMessage: '继续完善这个设计',
    intent: 'image',
    skillContent: '# Packaging Skill',
    referenceImageCount: 0,
    state: {
      originalRequest: '帮我做个高级一点的东西',
      workingBrief: '制作一张产品海报。',
      askedDimensions: ['deliverable'],
      answers: [{ dimension: 'deliverable', question: '制作什么？', answer: '产品海报' }],
    },
  });
  assert.equal(messages[0]?.role, 'system');
  assert.match(messages[0]?.content || '', /默认执行/);
  assert.match(messages[0]?.content || '', /不得为了.*颜色.*材质.*灯光.*构图/);
  assert.match(messages[1]?.content || '', /产品海报/);
  assert.match(messages[1]?.content || '', /deliverable/);
});

test('new asset directions require one explicit confirmation with executable options', async () => {
  const result = await clarifier.resolveBriefClarification({
    userMessage: '生成第二张封面',
    intent: 'image',
    state: {
      taskId: 'task-cover-2',
      intent: 'image',
      originalRequest: '生成第二张封面',
      workingBrief: '生成第二张封面',
      askedDimensions: [],
      answers: [],
    },
    requireCreativeDirectionConfirmation: true,
  });

  assert.equal(result.failed, false);
  assert.equal(result.result?.status, 'ask');
  assert.equal(result.result?.ambiguity?.dimension, 'creative_direction');
  assert.equal(result.result?.options?.length, 2);
  assert.equal(clarifier.shouldAskClarification({
    result: result.result,
    userMessage: '生成第二张封面',
    askedDimensions: [],
    requireCreativeDirectionConfirmation: true,
  }), true);
  assert.equal(clarifier.shouldAskClarification({
    result: result.result,
    userMessage: '生成第二张封面',
    askedDimensions: ['creative_direction'],
    requireCreativeDirectionConfirmation: true,
  }), false);
});

test('applies recommended and custom answers without losing the original brief', () => {
  const state = {
    taskId: 'task-1',
    intent: 'image',
    originalRequest: '设计产品海报，用黑金，也要清新自然',
    workingBrief: '设计产品海报。',
    askedDimensions: [],
    answers: [],
    referenceImages: ['data:image/png;base64,AAAA'],
  };
  const request = {
    id: 'question-1',
    taskId: 'task-1',
    question: '这次希望以哪个方向为主？',
    dimension: 'direction_conflict',
    options: [
      { id: 'black-gold', label: '黑金奢华', answer: '以黑金奢华为主要方向' },
      { id: 'natural', label: '清新自然', answer: '以清新自然为主要方向' },
    ],
    allowCustom: true,
    allowProceed: true,
  };
  const applied = applyClarificationResponse({
    state,
    request,
    response: { requestId: 'question-1', selectedOptionId: 'black-gold', customText: '减少金色面积，保留自然植物点缀' },
  });
  assert.match(applied?.answer || '', /黑金奢华/);
  assert.match(applied?.answer || '', /自然植物点缀/);
  assert.deepEqual(applied?.state?.askedDimensions, ['direction_conflict']);
  assert.match(applied?.state?.originalRequest || '', /设计产品海报/);
  assert.deepEqual(applied?.state?.referenceImages, ['data:image/png;base64,AAAA']);
});

test('clarification responses preserve operation progress identity', () => {
  const state = {
    taskId: 'task-1',
    operationId: 'operation-1',
    skillSource: 'auto',
    lastSequence: 7,
    intent: 'image',
    originalRequest: '生成海报',
    workingBrief: '生成海报',
    askedDimensions: [],
    answers: [],
  };
  const request = {
    id: 'request-1',
    taskId: 'task-1',
    question: '选择风格',
    dimension: 'style',
    options: [{ id: 'minimal', label: '极简', answer: '极简风格' }],
    allowCustom: true,
    allowProceed: true,
  };
  const applied = applyClarificationResponse({
    state,
    request,
    response: { requestId: 'request-1', selectedOptionId: 'minimal' },
  });
  assert.equal(applied.state.operationId, 'operation-1');
  assert.equal(applied.state.skillSource, 'auto');
  assert.equal(applied.state.lastSequence, 7);
});
