import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialAgentRunProgress,
  createAgentProgressEventRouter,
  formatAgentProgressLabel,
  getAgentProgressElapsedMs,
  getAgentRunElapsedMs,
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

  assert.equal(state.steps[0].kind, 'commentary');
  assert.equal(state.steps[0].status, 'completed');
  assert.equal(state.steps[0].commentary, '正在检查画布内容');
  assert.equal(state.steps[0].sequence, 1);
  assert.equal(state.steps[0].lastUpdateSequence, 3);
});

test('keeps exactly one active breadcrumb as commentary and tools advance', () => {
  let state = reduceAgentRunProgress(createInitialAgentRunProgress('run-sequential'), {
    type: 'agent_activity_delta', runId: 'run-sequential', activityId: 'understand', delta: '先检查需求', timestampMs: 1,
  });
  state = reduceAgentRunProgress(state, progress(2, {
    runId: 'run-sequential', stepId: 'read-context', toolCallId: 'read-1', label: '正在读取上下文', timestampMs: 2,
  }));
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_delta', runId: 'run-sequential', activityId: 'explain', delta: '已确认上下文', timestampMs: 3,
  });

  assert.deepEqual(state.steps.map((step) => step.status), ['completed', 'completed', 'active']);
  assert.equal(state.steps.filter((step) => step.status === 'active').length, 1);
});

test('keeps a real commentary-tool-final lifecycle in event order', () => {
  let state = createInitialAgentRunProgress('run-lifecycle');
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_delta', runId: 'run-lifecycle', activityId: 'before-read', delta: '先读取上下文。', sequence: 1, timestampMs: 10,
  });
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_commit', runId: 'run-lifecycle', activityId: 'before-read', disposition: 'commentary', sequence: 1, timestampMs: 10,
  });
  state = reduceAgentRunProgress(state, progress(2, {
    runId: 'run-lifecycle', stepId: 'tool', toolCallId: 'read-1', toolName: 'read_relevant_context', status: 'pending', label: '准备读取相关上下文', timestampMs: 20,
  }));
  state = reduceAgentRunProgress(state, progress(3, {
    runId: 'run-lifecycle', stepId: 'tool', toolCallId: 'read-1', toolName: 'read_relevant_context', status: 'active', label: '正在读取相关上下文', timestampMs: 30,
  }));
  state = reduceAgentRunProgress(state, progress(4, {
    runId: 'run-lifecycle', stepId: 'tool', toolCallId: 'read-1', toolName: 'read_relevant_context', status: 'completed', label: '读取相关上下文已完成', timestampMs: 40,
  }));
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_delta', runId: 'run-lifecycle', activityId: 'final', delta: '读取完成。', sequence: 5, timestampMs: 50,
  });
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_commit', runId: 'run-lifecycle', activityId: 'final', disposition: 'final', sequence: 5, timestampMs: 50,
  });

  assert.deepEqual(state.steps.map((step) => [step.kind, step.status, step.label]), [
    ['commentary', 'completed', '先读取上下文。'],
    ['execution', 'completed', '读取相关上下文已完成'],
  ]);
  assert.equal(state.steps.filter((step) => ['pending', 'active'].includes(step.status)).length, 0);
});

