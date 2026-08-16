import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialAgentRunProgress,
  createAgentProgressEventRouter,
  formatAgentProgressLabel,
  getAgentProgressElapsedMs,
  reduceAgentRunProgress,
  routeAgentProgressEvent,
  shouldShowAgentRunProgress,
} from './run-progress.mjs';

const progress = (sequence, overrides = {}) => ({
  type: 'progress_update',
  version: 1,
  runId: 'run-1',
  operationId: 'operation-1',
  sequence,
  stepId: `step-${sequence}`,
  phase: 'working',
  status: 'active',
  label: `Step ${sequence}`,
  ...overrides,
});

test('creates an empty, hidden timeline for a new agent run', () => {
  const state = createInitialAgentRunProgress('run-immediate');

  assert.equal(state.runId, 'run-immediate');
  assert.equal(state.operationId, 'run-immediate');
  assert.equal(state.intent, null);
  assert.equal(state.outcome, 'running');
  assert.deepEqual(state.steps, []);
  assert.equal(shouldShowAgentRunProgress(state), false);
});

test('streams provisional activity and keeps commentary commits in the timeline', () => {
  let state = createInitialAgentRunProgress('run-activity');
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_delta',
    activityId: 'activity-1',
    delta: '正在检查',
  });
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_delta',
    activityId: 'activity-1',
    delta: '画布内容',
  });
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_commit',
    activityId: 'activity-1',
    disposition: 'commentary',
  });

  assert.deepEqual(state.steps[0], {
    stepId: 'activity:activity-1',
    activityId: 'activity-1',
    kind: 'commentary',
    phase: 'commentary',
    status: 'completed',
    commentary: '正在检查画布内容',
    label: '正在检查画布内容',
  });
});

test('removes a final activity so the page can promote it into message content once', () => {
  let state = reduceAgentRunProgress(createInitialAgentRunProgress('run-final'), {
    type: 'agent_activity_delta',
    activityId: 'final-1',
    delta: '最终回复',
  });
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_commit',
    activityId: 'final-1',
    disposition: 'final',
  });

  assert.deepEqual(state.steps, []);
  assert.equal(shouldShowAgentRunProgress(state), false);
});

test('marks user cancellation without misreporting an execution failure', () => {
  let state = reduceAgentRunProgress(createInitialAgentRunProgress('run-cancelled'), progress(1, {
    stepId: 'waiting-model',
    phase: 'waiting',
    status: 'active',
    label: '正在等待模型响应',
  }));
  state = reduceAgentRunProgress(state, { type: 'agent_cancelled' });

  assert.equal(state.agentDone, true);
  assert.equal(state.outcome, 'cancelled');
  assert.equal(state.steps[0].status, 'completed');
  assert.equal(state.steps[0].label, '任务已终止');
});

test('bounds persisted activity to 24 entries and 1200 characters per entry', () => {
  let state = createInitialAgentRunProgress('run-bounded');
  for (let index = 0; index < 25; index += 1) {
    state = reduceAgentRunProgress(state, {
      type: 'agent_activity_delta',
      activityId: `activity-${index}`,
      delta: index === 24 ? 'x'.repeat(1300) : String(index),
    });
  }

  assert.equal(state.steps.length, 24);
  assert.equal(state.steps[0].activityId, 'activity-0');
  assert.equal(state.steps[1].stepId, 'activity:truncated');
  assert.equal(state.steps.at(-1).commentary.length, 1200);
});

test('deduplicates progress updates by sequence', () => {
  const first = reduceAgentRunProgress(null, progress(1));
  const duplicate = reduceAgentRunProgress(first, progress(1, { label: 'Duplicate' }));

  assert.equal(duplicate, first);
  assert.equal(duplicate.steps.length, 1);
  assert.equal(duplicate.steps[0].label, 'Step 1');
});

test('accumulates dynamic progress steps in first-seen order', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'understand',
    label: '理解需求',
  }));
  state = reduceAgentRunProgress(state, progress(2, {
    stepId: 'render',
    phase: 'generating',
    label: '生成图片',
  }));
  state = reduceAgentRunProgress(state, progress(3, {
    stepId: 'understand',
    status: 'completed',
    label: '需求已理解',
  }));

  assert.deepEqual(state.steps.map(({ stepId, label, status }) => ({ stepId, label, status })), [
    { stepId: 'understand', label: '需求已理解', status: 'completed' },
    { stepId: 'render', label: '生成图片', status: 'active' },
  ]);
});

