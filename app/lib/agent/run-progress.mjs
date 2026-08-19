const ASSET_STEP_PATTERN = /(?:image|asset|render|generat)/i;

const TOOL_LABELS = {
  get_conversation_memory: '读取对话记忆',
  list_project_context: '查看项目上下文',
  read_context_entity: '读取上下文实体',
  load_visual_reference: '加载视觉参考',
  update_conversation_memory: '更新对话记忆',
  handle_failed_task: '处理失败任务',
  read_relevant_context: '读取相关上下文',
  submit_agent_analysis_checkpoint: '深入分析当前需求',
  request_user_decision: '等待你选择',
  start_image_planning: '启动图片规划',
  rewind_agent_analysis: '按修订回退任务',
  resolve_failed_task_recovery: '定位上次任务',
  handoff_to_image_planner: '交给 Image Planner',
  request_context_selection: '等待选择引用',
  request_image_clarification: '等待补充信息',
  generate_image: '生成图片',
  start_skill_job: '启动 Skill 任务',
};

const PHASE_EMOJI_RULES = [
  [/(?:waiting|confirm|approval|input)/i, '📌'], [/(?:render)/i, '🚀'],
  [/(?:optimi|style|compose_visual)/i, '🎨'], [/(?:image|asset|generat)/i, '🖼'],
  [/(?:load|skill)/i, '📚'], [/(?:analy|inspect|read|search)/i, '🔎'],
  [/(?:plan|compos|orchestrat)/i, '🧩'], [/(?:execut|tool|run)/i, '⚙️'],
  [/(?:respond|writ|summar)/i, '✍️'], [/(?:resolv|context)/i, '🔗'],
  [/(?:rout|understand|intent)/i, '🧠'],
];

function finiteCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function finiteTimestamp(value, fallback = Date.now()) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function normalStatus(value) {
  return ['pending', 'active', 'waiting', 'completed', 'failed'].includes(value) ? value : 'active';
}

function createBaseState(event = {}) {
  const startedAt = finiteTimestamp(event.timestampMs);
  return {
    timelineVersion: 2,
    runId: typeof event.runId === 'string' ? event.runId : '',
    operationId: typeof event.operationId === 'string' ? event.operationId : '',
    intent: null,
    lastSequence: 0,
    runStartedAt: startedAt,
    attempts: typeof event.runId === 'string' && event.runId ? [{ runId: event.runId, startedAt }] : [],
    steps: [],
    agentDone: false,
    terminalFailed: false,
    terminalCancelled: false,
    assets: { expected: 0, settled: 0, succeeded: 0, failed: 0 },
    outcome: 'running',
  };
}

// Stored v1 messages remain unchanged; this only upgrades a reducer value receiving new events.
function normalizeState(input, event = {}) {
  const base = input || createBaseState(event);
  if (base.timelineVersion === 2) return base;
  const now = finiteTimestamp(event.timestampMs);
  let sequence = Math.max(0, finiteCount(base.lastSequence) - (base.steps?.length || 0));
  const steps = Array.isArray(base.steps) ? base.steps.map((step) => {
    const firstSequence = finiteCount(step?.sequence) || ++sequence;
    sequence = Math.max(sequence, firstSequence);
    return {
      ...step,
      kind: step?.kind === 'commentary' ? 'commentary' : step?.kind === 'interaction' ? 'interaction' : 'execution',
      sequence: firstSequence,
      timestampMs: finiteTimestamp(step?.timestampMs, finiteTimestamp(step?.startedAt, now)),
      lastUpdateSequence: finiteCount(step?.lastUpdateSequence) || firstSequence,
    };
  }) : [];
  return {
    ...base,
    timelineVersion: 2,
    runStartedAt: finiteTimestamp(base.runStartedAt, steps[0]?.timestampMs || now),
    attempts: Array.isArray(base.attempts) && base.attempts.length ? base.attempts : (base.runId ? [{ runId: base.runId, startedAt: finiteTimestamp(base.runStartedAt, now), ...(base.runEndedAt ? { endedAt: finiteTimestamp(base.runEndedAt, now) } : {}) }] : []),
    lastSequence: Math.max(finiteCount(base.lastSequence), sequence),
    steps,
  };
}