test('continues a recovered attempt without replacing earlier breadcrumbs or elapsed time', () => {
  let state = reduceAgentRunProgress(createInitialAgentRunProgress('run-1'), progress(1, {
    runId: 'run-1', stepId: 'generate_image', toolCallId: 'image-1', timestampMs: 100,
  }));
  state = reduceAgentRunProgress(state, { type: 'agent_error', runId: 'run-1', timestampMs: 200 });
  state = reduceAgentRunProgress(state, progress(1, {
    runId: 'run-2', stepId: 'generate_image', toolCallId: 'image-2', timestampMs: 1_000,
  }));
  state = reduceAgentRunProgress(state, { type: 'agent_done', runId: 'run-2', timestampMs: 1_300 });

  assert.deepEqual(state.steps.map((step) => step.runId), ['run-1', 'run-2']);
  assert.equal(state.attempts.length, 2);
  assert.equal(getAgentRunElapsedMs(state, 2_000), 400);
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

test('keeps all v2 commentary without truncating the timeline or text', () => {
  let state = createInitialAgentRunProgress('run-bounded');
  for (let index = 0; index < 25; index += 1) {
    state = reduceAgentRunProgress(state, {
      type: 'agent_activity_delta',
      activityId: `activity-${index}`,
      delta: index === 24 ? 'x'.repeat(1300) : String(index),
    });
  }

  assert.equal(state.steps.length, 25);
  assert.equal(state.steps[0].activityId, 'activity-0');
  assert.equal(state.steps.at(-1).commentary.length, 1300);
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

test('keeps image preparation, submission, and supplier progress as distinct timeline nodes', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'image_brief', phase: 'analyzing', status: 'completed', label: '图片生成任务已锁定', timestampMs: 1_000,
  }));
  state = reduceAgentRunProgress(state, progress(2, {
    stepId: 'prompt_optimization', phase: 'optimizing', status: 'completed', label: '最终图片提示词已准备', timestampMs: 2_000,
  }));
  state = reduceAgentRunProgress(state, progress(3, {
    stepId: 'image_contract', phase: 'executing', status: 'active', label: '正在提交图片生成请求', toolCallId: 'image-1', toolName: 'generate_image', timestampMs: 3_000,
  }));
  state = reduceAgentRunProgress(state, progress(4, {
    stepId: 'generate_image', phase: 'generating', status: 'active', label: '正在等待图片生成结果', toolCallId: 'image-1', toolName: 'generate_image', timestampMs: 4_000,
  }));
  state = reduceAgentRunProgress(state, progress(5, {
    stepId: 'image_contract', phase: 'executing', status: 'completed', label: '图片生成请求已提交', toolCallId: 'image-1', toolName: 'generate_image', timestampMs: 5_000,
  }));

  assert.deepEqual(state.steps.map((step) => [step.stepId, step.sequence, step.lastUpdateSequence, step.label]), [
    ['image_brief', 1, 1, '图片生成任务已锁定'],
    ['prompt_optimization', 2, 2, '最终图片提示词已准备'],
    ['image_contract', 3, 5, '图片生成请求已提交'],
    ['generate_image', 4, 4, '正在等待图片生成结果'],
  ]);
});

test('image prompt events expose a stable expandable preparation node', () => {
  let state = reduceAgentRunProgress(null, {
    type: 'image_prompts_ready',
    index: 0,
    label: '图片 1',
    prompt: 'A quiet architectural study',
    sequence: 2,
    timestampMs: 2_000,
  });
  state = reduceAgentRunProgress(state, {
    type: 'image_prompts_ready',
    index: 0,
    label: '图片 1',
    prompt: 'A revised architectural study',
    sequence: 3,
    timestampMs: 3_000,
  });

  assert.equal(state.steps.length, 1);
  assert.deepEqual(state.steps[0], {
    stepId: 'prompt_optimization',
    kind: 'execution',
    phase: 'optimizing',
    status: 'completed',
    commentary: '最终图片提示词已准备',
    label: '最终图片提示词已准备',
    sequence: 2,
    timestampMs: 2_000,
    lastUpdateSequence: 3,
  });
});

test('keeps model-authored completion descriptions on their completed step', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'canvas_context',
    toolCallId: 'canvas-call-1',
    label: '正在读取版面信息',
  }));
  state = reduceAgentRunProgress(state, progress(2, {
    stepId: 'canvas_context',
    toolCallId: 'canvas-call-1',
    status: 'completed',
    label: '版面信息已读取',
    completionSummary: '已识别页面层级与可用参考。',
  }));

  assert.equal(state.steps.length, 1);
  assert.equal(state.steps[0].label, '版面信息已读取');
  assert.equal(state.steps[0].completionSummary, '已识别页面层级与可用参考。');
});

test('completes the existing prompt preparation row with model-authored copy', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'prompt_optimization',
    toolCallId: 'image-call-1',
    phase: 'optimizing',
    label: '正在生成最终图片提示词',
  }));
  state = reduceAgentRunProgress(state, {
    type: 'image_prompts_ready',
    index: 0,
    label: '图片 1',
    prompt: 'A quiet architectural study',
    toolCallId: 'image-call-1',
    completedLabel: '最终图片提示词已生成',
    completionSummary: '已根据参考图确定构图、材质与光线。',
    sequence: 2,
    timestampMs: 2_000,
  });

  assert.equal(state.steps.length, 1);
  assert.equal(state.steps[0].status, 'completed');
  assert.equal(state.steps[0].label, '最终图片提示词已生成');
  assert.equal(state.steps[0].completionSummary, '已根据参考图确定构图、材质与光线。');
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

  assert.equal(state.steps[0].label, '已确认，正在启动任务');
  assert.equal(state.steps[0].status, 'completed');
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