test('keeps parallel tool calls with the same step id separate by tool call id', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'canvas_context',
    toolCallId: 'canvas-call-1',
    label: '读取画布一',
  }));
  state = reduceAgentRunProgress(state, progress(2, {
    stepId: 'canvas_context',
    toolCallId: 'canvas-call-2',
    label: '读取画布二',
  }));
  state = reduceAgentRunProgress(state, progress(3, {
    stepId: 'canvas_context',
    toolCallId: 'canvas-call-1',
    status: 'completed',
    label: '画布一已读取',
  }));

  assert.deepEqual(state.steps.map(({ toolCallId, label, status }) => ({ toolCallId, label, status })), [
    { toolCallId: 'canvas-call-1', label: '画布一已读取', status: 'completed' },
    { toolCallId: 'canvas-call-2', label: '读取画布二', status: 'active' },
  ]);
});

test('updates one image step across confirmation and execution when the tool id is stable', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'waiting',
    toolCallId: 'generate-image-confirmation',
    label: '等待确认生成图片',
  }));
  state = reduceAgentRunProgress(state, progress(2, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'active',
    toolCallId: 'generate-image-confirmation',
    label: '正在生成图片',
  }));

  assert.equal(state.steps.length, 1);
  assert.equal(state.steps[0].status, 'active');
  assert.equal(state.steps[0].label, '正在生成图片');
});

test('confirmation submission updates the breadcrumb without starting image timing', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'waiting',
    toolCallId: 'generate-image-confirmation',
    toolName: 'generate_image',
    label: '等待确认生成图片',
    timestampMs: 1_000,
  }));
  state = reduceAgentRunProgress(state, {
    type: 'confirmation_submitted',
    toolName: 'generate_image',
  });

  assert.equal(state.steps[0].label, '正在确认并启动任务');
  assert.equal(state.steps[0].status, 'waiting');
  assert.equal(state.steps[0].startedAt, undefined);
  assert.equal(getAgentProgressElapsedMs(state.steps[0], 5_000), null);
});

test('image generation timing starts on active, freezes on completion, and resets per tool call', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'waiting',
    toolCallId: 'image-batch-1',
    toolName: 'generate_image',
    timestampMs: 1_000,
  }));
  assert.equal(state.steps[0].startedAt, undefined);
  assert.equal(getAgentProgressElapsedMs(state.steps[0], 5_000), null);

  state = reduceAgentRunProgress(state, progress(2, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'active',
    toolCallId: 'image-batch-1',
    toolName: 'generate_image',
    timestampMs: 2_000,
  }));
  assert.equal(getAgentProgressElapsedMs(state.steps[0], 5_500), 3_500);

  state = reduceAgentRunProgress(state, progress(3, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'completed',
    toolCallId: 'image-batch-1',
    toolName: 'generate_image',
    timestampMs: 8_500,
  }));
  assert.equal(getAgentProgressElapsedMs(state.steps[0], 20_000), 6_500);

  state = reduceAgentRunProgress(state, progress(4, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'active',
    toolCallId: 'image-batch-2',
    toolName: 'generate_image',
    timestampMs: 10_000,
  }));
  assert.equal(getAgentProgressElapsedMs(state.steps[1], 11_250), 1_250);
});

test('image heartbeat updates the active tool row instead of creating a second timer', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'active',
    toolCallId: 'generate-image-1',
    toolName: 'generate_image',
    label: '正在生成图片',
    timestampMs: 1_000,
  }));
  state = reduceAgentRunProgress(state, progress(2, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'active',
    toolCallId: 'generate-image-1',
    toolName: 'generate_image',
    label: '正在等待图片生成（10 秒）',
    timestampMs: 11_000,
  }));
  state = reduceAgentRunProgress(state, progress(3, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'completed',
    toolCallId: 'generate-image-1',
    toolName: 'generate_image',
    label: '图片生成完成',
    timestampMs: 20_000,
  }));

  assert.equal(state.steps.length, 1);
  assert.equal(state.steps[0].status, 'completed');
  assert.equal(getAgentProgressElapsedMs(state.steps[0], 60_000), 19_000);
});

