import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialAgentRunProgress,
  createAgentProgressEventRouter,
  formatAgentProgressLabel,
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

test('creates an immediate understanding breadcrumb for a new agent run', () => {
  const state = createInitialAgentRunProgress('run-immediate');

  assert.equal(state.runId, 'run-immediate');
  assert.equal(state.operationId, 'run-immediate');
  assert.equal(state.intent, null);
  assert.equal(state.outcome, 'running');
  assert.deepEqual(state.steps, [{
    stepId: 'routing',
    phase: 'routing',
    status: 'active',
    label: '正在理解你的需求…',
  }]);
  assert.equal(shouldShowAgentRunProgress(state), true);
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
  assert.equal(state.outcome, 'failed');
  assert.equal(state.steps.at(-1).status, 'failed');
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

test('ordinary chat preserves breadcrumbs and records its resolved intent', () => {
  const routing = reduceAgentRunProgress(null, progress(1, {
    stepId: 'routing',
    phase: 'routing',
    label: '正在理解并路由请求',
  }));
  const state = reduceAgentRunProgress(routing, {
    type: 'intent_resolved',
    intent: 'chat',
  });

  assert.equal(state.intent, 'chat');
  assert.equal(state.steps.length, 1);
  assert.equal(shouldShowAgentRunProgress(state), true);
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