test('failed local delivery finalizes an image run and freezes its duration', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    timestampMs: 1_000,
    stepId: 'generate_image',
    phase: 'generating',
    status: 'active',
    label: '正在等待图片生成结果',
    toolCallId: 'image-1',
    toolName: 'generate_image',
  }));
  state = reduceAgentRunProgress(state, progress(2, {
    timestampMs: 2_000,
    stepId: 'generate_image',
    phase: 'generating',
    status: 'completed',
    label: '图片生成完成',
    toolCallId: 'image-1',
    toolName: 'generate_image',
  }));
  state = reduceAgentRunProgress(state, { type: 'assets_pending', count: 1 });
  state = reduceAgentRunProgress(state, { type: 'agent_done', timestampMs: 3_000 });
  state = reduceAgentRunProgress(state, { type: 'assets_settled', succeeded: 0, failed: 1, timestampMs: 4_000 });

  assert.equal(state.outcome, 'failed');
  assert.equal(getAgentProgressElapsedMs(state.steps[0], 99_000), 1_000);
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

test('late asset settlement cannot reopen a cancelled run', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'generate_image',
    phase: 'generating',
    status: 'completed',
    label: '图片生成完成',
  }));
  state = reduceAgentRunProgress(state, { type: 'assets_pending', count: 1 });
  state = reduceAgentRunProgress(state, { type: 'agent_cancelled' });
  state = reduceAgentRunProgress(state, { type: 'assets_settled', succeeded: 0, failed: 1 });

  assert.equal(state.outcome, 'cancelled');
  assert.equal(state.terminalCancelled, true);
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