test('agent_done before image assets settle does not complete the run', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'completed',
    label: '图片生成完成',
  }));
  state = reduceAgentRunProgress(state, { type: 'agent_done' });

  assert.equal(state.agentDone, true);
  assert.equal(state.outcome, 'waiting');
});

test('settling all announced assets completes an agent run', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'completed',
    label: '图片生成完成',
  }));
  state = reduceAgentRunProgress(state, { type: 'assets_pending', count: 2 });
  state = reduceAgentRunProgress(state, { type: 'agent_done' });
  state = reduceAgentRunProgress(state, {
    type: 'assets_settled',
    succeeded: 2,
    failed: 0,
  });

  assert.equal(state.outcome, 'completed');
  assert.deepEqual(state.assets, {
    expected: 2,
    settled: 2,
    succeeded: 2,
    failed: 0,
  });
});

test('recovered tool failures do not override a successful image delivery', () => {
  let state = null;
  let sequence = 0;
  const progressEvent = (toolCallId, status, label, toolName = 'read_imagegen_context') => ({
    type: 'progress_update',
    runId: 'run-recovered-tool',
    operationId: 'run-recovered-tool',
    sequence: ++sequence,
    stepId: toolName === 'generate_image' ? 'generate_image' : 'skill_loading',
    phase: toolName === 'generate_image' ? 'generating' : 'loading',
    status,
    label,
    toolCallId,
    toolName,
  });

  for (let index = 0; index < 2; index += 1) {
    state = reduceAgentRunProgress(state, progressEvent(`skill-${index}`, 'active', '正在读取选中的 Skill'));
    state = reduceAgentRunProgress(state, progressEvent(`skill-${index}`, 'failed', 'Skill 读取失败'));
  }
  state = reduceAgentRunProgress(state, progressEvent('image-1', 'active', '正在生成图片', 'generate_image'));
  state = reduceAgentRunProgress(state, progressEvent('image-1', 'completed', '图片生成完成', 'generate_image'));
  state = reduceAgentRunProgress(state, { type: 'assets_pending', count: 1 });
  state = reduceAgentRunProgress(state, { type: 'agent_done' });
  state = reduceAgentRunProgress(state, { type: 'assets_settled', succeeded: 1, failed: 0 });

  assert.equal(state.outcome, 'completed');
  assert.equal(state.terminalFailed, false);
  assert.equal(state.steps.filter((step) => step.status === 'failed').length, 2);
});

test('partial asset failure settles as a warning', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'completed',
    label: '图片生成完成',
  }));
  state = reduceAgentRunProgress(state, { type: 'assets_pending', count: 3 });
  state = reduceAgentRunProgress(state, { type: 'agent_done' });
  state = reduceAgentRunProgress(state, {
    type: 'assets_settled',
    succeeded: 2,
    failed: 1,
  });

  assert.equal(state.outcome, 'warning');
});

test('waiting clarification never renders as a completed run after agent_done', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'clarification',
    phase: 'waiting_input',
    status: 'waiting',
    label: '等待补充需求信息',
  }));
  state = reduceAgentRunProgress(state, { type: 'intent_resolved', intent: 'image' });
  state = reduceAgentRunProgress(state, { type: 'agent_done' });

  assert.equal(state.agentDone, true);
  assert.equal(state.outcome, 'waiting');
});

test('agent errors terminalize the run for retry rendering', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'active',
    label: '正在生成图片',
  }));
  state = reduceAgentRunProgress(state, { type: 'agent_error' });

  assert.equal(state.agentDone, true);
  assert.equal(state.terminalFailed, true);
  assert.equal(state.outcome, 'failed');
  assert.equal(state.steps.at(-1).status, 'failed');
});

test('agent errors remain visible even before any activity arrives', () => {
  const state = reduceAgentRunProgress(createInitialAgentRunProgress('run-empty-error'), {
    type: 'agent_error',
  });

  assert.equal(state.outcome, 'failed');
  assert.equal(state.steps[0].status, 'failed');
  assert.equal(shouldShowAgentRunProgress(state), true);
});

