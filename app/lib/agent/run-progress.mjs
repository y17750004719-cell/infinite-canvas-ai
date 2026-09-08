import { classifyAgentEvent } from './event-contract.mjs';

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
  rewind_agent_analysis: '按修订回退任务',
  resolve_failed_task_recovery: '定位上次任务',
  request_context_selection: '等待选择引用',
  generate_image: '生成图片',
};

const PHASE_EMOJI_RULES = [
  [/(?:waiting|confirm|approval|input)/i, '📌'], [/(?:render)/i, '🚀'],
  [/(?:prompt|style|compose_visual)/i, '🎨'], [/(?:image|asset|generat)/i, '🖼'],
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

function itemStatusFromStepStatus(status, phase = '') {
  if (phase === 'declined') return 'declined';
  if (phase === 'cancelled') return 'cancelled';
  if (status === 'active' || status === 'pending') return 'in_progress';
  return status;
}

function itemTypeFromStep(step = {}) {
  if (step.itemType) return step.itemType;
  if (step.kind === 'commentary') return 'commentary';
  if (step.kind === 'tool') return 'tool_call';
  if (step.kind === 'interaction') return step.interactionType === 'confirmation' ? 'approval' : 'clarification';
  if (step.stepId === 'skill_loading' || /skill/i.test(String(step.phase || ''))) return 'skill';
  if (step.stepId === 'asset_delivery' || /asset|delivery/i.test(String(step.phase || ''))) return 'asset_delivery';
  if (isImageGenerationStep(step) || /image|generat|prompt/i.test(`${step.stepId || ''} ${step.phase || ''}`)) return 'image_generation';
  if (step.status === 'failed' || step.phase === 'failed') return 'error';
  return 'agent_message';
}

function stableItemId(step = {}, runId = '') {
  if (typeof step.itemId === 'string' && step.itemId) return step.itemId;
  const identity = step.toolCallId || step.activityId || step.interactionId || step.stepId || step.sequence || 'item';
  return `${runId || step.runId || 'run'}:${itemTypeFromStep(step)}:${identity}`;
}

function withItemMetadata(step, runId = '') {
  const next = { ...step };
  next.itemId = stableItemId(next, runId);
  next.turnId = next.turnId || next.runId || runId;
  next.itemType = itemTypeFromStep(next);
  next.itemStatus = itemStatusFromStepStatus(next.status, next.phase);
  return next;
}

function dedupePersistedErrorSteps(steps) {
  const positions = new Map();
  const result = [];
  for (const step of steps) {
    const isAgentError = step?.itemType === 'error'
      || step?.stepId === 'agent-error'
      || (step?.status === 'failed' && step?.phase === 'failed' && !step?.toolCallId && !step?.toolName);
    if (!isAgentError) {
      result.push(step);
      continue;
    }
    const key = step.operationId || step.itemId
      ? `${step.operationId || ''}:${step.sequence || ''}:${step.itemId || step.runId || 'agent-error'}:agent-error`
      : `${step.runId || 'agent'}:agent-error`;
    const existingIndex = positions.get(key);
    if (existingIndex === undefined) {
      positions.set(key, result.length);
      result.push(step);
      continue;
    }
    const existing = result[existingIndex];
    result[existingIndex] = {
      ...existing,
      ...step,
      itemId: existing.itemId || step.itemId,
      sequence: existing.sequence || step.sequence,
      timestampMs: existing.timestampMs || step.timestampMs,
    };
  }
  return result;
}

function createBaseState(event = {}) {
  const startedAt = finiteTimestamp(event.timestampMs);
  return {
    timelineVersion: 2,
    taskId: typeof event.taskId === 'string' ? event.taskId : (typeof event.runId === 'string' ? event.runId : ''),
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
  const now = finiteTimestamp(event.timestampMs);
  const existingSteps = Array.isArray(base.steps) ? base.steps : [];
  if (base.timelineVersion === 2) {
    const steps = dedupePersistedErrorSteps(existingSteps).map((step) => {
      const needsMetadata = !step?.itemId || !step?.turnId || !step?.itemType || !step?.itemStatus;
      return needsMetadata ? withItemMetadata(step, base.runId) : step;
    });
    const taskId = typeof base.taskId === 'string' && base.taskId
      ? base.taskId
      : (typeof base.runId === 'string' ? base.runId : '');
    const normalized = steps.every((step, index) => step === existingSteps[index]) && taskId === base.taskId
      ? base
      : { ...base, taskId, steps };
    return repairPersistedTerminalState(normalized, now);
  }
  let sequence = Math.max(0, finiteCount(base.lastSequence) - (base.steps?.length || 0));
  const steps = Array.isArray(base.steps) ? base.steps.map((step) => {
    const firstSequence = finiteCount(step?.sequence) || ++sequence;
    sequence = Math.max(sequence, firstSequence);
    return withItemMetadata({
      ...step,
      kind: step?.kind === 'commentary' ? 'commentary' : step?.kind === 'interaction' ? 'interaction' : 'execution',
      sequence: firstSequence,
      timestampMs: finiteTimestamp(step?.timestampMs, finiteTimestamp(step?.startedAt, now)),
      lastUpdateSequence: finiteCount(step?.lastUpdateSequence) || firstSequence,
    }, base.runId);
  }) : [];
  const normalizedSteps = dedupePersistedErrorSteps(steps);
  const normalized = {
    ...base,
    timelineVersion: 2,
    taskId: typeof base.taskId === 'string' && base.taskId ? base.taskId : base.runId,
    runStartedAt: finiteTimestamp(base.runStartedAt, normalizedSteps[0]?.timestampMs || now),
    attempts: Array.isArray(base.attempts) && base.attempts.length ? base.attempts : (base.runId ? [{ runId: base.runId, startedAt: finiteTimestamp(base.runStartedAt, now), ...(base.runEndedAt ? { endedAt: finiteTimestamp(base.runEndedAt, now) } : {}) }] : []),
    lastSequence: Math.max(finiteCount(base.lastSequence), sequence),
    steps: normalizedSteps,
  };
  return repairPersistedTerminalState(normalized, now);
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
    ...(typeof event.taskId === 'string' && event.taskId ? { taskId: event.taskId } : {}),
    ...(runId !== state.runId ? { agentDone: false, terminalFailed: false, terminalCancelled: false, runEndedAt: undefined } : {}),
  };
}

function completePreviousActiveSteps(state, marker, keep) {
  return {
    ...state,
    steps: state.steps.map((step) => ['pending', 'active'].includes(step.status) && !keep(step)
      ? withItemMetadata({ ...step, status: 'completed', completedAt: step.completedAt || marker.timestampMs, lastUpdateSequence: marker.sequence }, state.runId)
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

function repairPersistedTerminalState(state, now) {
  if (state.outcome !== 'running' || state.agentDone || state.terminalFailed || state.terminalCancelled) return state;
  if (state.steps.some((step) => ['pending', 'active', 'waiting'].includes(step.status))) return state;
  if (!(state.assets?.expected > 0 && state.assets.settled >= state.assets.expected)) return state;
  if (!state.steps.some((step) => (
    isImageGenerationStep(step)
    || step.itemType === 'asset_delivery'
    || step.stepId === 'asset_delivery'
  ) && step.status === 'completed')) return state;
  const endedAt = state.steps.reduce((latest, step) => Math.max(
    latest,
    finiteTimestamp(step.completedAt, finiteTimestamp(step.timestampMs, 0)),
  ), finiteTimestamp(state.runStartedAt, finiteTimestamp(now)));
  const attempts = Array.isArray(state.attempts) && state.attempts.length
    ? state.attempts.map((attempt) => attempt.endedAt ? attempt : { ...attempt, endedAt })
    : state.runId ? [{ runId: state.runId, startedAt: finiteTimestamp(state.runStartedAt, endedAt), endedAt }] : [];
  return withOutcome({ ...state, agentDone: true, runEndedAt: endedAt, attempts });
}

function appendOrReplaceStep(state, nextStep, predicate) {
  const normalizedStep = withItemMetadata(nextStep, state.runId);
  const existingIndex = state.steps.findIndex(predicate);
  if (existingIndex < 0) return { steps: [...state.steps, normalizedStep], existing: null };
  const existing = state.steps[existingIndex];
  return {
    existing,
    steps: state.steps.map((step, index) => index === existingIndex
      ? withItemMetadata({ ...step, ...normalizedStep, itemId: existing.itemId || normalizedStep.itemId, sequence: existing.sequence, timestampMs: existing.timestampMs }, state.runId)
      : step),
  };
}

function toolNameFromStep(step) {
  if (typeof step?.toolName === 'string' && step.toolName.trim()) return step.toolName.trim();
  if (typeof step?.tool === 'string' && step.tool.trim()) return step.tool.trim();
  if (step?.tool && typeof step.tool.name === 'string' && step.tool.name.trim()) return step.tool.name.trim();
  return '';
}

function summarizeToolResult(result) {
  if (typeof result === 'string') return result.trim().slice(0, 1200);
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  for (const key of ['summary', 'message', 'detail', 'status']) {
    if (typeof result[key] === 'string' && result[key].trim()) return result[key].trim().slice(0, 1200);
  }
  return '';
}

function toolStepMatches(step, event) {
  return step?.toolCallId === event.toolCallId && (!event.runId || step.runId === event.runId);
}

function reduceToolLifecycleEvent(state, event) {
  if (!event?.toolCallId) return state;
  const marker = stamp(state, event);
  if (!marker) return state;
  const matchingSteps = state.steps.filter((step) => toolStepMatches(step, event));
  const existing = matchingSteps.find((step) => step.kind === 'tool') || matchingSteps.at(-1);
  const toolName = String(event.toolName || toolNameFromStep(existing) || '').trim();
  const status = event.type === 'tool_result' ? (event.isError ? 'failed' : 'completed') : 'active';
  const message = event.type === 'tool_update' && typeof event.message === 'string' ? event.message.trim() : '';
  const resultSummary = event.type === 'tool_result' ? summarizeToolResult(event.result) : '';
  const defaultLabel = status === 'completed'
    ? `${toolName || '工具'}已完成`
    : status === 'failed'
      ? `${toolName || '工具'}失败`
      : `正在调用 ${toolName || '工具'}`;
  const nextStep = {
    stepId: existing?.stepId || `tool:${event.toolCallId}`,
    kind: 'tool',
    phase: 'executing',
    status,
    label: message || defaultLabel,
    commentary: message || existing?.commentary || undefined,
    ...(toolName ? { tool: toolName, toolName } : {}),
    toolCallId: event.toolCallId,
    itemId: event.itemId,
    executionId: event.executionId || event.toolCallId,
    parentItemId: event.parentItemId || existing?.parentItemId,
    commentaryItemId: event.parentItemId || existing?.commentaryItemId,
    retryability: event.retryability || existing?.retryability,
    ...(resultSummary ? { detail: resultSummary, completionSummary: resultSummary } : {}),
    runId: event.runId || existing?.runId || state.runId,
    sequence: existing?.sequence || marker.sequence,
    timestampMs: existing?.timestampMs || marker.timestampMs,
    lastUpdateSequence: marker.sequence,
  };
  const marked = withAttempt({ ...state, operationId: event.operationId || state.operationId }, event, marker);
  const matches = (step) => toolStepMatches(step, event);
  const sequential = existing ? marked : completePreviousActiveSteps(marked, marker, matches);
  const result = appendOrReplaceStep(sequential, nextStep, matches);
  return withOutcome({ ...sequential, steps: result.steps });
}

function interactionId(event) {
  return event.type === 'confirmation_required'
    ? String(event.request?.confirmationId || 'confirmation')
    : String(event.request?.id || event.activityId || 'clarification');
}

/** @param {string} runId @returns {import('./run-progress.types').AgentRunProgress} */
export function createInitialAgentRunProgress(runId) {
  const normalizedRunId = typeof runId === 'string' ? runId : '';
  return createBaseState({ taskId: normalizedRunId, runId: normalizedRunId, operationId: normalizedRunId });
}

export function reduceAgentRunProgress(input, inputEvent) {
  if (!inputEvent || typeof inputEvent !== 'object') return input;
  const state = normalizeState(input, inputEvent);

  const hasIdentity = Boolean(inputEvent.runId || inputEvent.taskId || inputEvent.operationId);
  const eventForClassification = {
    ...inputEvent,
    taskId: inputEvent.taskId || (inputEvent.runId && inputEvent.runId !== state.runId ? inputEvent.runId : state.taskId) || inputEvent.runId || 'transient',
    operationId: inputEvent.operationId || (inputEvent.runId && inputEvent.runId !== state.runId ? inputEvent.runId : state.operationId) || inputEvent.runId || 'transient',
    runId: inputEvent.runId || state.runId || 'transient',
    sequence: inputEvent.sequence ?? (state.lastSequence + 1),
  };
  const eventClassification = hasIdentity ? classifyAgentEvent(eventForClassification, {
    taskId: inputEvent.taskId ? state.taskId : '',
    operationId: inputEvent.taskId ? state.operationId : '',
    lastSequence: inputEvent.runId && inputEvent.runId !== state.runId ? 0 : state.lastSequence,
  }) : { accepted: true, identity: null };
  if (!eventClassification.accepted && inputEvent.type !== 'agent_start') return state;
  const event = eventClassification.identity
    ? { ...eventForClassification, ...eventClassification.identity }
    : inputEvent;

  if (event.type === 'agent_start') {
    if (event.operationId && state.operationId && event.operationId !== state.operationId) return createBaseState(event);
    const marker = stamp(state, event);
    if (!marker) return state;
    return withOutcome(withAttempt(state, event, marker));
  }

  if (event.type === 'tool_start' || event.type === 'tool_update' || event.type === 'tool_result') {
    return reduceToolLifecycleEvent(state, event);
  }

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
      stepId: `activity:${activityId}`, itemId: `commentary:${event.runId || marked.runId}:${activityId}`, activityId, kind: 'commentary', itemType: 'commentary', phase: 'commentary', status: 'active',
      commentary, label: commentary, runId: event.runId || marked.runId, sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
    }, sameActivity);
    return withOutcome({ ...sequential, steps: result.steps });
  }

  if (event.type === 'agent_activity_commit') {
    if (!event.activityId) return state;
    const marker = stamp(state, event, true);
    if (!marker) return state;
    const marked = withAttempt(state, event, marker, event.disposition === 'final');
    const activityId = String(event.activityId);
    if (event.disposition === 'final') {
      return withOutcome({
        ...marked,
        agentDone: true,
        runEndedAt: marker.timestampMs,
        steps: marked.steps.filter((step) => step.activityId !== activityId || (event.runId && step.runId !== event.runId)),
      });
    }
    if (event.disposition !== 'commentary') return marked;
    return withOutcome({ ...marked, steps: marked.steps.map((step) => step.activityId === activityId
      ? withItemMetadata({ ...step, status: 'completed', completedAt: marker.timestampMs, lastUpdateSequence: marker.sequence }, marked.runId)
      : step) });
  }

  if (event.type === 'image_prompts_ready') {
    const marker = stamp(state, event);
    if (!marker) return state;
    const marked = completePreviousActiveSteps(withAttempt(state, event, marker), marker, (step) => step.stepId === 'image_prompt' && step.toolCallId === event.toolCallId && (!event.runId || step.runId === event.runId));
    const result = appendOrReplaceStep(marked, {
      stepId: 'image_prompt', itemId: event.itemId, parentItemId: event.parentItemId, kind: 'execution', itemType: 'image_generation', phase: 'prompt', status: 'completed',
      commentary: String(event.completedLabel || '最终图片提示词已准备'), label: String(event.completedLabel || '最终图片提示词已准备'),
      ...(typeof event.completionSummary === 'string' && event.completionSummary.trim() ? { completionSummary: event.completionSummary.trim() } : {}),
      ...(typeof event.toolCallId === 'string' ? { toolCallId: event.toolCallId } : {}),
      ...(event.runId || marked.runId ? { runId: event.runId || marked.runId } : {}), sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
    }, (step) => step.stepId === 'image_prompt' && (event.toolCallId ? step.toolCallId === event.toolCallId : !step.toolCallId) && (!event.runId || step.runId === event.runId));
    return withOutcome({ ...marked, steps: result.steps });
  }

  if (event.type === 'progress_update') {
    const marker = stamp(state, event);
    if (!marker) return state;
    const toolName = typeof event.toolName === 'string' ? event.toolName : undefined;
    const nextStep = {
      stepId: String(event.stepId || `step-${marker.sequence}`), itemId: event.itemId, executionId: event.executionId, parentItemId: event.parentItemId, retryability: event.retryability, kind: 'execution', phase: String(event.phase || ''), status: normalStatus(event.status),
      commentary: String(event.label || ''), label: String(event.label || ''), sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
      ...(typeof event.completionSummary === 'string' && event.completionSummary.trim() ? { completionSummary: event.completionSummary.trim() } : {}),
      ...(typeof event.toolCallId === 'string' ? { toolCallId: event.toolCallId } : {}),
      ...(toolName ? { tool: toolName, toolName } : {}), ...(event.detail ? { detail: event.detail } : {}), runId: event.runId || state.runId,
    };
    const marked = withAttempt({ ...state, operationId: typeof event.operationId === 'string' ? event.operationId : state.operationId }, event, marker);
    const hasLifecycleTool = nextStep.toolCallId
      && state.steps.some((step) => step.kind === 'tool' && toolStepMatches(step, nextStep));
    const matches = (step) => hasLifecycleTool
      ? toolStepMatches(step, nextStep)
      : step.stepId === nextStep.stepId
        && (!nextStep.toolCallId || step.toolCallId === nextStep.toolCallId)
        && (!event.runId || step.runId === event.runId);
    const existing = state.steps.find(matches);
    if (existing?.kind === 'tool') {
      nextStep.kind = 'tool';
      nextStep.stepId = existing.stepId;
    }
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
      stepId: `interaction:${type}:${id}`, itemId: event.itemId || `${type}:${event.runId || marked.runId}:${id}`, parentItemId: event.parentItemId, interactionId: id, interactionType: type, kind: 'interaction', itemType: type === 'confirmation' ? 'approval' : 'clarification', phase: `waiting_${type}`, status: 'waiting',
      label, commentary: label, runId: event.runId || marked.runId, sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
      ...(event.request?.toolName ? { toolName: event.request.toolName } : {}),
    }, (step) => step.interactionId === id && step.interactionType === type);
    return withOutcome({ ...marked, steps: result.steps });
  }

  if (event.type === 'intent_resolved') {
    const intent = ['chat', 'image', 'skill_action'].includes(event.intent) ? event.intent : state.intent;
    return intent === state.intent ? state : { ...state, intent };
  }

  if (event.type === 'skill_selected') {
    const marker = stamp(state, event);
    if (!marker || !event.skillId) return state;
    const skillId = String(event.skillId);
    const marked = withAttempt(state, event, marker);
    const nextStep = {
      stepId: `skill:${skillId}`,
      itemId: `${event.runId || marked.runId}:skill:${skillId}`,
      itemType: 'skill',
      kind: 'execution',
      phase: 'selected',
      status: 'completed',
      label: String(event.label || skillId),
      commentary: String(event.label || skillId),
      runId: event.runId || marked.runId,
      sequence: marker.sequence,
      timestampMs: marker.timestampMs,
      completedAt: marker.timestampMs,
      lastUpdateSequence: marker.sequence,
    };
    const result = appendOrReplaceStep(marked, nextStep, (step) => step.stepId === nextStep.stepId);
    return withOutcome({ ...marked, steps: result.steps });
  }

  if (event.type === 'active_skill_changed' && event.skill?.id) {
    return reduceAgentRunProgress(state, {
      ...event,
      type: 'skill_selected',
      skillId: event.skill.id,
      label: event.skill.label,
    });
  }

  if (event.type === 'confirmation_submitted') {
    const marker = { sequence: Number.isFinite(Number(event.sequence)) ? Number(event.sequence) : state.lastSequence, timestampMs: finiteTimestamp(event.timestampMs) };
    const marked = completePreviousActiveSteps(withAttempt(state, event, { ...marker, sequence: state.lastSequence }), marker, (step) => step.stepId === 'asset_delivery');
    const targetIndex = marked.steps.findLastIndex((step) => step.status === 'waiting' && (!event.toolName || step.toolName === event.toolName || step.stepId === event.toolName));
    if (targetIndex < 0) return marked;
    return withOutcome({ ...marked, steps: marked.steps.map((step, index) => index === targetIndex
      ? withItemMetadata({ ...step, status: 'completed', phase: 'confirmed', commentary: '已确认，正在启动任务', label: '已确认，正在启动任务', completedAt: marker.timestampMs, lastUpdateSequence: marker.sequence }, marked.runId)
      : step) });
  }

  if (event.type === 'interaction_submitted') {
    const marker = { sequence: Number.isFinite(Number(event.sequence)) ? Number(event.sequence) : state.lastSequence, timestampMs: finiteTimestamp(event.timestampMs) };
    const marked = withAttempt(state, event, { ...marker, sequence: state.lastSequence });
    return withOutcome({
      ...marked,
      steps: marked.steps.map((step) => (
        step.interactionId === event.interactionId && step.interactionType === event.interactionType
          ? withItemMetadata({ ...step, status: 'completed', phase: `resolved_${event.interactionType}`, commentary: event.label, label: event.label, completedAt: marker.timestampMs, lastUpdateSequence: marker.sequence }, marked.runId)
          : step
      )),
    });
  }

  if (event.type === 'assets_pending') {
    const expected = finiteCount(event.count);
    if (event.origin === 'client') {
      return withOutcome({ ...state, assets: {
        expected: Math.max(state.assets.expected, expected),
        settled: state.assets.settled,
        succeeded: state.assets.succeeded,
        failed: state.assets.failed,
      } });
    }
    return withOutcome({ ...state, assets: { expected, settled: 0, succeeded: 0, failed: 0 } });
  }

  if (event.type === 'assets_progress' || event.type === 'assets_settled') {
    const succeeded = finiteCount(event.succeeded);
    const failed = finiteCount(event.failed);
    const clientOrigin = event.origin === 'client';
    const marker = clientOrigin
      ? { sequence: state.lastSequence, timestampMs: finiteTimestamp(event.timestampMs) }
      : stamp(state, event);
    if (!marker) return state;
    const settled = clientOrigin ? Math.max(state.assets.settled, succeeded + failed) : succeeded + failed;
    const expected = event.type === 'assets_progress'
      ? (clientOrigin ? Math.max(state.assets.expected, finiteCount(event.total)) : finiteCount(event.total))
      : Math.max(state.assets.expected, settled);
    const complete = settled >= expected && expected > 0;
    const label = complete ? (failed > 0 ? `素材生成结束（成功 ${succeeded}，失败 ${failed}）` : `素材生成完成（${settled}/${expected}）`) : `正在生成素材（${settled}/${expected || 0}）`;
    const marked = clientOrigin ? state : withStamp(state, marker);
    const parentItemId = [...marked.steps].reverse().find((step) => step.toolName === 'generate_image')?.itemId;
    const result = appendOrReplaceStep(marked, {
      stepId: 'asset_delivery', itemId: `asset-delivery:${event.runId || marked.runId}`, parentItemId, kind: 'execution', itemType: 'asset_delivery', phase: 'generating', status: complete && failed > 0 && succeeded === 0 ? 'failed' : complete ? 'completed' : 'active',
      label, commentary: label, toolName: 'generate_image', tool: 'generate_image', runId: event.runId || marked.runId, sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
    }, (step) => step.stepId === 'asset_delivery' && (!event.runId || step.runId === event.runId));
    const assets = clientOrigin
      ? {
          expected,
          settled,
          succeeded: Math.max(state.assets.succeeded, succeeded),
          failed: Math.max(state.assets.failed, failed),
        }
      : { expected, settled, succeeded, failed };
    return withOutcome({ ...marked, steps: result.steps, assets });
  }

  if (event.type === 'agent_completion_summary') {
    const marker = stamp(state, event);
    if (!marker) return state;
    const marked = withAttempt(state, event, marker, true);
    return withOutcome({ ...marked, agentDone: true, runEndedAt: marker.timestampMs });
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
    if (event.type === 'agent_error' && state.agentDone && ['completed', 'warning'].includes(state.outcome)) return state;
    const marked = withAttempt(state, event, marker, true);
    const cancelled = event.type === 'agent_cancelled';
    const label = cancelled ? '任务已终止' : '任务执行失败';
    const errorDetail = !cancelled && typeof event.message === 'string' ? event.message.trim().slice(0, 1200) : '';
    const retryability = !cancelled
      ? (event.retryable === true ? 'retryable' : event.retryable === false ? 'requires_change' : 'unknown')
      : undefined;
    const activeIndex = marked.steps.findLastIndex((step) => ['pending', 'active'].includes(step.status));
    const existingTerminalIndex = marked.steps.findLastIndex((step) => (
      step.runId === marked.runId
      && (step.itemType === 'error' || step.stepId === 'agent-error' || step.status === 'failed')
    ));
    const targetIndex = activeIndex >= 0 ? activeIndex : existingTerminalIndex;
    const steps = targetIndex >= 0 ? marked.steps.map((step, index) => index === targetIndex ? withItemMetadata({
      ...step,
      status: cancelled ? 'completed' : 'failed',
      phase: cancelled ? 'cancelled' : 'failed',
      commentary: label,
      label,
      ...(errorDetail ? { detail: errorDetail, completionSummary: errorDetail } : {}),
      ...(retryability ? { retryability } : {}),
      completedAt: marker.timestampMs,
      lastUpdateSequence: marker.sequence,
    }, marked.runId) : step) : [...marked.steps, withItemMetadata({
      stepId: cancelled ? 'agent-cancelled' : 'agent-error', kind: 'execution', phase: cancelled ? 'cancelled' : 'failed', status: cancelled ? 'completed' : 'failed', runId: marked.runId, operationId: marked.operationId,
      itemType: cancelled ? undefined : 'error',
      commentary: label, label, ...(errorDetail ? { detail: errorDetail, completionSummary: errorDetail } : {}), ...(retryability ? { retryability } : {}), sequence: marker.sequence, timestampMs: marker.timestampMs, lastUpdateSequence: marker.sequence,
    }, marked.runId)];
    return cancelled
      ? { ...marked, agentDone: true, terminalCancelled: true, runEndedAt: marker.timestampMs, outcome: 'cancelled', steps }
      : { ...marked, agentDone: true, terminalFailed: true, runEndedAt: marker.timestampMs, outcome: 'failed', steps };
  }

  return state;
}

export function shouldShowAgentRunProgress(state) {
  if (!state?.steps?.length) return false;
  if (state.timelineVersion === 2) {
    const hasToolOrInteraction = state.steps.some((step) => step.kind === 'tool' || step.kind === 'interaction' || step.itemType === 'tool_call' || step.itemType === 'approval' || step.itemType === 'clarification' || Boolean(step.toolName || step.tool));
    if (state.outcome === 'completed' && state.intent === 'chat' && !hasToolOrInteraction) return false;
    return true;
  }
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
  const frozenEnd = Number.isFinite(Number(progress?.runEndedAt)) ? Number(progress.runEndedAt) : null;
  return (progress?.attempts || []).reduce((total, attempt) => {
    const end = Number.isFinite(Number(attempt.endedAt)) ? Number(attempt.endedAt) : frozenEnd ?? now;
    return total + Math.max(0, end - Number(attempt.startedAt || end));
  }, 0);
}