test('completed ordinary chat retains its v2 timeline', () => {
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
  assert.equal(shouldShowAgentRunProgress(completed), true);
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

test('routes progress immediately before an image intent is known', () => {
  let router = createAgentProgressEventRouter();
  let routed = routeAgentProgressEvent(router, progress(1));
  router = routed.router;
  assert.deepEqual(routed.events, [progress(1)]);

  routed = routeAgentProgressEvent(router, { type: 'intent_resolved', intent: 'image' });
  assert.deepEqual(routed.events, []);
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

test('routes progress immediately before an ordinary chat intent is known', () => {
  let router = createAgentProgressEventRouter();
  let routed = routeAgentProgressEvent(router, progress(1));
  assert.deepEqual(routed.events, [progress(1)]);

  routed = routeAgentProgressEvent(routed.router, { type: 'intent_resolved', intent: 'chat' });
  assert.deepEqual(routed.events, []);
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

test('keeps chronological first-seen positions while tool updates advance lastUpdateSequence', () => {
  let state = reduceAgentRunProgress(null, progress(10, {
    stepId: 'read_context',
    toolCallId: 'tool-1',
    toolName: 'read_relevant_context',
    timestampMs: 1_000,
  }));
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_delta',
    activityId: 'reasoning-1',
    delta: '我先核对上下文。',
    sequence: 11,
    timestampMs: 1_100,
  });
  state = reduceAgentRunProgress(state, progress(12, {
    stepId: 'read_context',
    toolCallId: 'tool-1',
    toolName: 'read_relevant_context',
    status: 'completed',
    label: '已读取上下文',
    timestampMs: 1_200,
  }));

  assert.deepEqual(state.steps.map((step) => [step.kind, step.sequence, step.lastUpdateSequence]), [
    ['execution', 10, 12],
    ['commentary', 11, 11],
  ]);
  assert.equal(state.steps[0].timestampMs, 1_000);
  assert.equal(state.steps[0].label, '已读取上下文');
});

test('accepts streamed commentary updates that share their first sequence stamp', () => {
  let state = reduceAgentRunProgress(null, {
    type: 'agent_activity_delta', activityId: 'same-stamp', delta: '先读取', sequence: 7, timestampMs: 7_000,
  });
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_delta', activityId: 'same-stamp', delta: '上下文。', sequence: 7, timestampMs: 7_000,
  });
  state = reduceAgentRunProgress(state, {
    type: 'agent_activity_commit', activityId: 'same-stamp', disposition: 'commentary', sequence: 7, timestampMs: 7_000,
  });

  assert.equal(state.lastSequence, 7);
  assert.equal(state.steps[0].commentary, '先读取上下文。');
  assert.equal(state.steps[0].status, 'completed');
});

test('renders clarification and confirmation as persistent interaction nodes', () => {
  let state = reduceAgentRunProgress(null, {
    type: 'clarification_required',
    sequence: 3,
    timestampMs: 3_000,
    message: '希望图片更偏简约还是更有张力？',
    request: { id: 'clarify-1' },
  });
  state = reduceAgentRunProgress(state, {
    type: 'confirmation_required',
    sequence: 4,
    timestampMs: 4_000,
    request: { confirmationId: 'confirm-1', toolName: 'generate_image', message: '确认开始生成？' },
  });
  state = reduceAgentRunProgress(state, {
    type: 'confirmation_submitted',
    toolName: 'generate_image',
    sequence: 5,
    timestampMs: 5_000,
  });

  assert.deepEqual(state.steps.map((step) => [step.kind, step.interactionType, step.status, step.sequence]), [
    ['interaction', 'clarification', 'waiting', 3],
    ['interaction', 'confirmation', 'completed', 4],
  ]);
  assert.equal(state.steps[1].lastUpdateSequence, 5);
});

test('keeps a submitted interaction in its original position with the user answer', () => {
  let state = reduceAgentRunProgress(null, {
    type: 'clarification_required',
    sequence: 3,
    timestampMs: 3_000,
    message: '希望图片更偏简约还是更有张力？',
    request: { id: 'clarify-1' },
  });
  state = reduceAgentRunProgress(state, {
    type: 'interaction_submitted',
    interactionId: 'clarify-1',
    interactionType: 'clarification',
    label: '偏简约，保留留白。',
    sequence: 8,
    timestampMs: 8_000,
  });

  assert.deepEqual(state.steps.map((step) => [step.kind, step.sequence, step.status, step.label]), [
    ['interaction', 3, 'completed', '偏简约，保留留白。'],
  ]);
  assert.equal(state.steps[0].lastUpdateSequence, 8);
});

test('freezes a persisted run duration at the terminal event', () => {
  let state = reduceAgentRunProgress(null, progress(1, { timestampMs: 1_000 }));
  state = reduceAgentRunProgress(state, { type: 'agent_done', sequence: 2, timestampMs: 9_000 });

  assert.equal(state.timelineVersion, 2);
  assert.equal(state.runStartedAt, 1_000);
  assert.equal(state.runEndedAt, 9_000);
  assert.equal(state.runEndedAt - state.runStartedAt, 8_000);
});

test('terminal errors leave completed history intact and only fail the active part', () => {
  let state = reduceAgentRunProgress(null, progress(1, {
    stepId: 'read', status: 'completed', timestampMs: 1_000,
  }));
  state = reduceAgentRunProgress(state, progress(2, {
    stepId: 'write', status: 'active', timestampMs: 2_000,
  }));
  state = reduceAgentRunProgress(state, { type: 'agent_error', sequence: 3, timestampMs: 3_000 });

  assert.deepEqual(state.steps.map((step) => [step.stepId, step.status]), [
    ['read', 'completed'], ['write', 'failed'],
  ]);
});

test('upgrades an old reducer state without changing its prior order', () => {
  const oldState = {
    runId: 'old-run', operationId: 'old-run', intent: 'chat', lastSequence: 2,
    steps: [
      { stepId: 'first', kind: 'status', phase: 'routing', status: 'completed', label: '理解需求' },
      { stepId: 'second', kind: 'tool', phase: 'reading', status: 'active', label: '读取上下文', toolName: 'read_relevant_context' },
    ],
    agentDone: false, terminalFailed: false,
    assets: { expected: 0, settled: 0, succeeded: 0, failed: 0 }, outcome: 'running',
  };
  const state = reduceAgentRunProgress(oldState, progress(3, { stepId: 'third', timestampMs: 3_000 }));

  assert.equal(state.timelineVersion, 2);
  assert.deepEqual(state.steps.map((step) => [step.stepId, step.kind, step.sequence]), [
    ['first', 'execution', 1], ['second', 'execution', 2], ['third', 'execution', 3],
  ]);
});