function stamp(state, event = {}, allowCurrentSequence = false) {
  if (event.runId && event.runId !== state.runId) return { sequence: state.lastSequence + 1, timestampMs: finiteTimestamp(event.timestampMs) };
  const explicitSequence = finiteCount(event.sequence);
  if (explicitSequence && (explicitSequence < state.lastSequence || (explicitSequence === state.lastSequence && !allowCurrentSequence))) return null;
  return { sequence: explicitSequence || state.lastSequence + 1, timestampMs: finiteTimestamp(event.timestampMs) };
}

function withStamp(state, marker) {
  return {
    ...state,
    lastSequence: Math.max(state.lastSequence, marker.sequence),
    runStartedAt: finiteTimestamp(state.runStartedAt, marker.timestampMs),
  };
}

function withAttempt(state, event, marker, terminal = false) {
  const runId = typeof event.runId === 'string' && event.runId ? event.runId : state.runId;
  if (!runId) return withStamp(state, marker);
  const attempts = Array.isArray(state.attempts) ? state.attempts : [];
  const index = attempts.findIndex((attempt) => attempt.runId === runId);
  const nextAttempts = index < 0
    ? [...attempts, { runId, startedAt: marker.timestampMs, ...(terminal ? { endedAt: marker.timestampMs } : {}) }]
    : attempts.map((attempt, position) => position !== index ? attempt
      : {
          ...attempt,
          ...(!state.steps.length && !attempt.endedAt ? { startedAt: marker.timestampMs } : {}),
          ...(terminal ? { endedAt: marker.timestampMs } : {}),
        });
  return {
    ...withStamp(state, marker), runId, attempts: nextAttempts,
    ...(runId !== state.runId ? { agentDone: false, terminalFailed: false, terminalCancelled: false, runEndedAt: undefined } : {}),
  };
}

function completePreviousActiveSteps(state, marker, keep) {
  return {
    ...state,
    steps: state.steps.map((step) => ['pending', 'active'].includes(step.status) && !keep(step)
      ? { ...step, status: 'completed', completedAt: step.completedAt || marker.timestampMs, lastUpdateSequence: marker.sequence }
      : step),
  };
}

function isImageGenerationStep(step) {
  return step?.toolName === 'generate_image' || step?.stepId === 'generate_image';
}

function needsAssetSettlement(steps) {
  return steps.some((step) => step.toolName === 'generate_image' || ASSET_STEP_PATTERN.test(step.stepId) || ASSET_STEP_PATTERN.test(step.phase));
}

function deriveOutcome(state) {
  if (state.terminalFailed) return 'failed';
  if (state.terminalCancelled) return 'cancelled';
  if (state.steps.some((step) => step.status === 'waiting')) return 'waiting';
  if (!state.agentDone) return 'running';
  if (needsAssetSettlement(state.steps)) {
    if (state.assets.expected === 0 || state.assets.settled < state.assets.expected) return 'waiting';
    if (state.assets.failed > 0 && state.assets.succeeded > 0) return 'warning';
    if (state.assets.failed > 0) return 'failed';
  }
  return 'completed';
}

function withOutcome(state) {
  return { ...state, outcome: deriveOutcome(state) };
}

function appendOrReplaceStep(state, nextStep, predicate) {
  const existingIndex = state.steps.findIndex(predicate);
  if (existingIndex < 0) return { steps: [...state.steps, nextStep], existing: null };
  const existing = state.steps[existingIndex];
  return {
    existing,
    steps: state.steps.map((step, index) => index === existingIndex
      ? { ...step, ...nextStep, sequence: existing.sequence, timestampMs: existing.timestampMs }
      : step),
  };
}

function interactionId(event) {
  return event.type === 'confirmation_required'
    ? String(event.request?.confirmationId || 'confirmation')
    : String(event.request?.id || event.activityId || 'clarification');
}

/** @param {string} runId @returns {import('./run-progress.types').AgentRunProgress} */
export function createInitialAgentRunProgress(runId) {
  const normalizedRunId = typeof runId === 'string' ? runId : '';
  return createBaseState({ runId: normalizedRunId, operationId: normalizedRunId });
}