test('async skill job progress keeps the run waiting until every asset settles', () => {
  let state = createInitialAgentRunProgress('run-skill-job');
  state = reduceAgentRunProgress(state, { type: 'intent_resolved', intent: 'skill_action' });
  state = reduceAgentRunProgress(state, { type: 'assets_pending', count: 4 });
  state = reduceAgentRunProgress(state, { type: 'agent_done' });
  state = reduceAgentRunProgress(state, {
    type: 'assets_progress',
    total: 4,
    succeeded: 2,
    failed: 0,
  });

  assert.equal(state.outcome, 'waiting');
  assert.equal(state.steps.at(-1).label, '正在生成素材（2/4）');

  state = reduceAgentRunProgress(state, {
    type: 'assets_settled',
    succeeded: 3,
    failed: 1,
  });
  assert.equal(state.outcome, 'warning');
  assert.equal(state.steps.at(-1).status, 'completed');
});

test('a later assistant delta does not clear accumulated progress', () => {
  const state = reduceAgentRunProgress(null, progress(1));
  const afterDelta = reduceAgentRunProgress(state, {
    type: 'assistant_delta',
    delta: '稍后到达的正文',
  });

  assert.equal(afterDelta, state);
  assert.equal(afterDelta.steps.length, 1);
});

test('completed ordinary chat hides commentary-only progress', () => {
  const routing = reduceAgentRunProgress(null, progress(1, {
    stepId: 'routing',
    phase: 'routing',
    label: '正在理解并路由请求',
  }));
  const state = reduceAgentRunProgress(routing, {
    type: 'intent_resolved',
    intent: 'chat',
  });
  const completed = reduceAgentRunProgress(state, { type: 'agent_done' });

  assert.equal(completed.intent, 'chat');
  assert.equal(completed.steps.length, 1);
  assert.equal(shouldShowAgentRunProgress(completed), false);
});

test('completed chat keeps a timeline when it used a tool', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'get_conversation_memory',
    toolName: 'get_conversation_memory',
    phase: 'reading',
    status: 'completed',
    label: 'get_conversation_memory',
  }));
  state = reduceAgentRunProgress(state, { type: 'intent_resolved', intent: 'chat' });
  state = reduceAgentRunProgress(state, { type: 'agent_done' });

  assert.equal(shouldShowAgentRunProgress(state), true);
  assert.equal(formatAgentProgressLabel(state.steps[0]), '🔎 读取对话记忆已完成');
});

test('buffers progress until an image intent is known and flushes it once', () => {
  let router = createAgentProgressEventRouter();
  let routed = routeAgentProgressEvent(router, progress(1));
  router = routed.router;
  assert.deepEqual(routed.events, []);

  routed = routeAgentProgressEvent(router, { type: 'intent_resolved', intent: 'image' });
  assert.deepEqual(routed.events, [progress(1)]);
  assert.deepEqual(routed.router.pending, []);

  routed = routeAgentProgressEvent(routed.router, progress(2));
  assert.deepEqual(routed.events, [progress(2)]);
});

test('repeated image intent events do not reset progress routing', () => {
  let router = createAgentProgressEventRouter();
  let routed = routeAgentProgressEvent(router, { type: 'intent_resolved', intent: 'image' });
  router = routed.router;
  routed = routeAgentProgressEvent(router, { type: 'intent_resolved', intent: 'image' });
  assert.deepEqual(routed.events, []);
  assert.equal(routed.router.intent, 'image');
  routed = routeAgentProgressEvent(routed.router, progress(1));
  assert.deepEqual(routed.events, [progress(1)]);
});

test('flushes buffered and later progress for ordinary chat', () => {
  let router = createAgentProgressEventRouter();
  let routed = routeAgentProgressEvent(router, progress(1));
  assert.deepEqual(routed.events, []);

  routed = routeAgentProgressEvent(routed.router, { type: 'intent_resolved', intent: 'chat' });
  assert.deepEqual(routed.events, [progress(1)]);
  assert.deepEqual(routed.router.pending, []);

  routed = routeAgentProgressEvent(routed.router, progress(2));
  assert.deepEqual(routed.events, [progress(2)]);
});

test('maps semantic progress phases to stable emoji prefixes', () => {
  const cases = [
    ['routing', '🧠'],
    ['analyzing', '🔎'],
    ['planning', '🧩'],
    ['loading', '📚'],
    ['image_ready', '🖼'],
    ['optimizing', '🎨'],
    ['rendering', '🚀'],
    ['executing', '⚙️'],
    ['responding', '✍️', 'composing'],
    ['waiting_input', '📌'],
  ];

  for (const [phase, emoji, stepId = phase] of cases) {
    assert.equal(formatAgentProgressLabel({ phase, stepId, label: '进度' }), `${emoji} 进度`);
  }
});