export function reduceAgentRunProgress(input, event) {
  if (!event || typeof event !== 'object') return input;
  const state = normalizeState(input, event);

  if (event.type === 'agent_activity_delta') {
    if (!event.activityId || !event.delta) return state;
    const marker = stamp(state, event, true);
    if (!marker) return state;
    const activityId = String(event.activityId);
    const sameActivity = (step) => step.activityId === activityId && (!event.runId || step.runId === event.runId);
    const existing = state.steps.find(sameActivity);
    const commentary = `${existing?.commentary || ''}${event.delta}`;
    const marked = withAttempt(state, event, marker);
    const sequential = existing ? marked : completePreviousActiveSteps(marked, marker, sameActivity);
    const result = appendOrReplaceStep(sequential, {
      stepId: `activity:${activityId}`, activityId, kind: 'commentary', phase: 'commentary', status: 'active',
      commentary, label: commentary, runId: event.runId || marked.runId, sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
    }, sameActivity);
    return withOutcome({ ...sequential, steps: result.steps });
  }

  if (event.type === 'agent_activity_commit') {
    if (!event.activityId) return state;
    const marker = stamp(state, event, true);
    if (!marker) return state;
    const marked = withAttempt(state, event, marker);
    const activityId = String(event.activityId);
    if (event.disposition === 'final') return withOutcome({ ...marked, steps: marked.steps.filter((step) => step.activityId !== activityId || (event.runId && step.runId !== event.runId)) });
    if (event.disposition !== 'commentary') return marked;
    return withOutcome({ ...marked, steps: marked.steps.map((step) => step.activityId === activityId ? { ...step, status: 'completed', lastUpdateSequence: marker.sequence } : step) });
  }

  if (event.type === 'image_prompts_ready') {
    const marker = stamp(state, event);
    if (!marker) return state;
    const marked = completePreviousActiveSteps(withAttempt(state, event, marker), marker, (step) => step.stepId === 'prompt_optimization' && step.toolCallId === event.toolCallId && (!event.runId || step.runId === event.runId));
    const result = appendOrReplaceStep(marked, {
      stepId: 'prompt_optimization', kind: 'execution', phase: 'optimizing', status: 'completed',
      commentary: String(event.completedLabel || '最终图片提示词已准备'), label: String(event.completedLabel || '最终图片提示词已准备'),
      ...(typeof event.completionSummary === 'string' && event.completionSummary.trim() ? { completionSummary: event.completionSummary.trim() } : {}),
      ...(typeof event.toolCallId === 'string' ? { toolCallId: event.toolCallId } : {}),
      ...(event.runId || marked.runId ? { runId: event.runId || marked.runId } : {}), sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
    }, (step) => step.stepId === 'prompt_optimization' && (event.toolCallId ? step.toolCallId === event.toolCallId : !step.toolCallId) && (!event.runId || step.runId === event.runId));
    return withOutcome({ ...marked, steps: result.steps });
  }

  if (event.type === 'progress_update') {
    const marker = stamp(state, event);
    if (!marker) return state;
    const toolName = typeof event.toolName === 'string' ? event.toolName : undefined;
    const nextStep = {
      stepId: String(event.stepId || `step-${marker.sequence}`), kind: 'execution', phase: String(event.phase || ''), status: normalStatus(event.status),
      commentary: String(event.label || ''), label: String(event.label || ''), sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
      ...(typeof event.completionSummary === 'string' && event.completionSummary.trim() ? { completionSummary: event.completionSummary.trim() } : {}),
      ...(typeof event.toolCallId === 'string' ? { toolCallId: event.toolCallId } : {}),
      ...(toolName ? { tool: toolName, toolName } : {}), ...(event.detail ? { detail: event.detail } : {}), runId: event.runId || state.runId,
    };
    const marked = withAttempt({ ...state, operationId: typeof event.operationId === 'string' ? event.operationId : state.operationId }, event, marker);
    const matches = (step) => step.stepId === nextStep.stepId && (nextStep.toolCallId ? step.toolCallId === nextStep.toolCallId : !step.toolCallId) && (!event.runId || step.runId === event.runId);
    const sequential = state.steps.some(matches) ? marked : completePreviousActiveSteps(marked, marker, matches);
    const result = appendOrReplaceStep(sequential, nextStep, matches);
    if (isImageGenerationStep(nextStep)) {
      const target = result.steps.find((candidate) => candidate.sequence === (result.existing?.sequence || nextStep.sequence));
      if (target && nextStep.status === 'active') {
        target.startedAt = result.existing?.startedAt || marker.timestampMs;
        target.completedAt = undefined;
      } else if (target && ['completed', 'failed'].includes(nextStep.status)) {
        target.startedAt = result.existing?.startedAt || marker.timestampMs;
        target.completedAt = result.existing?.completedAt || marker.timestampMs;
      }
    }
    return withOutcome({ ...sequential, steps: result.steps });
  }

  if (event.type === 'clarification_required' || event.type === 'confirmation_required') {
    const marker = stamp(state, event);
    if (!marker) return state;
    const type = event.type === 'confirmation_required' ? 'confirmation' : 'clarification';
    const id = interactionId(event);
    const label = event.type === 'confirmation_required' ? String(event.request?.message || '此操作需要你的确认。') : String(event.message || event.request?.question || '需要补充信息。');
    const marked = completePreviousActiveSteps(withAttempt(state, event, marker), marker, (step) => step.interactionId === id && step.interactionType === type);
    const result = appendOrReplaceStep(marked, {
      stepId: `interaction:${type}:${id}`, interactionId: id, interactionType: type, kind: 'interaction', phase: `waiting_${type}`, status: 'waiting',
      label, commentary: label, runId: event.runId || marked.runId, sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
      ...(event.request?.toolName ? { toolName: event.request.toolName } : {}),
    }, (step) => step.interactionId === id && step.interactionType === type);
    return withOutcome({ ...marked, steps: result.steps });
  }

  if (event.type === 'intent_resolved') {
    const intent = ['chat', 'image', 'skill_action'].includes(event.intent) ? event.intent : state.intent;
    return intent === state.intent ? state : { ...state, intent };
  }

  if (event.type === 'confirmation_submitted') {
    const marker = stamp(state, event);
    if (!marker) return state;
    const marked = completePreviousActiveSteps(withAttempt(state, event, marker), marker, (step) => step.stepId === 'skill_job_assets');
    const targetIndex = marked.steps.findLastIndex((step) => step.status === 'waiting' && (!event.toolName || step.toolName === event.toolName || step.stepId === event.toolName));
    if (targetIndex < 0) return marked;
    return withOutcome({ ...marked, steps: marked.steps.map((step, index) => index === targetIndex ? { ...step, status: 'completed', phase: 'confirmed', commentary: '已确认，正在启动任务', label: '已确认，正在启动任务', lastUpdateSequence: marker.sequence } : step) });
  }

  if (event.type === 'interaction_submitted') {
    const marker = stamp(state, event);
    if (!marker) return state;
    const marked = withStamp(state, marker);
    return withOutcome({
      ...marked,
      steps: marked.steps.map((step) => (
        step.interactionId === event.interactionId && step.interactionType === event.interactionType
          ? { ...step, status: 'completed', phase: `resolved_${event.interactionType}`, commentary: event.label, label: event.label, lastUpdateSequence: marker.sequence }
          : step
      )),
    });
  }

  if (event.type === 'assets_pending') {
    const expected = finiteCount(event.count);
    return withOutcome({ ...state, assets: { expected, settled: 0, succeeded: 0, failed: 0 } });
  }

  if (event.type === 'assets_progress' || event.type === 'assets_settled') {
    const marker = stamp(state, event);
    if (!marker) return state;
    const succeeded = finiteCount(event.succeeded);
    const failed = finiteCount(event.failed);
    const settled = succeeded + failed;
    const expected = event.type === 'assets_progress' ? finiteCount(event.total) : Math.max(state.assets.expected, settled);
    const complete = settled >= expected && expected > 0;
    const label = complete ? (failed > 0 ? `素材生成结束（成功 ${succeeded}，失败 ${failed}）` : `素材生成完成（${settled}/${expected}）`) : `正在生成素材（${settled}/${expected || 0}）`;
    const marked = withStamp(state, marker);
    const result = appendOrReplaceStep(marked, {
      stepId: 'skill_job_assets', kind: 'execution', phase: 'generating', status: complete && failed > 0 && succeeded === 0 ? 'failed' : complete ? 'completed' : 'active',
      label, commentary: label, toolName: 'start_skill_job', tool: 'start_skill_job', runId: event.runId || marked.runId, sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
    }, (step) => step.stepId === 'skill_job_assets' && (!event.runId || step.runId === event.runId));
    return withOutcome({ ...marked, steps: result.steps, assets: { expected, settled, succeeded, failed } });
  }

  if (event.type === 'agent_done') {
    const marker = stamp(state, event);
    if (!marker) return state;
    const marked = completePreviousActiveSteps(withAttempt(state, event, marker, true), marker, () => false);
    return withOutcome({ ...marked, agentDone: true, runEndedAt: marker.timestampMs });
  }

  if (event.type === 'agent_error' || event.type === 'agent_cancelled') {
    const marker = stamp(state, event);
    if (!marker) return state;
    const marked = withAttempt(state, event, marker, true);
    const cancelled = event.type === 'agent_cancelled';
    const label = cancelled ? '任务已终止' : '任务执行失败';
    const activeIndex = marked.steps.findLastIndex((step) => ['pending', 'active'].includes(step.status));
    const steps = activeIndex >= 0 ? marked.steps.map((step, index) => index === activeIndex ? { ...step, status: cancelled ? 'completed' : 'failed', phase: cancelled ? 'cancelled' : 'failed', commentary: label, label, completedAt: marker.timestampMs, lastUpdateSequence: marker.sequence } : step) : [...marked.steps, {
      stepId: cancelled ? 'agent-cancelled' : 'agent-error', kind: 'execution', phase: cancelled ? 'cancelled' : 'failed', status: cancelled ? 'completed' : 'failed',
      commentary: label, label, sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
    }];
    return cancelled
      ? { ...marked, agentDone: true, terminalCancelled: true, runEndedAt: marker.timestampMs, outcome: 'cancelled', steps }
      : { ...marked, agentDone: true, terminalFailed: true, runEndedAt: marker.timestampMs, outcome: 'failed', steps };
  }

  return state;
}

export function shouldShowAgentRunProgress(state) {
  if (!state?.steps?.length) return false;
  if (state.timelineVersion === 2) return true;
  if (state.outcome !== 'completed') return true;
  if (state.intent !== 'chat') return true;
  return state.steps.some((step) => step.kind === 'tool' || step.tool || step.toolName);
}

export function createAgentProgressEventRouter() {
  return { intent: null, pending: [] };
}

export function routeAgentProgressEvent(router, event) {
  const current = router || createAgentProgressEventRouter();
  if (event?.type === 'intent_resolved') {
    const intent = event.intent === 'image' || event.intent === 'skill_action' ? event.intent : 'chat';
    if (current.intent === intent) return { router: current, events: [] };
    return { router: { intent, pending: [] }, events: [] };
  }
  if (event?.type !== 'progress_update') return { router: current, events: [event] };
  return { router: current, events: [event] };
}

export function formatAgentProgressLabel(step) {
  const phase = String(step?.phase || '');
  const stepId = String(step?.stepId || '');
  const emoji = PHASE_EMOJI_RULES.find(([pattern]) => pattern.test(phase))?.[1] || PHASE_EMOJI_RULES.find(([pattern]) => pattern.test(stepId))?.[1] || '⚙️';
  const toolName = typeof step?.tool === 'string' ? step.tool : step?.tool?.name || step?.toolName || '';
  const friendlyTool = TOOL_LABELS[toolName] || String(step?.tool?.label || toolName).replaceAll('_', ' ');
  const commentary = String(step?.commentary || step?.label || '').trim();
  const label = commentary && commentary !== toolName ? commentary : friendlyTool ? step?.status === 'completed' ? `${friendlyTool}已完成` : step?.status === 'failed' ? `${friendlyTool}失败` : step?.status === 'waiting' ? `等待${friendlyTool}` : step?.status === 'pending' ? `准备${friendlyTool}` : `正在${friendlyTool}` : '';
  return `${emoji} ${label}`.trim();
}

export function getAgentProgressElapsedMs(step, now = Date.now()) {
  if (!isImageGenerationStep(step) || !Number.isFinite(Number(step?.startedAt))) return null;
  const end = Number.isFinite(Number(step?.completedAt)) ? Number(step.completedAt) : step?.status === 'active' ? Number(now) : null;
  return Number.isFinite(end) ? Math.max(0, end - Number(step.startedAt)) : null;
}

export function getAgentRunElapsedMs(progress, now = Date.now()) {
  return (progress?.attempts || []).reduce((total, attempt) => total + Math.max(0, Number(attempt.endedAt || now) - Number(attempt.startedAt || now)), 0);
}
