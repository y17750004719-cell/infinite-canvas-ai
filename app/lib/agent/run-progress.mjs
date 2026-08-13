const ASSET_STEP_PATTERN = /(?:image|asset|render|generat)/i;
const MAX_ACTIVITY_STEPS = 24;
const MAX_ACTIVITY_COMMENTARY_LENGTH = 1200;

const TOOL_LABELS = {
  get_conversation_memory: '读取对话记忆',
  list_project_context: '查看项目上下文',
  read_context_entity: '读取上下文实体',
  load_visual_reference: '加载视觉参考',
  update_conversation_memory: '更新对话记忆',
  resolve_failed_task_recovery: '定位上次任务',
  handoff_to_image_planner: '交给 Image Planner',
  request_context_selection: '等待选择引用',
  generate_image: '生成图片',
  start_skill_job: '启动 Skill 任务',
};

const PHASE_EMOJI_RULES = [
  [/(?:waiting|confirm|approval|input)/i, '📌'],
  [/(?:render)/i, '🚀'],
  [/(?:optimi|style|compose_visual)/i, '🎨'],
  [/(?:image|asset|generat)/i, '🖼'],
  [/(?:load|skill)/i, '📚'],
  [/(?:analy|inspect|read|search)/i, '🔎'],
  [/(?:plan|compos|orchestrat)/i, '🧩'],
  [/(?:execut|tool|run)/i, '⚙️'],
  [/(?:respond|writ|summar)/i, '✍️'],
  [/(?:resolv|context)/i, '🔗'],
  [/(?:rout|understand|intent)/i, '🧠'],
];

function finiteCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function finiteTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

function createBaseState(event = {}) {
  return {
    runId: typeof event.runId === 'string' ? event.runId : '',
    operationId: typeof event.operationId === 'string' ? event.operationId : '',
    intent: null,
    lastSequence: 0,
    steps: [],
    agentDone: false,
    assets: { expected: 0, settled: 0, succeeded: 0, failed: 0 },
    outcome: 'running',
  };
}

function boundedCommentary(value) {
  return String(value || '').slice(0, MAX_ACTIVITY_COMMENTARY_LENGTH);
}

function boundedSteps(steps) {
  if (steps.length <= MAX_ACTIVITY_STEPS) return steps;
  return [
    steps[0],
    {
      stepId: 'activity:truncated',
      kind: 'status',
      phase: 'truncated',
      status: 'completed',
      commentary: '较早的活动记录已省略',
      label: '较早的活动记录已省略',
    },
    ...steps.slice(-(MAX_ACTIVITY_STEPS - 2)),
  ];
}

function isImageGenerationStep(step) {
  return step?.toolName === 'generate_image' || step?.stepId === 'generate_image';
}

function needsAssetSettlement(steps) {
  return steps.some((step) => (
    step.toolName === 'generate_image'
    || ASSET_STEP_PATTERN.test(step.stepId)
    || ASSET_STEP_PATTERN.test(step.phase)
  ));
}

function deriveOutcome(state) {
  if (state.steps.some((step) => step.status === 'failed')) return 'failed';
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

/**
 * @param {string} runId
 * @returns {import('./run-progress.types').AgentRunProgress}
 */
export function createInitialAgentRunProgress(runId) {
  const normalizedRunId = typeof runId === 'string' ? runId : '';
  return {
    runId: normalizedRunId,
    operationId: normalizedRunId,
    intent: null,
    lastSequence: 0,
    steps: [],
    agentDone: false,
    assets: { expected: 0, settled: 0, succeeded: 0, failed: 0 },
    outcome: 'running',
  };
}

export function reduceAgentRunProgress(state, event) {
  if (!event || typeof event !== 'object') return state;

  if (event.type === 'agent_activity_delta') {
    if (!event.activityId || !event.delta) return state || createBaseState(event);
    const base = state || createBaseState(event);
    const activityId = String(event.activityId);
    const existingIndex = base.steps.findIndex((step) => step.activityId === activityId);
    const existing = existingIndex >= 0 ? base.steps[existingIndex] : null;
    const commentary = boundedCommentary(`${existing?.commentary || ''}${event.delta}`);
    const nextStep = {
      stepId: `activity:${activityId}`,
      activityId,
      kind: 'commentary',
      phase: 'commentary',
      status: 'active',
      commentary,
      label: commentary,
    };
    const steps = existingIndex === -1
      ? boundedSteps([...base.steps, nextStep])
      : base.steps.map((step, index) => index === existingIndex ? { ...step, ...nextStep } : step);
    return withOutcome({ ...base, steps });
  }

  if (event.type === 'agent_activity_commit') {
    if (!state || !event.activityId) return state || null;
    const activityId = String(event.activityId);
    if (event.disposition === 'final') {
      return withOutcome({
        ...state,
        steps: state.steps.filter((step) => step.activityId !== activityId),
      });
    }
    if (event.disposition !== 'commentary') return state;
    return withOutcome({
      ...state,
      steps: state.steps.map((step) => step.activityId === activityId
        ? { ...step, status: 'completed' }
        : step),
    });
  }

  if (event.type === 'progress_update') {
    const sequence = finiteCount(event.sequence);
    if (state && sequence <= state.lastSequence) return state;

    const base = state || createBaseState(event);
    const toolName = typeof event.toolName === 'string' ? event.toolName : undefined;
    const nextStep = {
      stepId: String(event.stepId || `step-${sequence}`),
      kind: toolName ? 'tool' : 'status',
      phase: String(event.phase || ''),
      status: ['active', 'waiting', 'completed', 'failed'].includes(event.status)
        ? event.status
        : 'active',
      commentary: boundedCommentary(event.label),
      label: boundedCommentary(event.label),
      ...(typeof event.toolCallId === 'string' ? { toolCallId: event.toolCallId } : {}),
      ...(toolName ? { tool: toolName, toolName } : {}),
    };
    const existingIndex = base.steps.findIndex((step) => (
      step.stepId === nextStep.stepId
      && (nextStep.toolCallId ? step.toolCallId === nextStep.toolCallId : !step.toolCallId)
    ));
    const existingStep = existingIndex >= 0 ? base.steps[existingIndex] : null;
    if (isImageGenerationStep(nextStep)) {
      const timestampMs = finiteTimestamp(event.timestampMs);
      if (nextStep.status === 'active') {
        nextStep.startedAt = existingStep?.status === 'active' && existingStep.startedAt
          ? existingStep.startedAt
          : timestampMs;
        nextStep.completedAt = undefined;
      } else if (nextStep.status === 'completed' || nextStep.status === 'failed') {
        nextStep.startedAt = existingStep?.startedAt || timestampMs;
        nextStep.completedAt = existingStep?.completedAt || timestampMs;
      }
    }
    const steps = existingIndex === -1
      ? boundedSteps([...base.steps, nextStep])
      : base.steps.map((step, index) => index === existingIndex ? { ...step, ...nextStep } : step);
    return withOutcome({
      ...base,
      runId: typeof event.runId === 'string' ? event.runId : base.runId,
      operationId: typeof event.operationId === 'string' ? event.operationId : base.operationId,
      lastSequence: sequence,
      steps,
    });
  }

  if (!state) return null;

  if (event.type === 'intent_resolved') {
    const intent = ['chat', 'image', 'skill_action'].includes(event.intent)
      ? event.intent
      : state.intent;
    return intent === state.intent ? state : { ...state, intent };
  }

  if (event.type === 'confirmation_submitted') {
    const targetIndex = state.steps.findLastIndex((step) => (
      step.status === 'waiting'
      && (!event.toolName || step.toolName === event.toolName || step.stepId === event.toolName)
    ));
    if (targetIndex < 0) return state;
    return withOutcome({
      ...state,
      steps: state.steps.map((step, index) => index === targetIndex
        ? { ...step, phase: 'confirming', commentary: '正在确认并启动任务', label: '正在确认并启动任务' }
        : step),
    });
  }

  if (event.type === 'assets_pending') {
    const expected = finiteCount(event.count);
    return withOutcome({
      ...state,
      assets: { expected, settled: 0, succeeded: 0, failed: 0 },
    });
  }

  if (event.type === 'assets_progress') {
    const expected = finiteCount(event.total);
    const succeeded = finiteCount(event.succeeded);
    const failed = finiteCount(event.failed);
    const settled = succeeded + failed;
    const nextStep = {
      stepId: 'skill_job_assets',
      kind: 'tool',
      phase: 'generating',
      status: settled >= expected && expected > 0 ? 'completed' : 'active',
      label: settled >= expected && expected > 0
        ? `素材生成完成（${settled}/${expected}）`
        : `正在生成素材（${settled}/${expected || 0}）`,
      toolName: 'start_skill_job',
      tool: 'start_skill_job',
    };
    const existingIndex = state.steps.findIndex((step) => step.stepId === nextStep.stepId);
    const steps = existingIndex === -1
      ? boundedSteps([...state.steps, nextStep])
      : state.steps.map((step, index) => index === existingIndex ? { ...step, ...nextStep } : step);
    return withOutcome({
      ...state,
      steps,
      assets: { expected, settled, succeeded, failed },
    });
  }

  if (event.type === 'assets_settled') {
    const succeeded = finiteCount(event.succeeded);
    const failed = finiteCount(event.failed);
    const settled = succeeded + failed;
    return withOutcome({
      ...state,
      steps: state.steps.map((step) => step.stepId === 'skill_job_assets'
        ? {
            ...step,
            status: failed > 0 && succeeded === 0 ? 'failed' : 'completed',
            commentary: failed > 0
              ? `素材生成结束（成功 ${succeeded}，失败 ${failed}）`
              : `素材生成完成（${settled}/${Math.max(state.assets.expected, settled)}）`,
            label: failed > 0
              ? `素材生成结束（成功 ${succeeded}，失败 ${failed}）`
              : `素材生成完成（${settled}/${Math.max(state.assets.expected, settled)}）`,
          }
        : step),
      assets: {
        expected: Math.max(state.assets.expected, settled),
        settled,
        succeeded,
        failed,
      },
    });
  }

  if (event.type === 'agent_done') {
    return withOutcome({ ...state, agentDone: true });
  }

  if (event.type === 'agent_error') {
    return {
      ...state,
      agentDone: true,
      outcome: 'failed',
      steps: state.steps.length > 0
        ? state.steps.map((step, index) => index === state.steps.length - 1
          ? { ...step, status: 'failed' }
          : step)
        : [{
            stepId: 'agent-error',
            kind: 'status',
            phase: 'failed',
            status: 'failed',
            commentary: '任务执行失败',
            label: '任务执行失败',
          }],
    };
  }

  if (event.type === 'agent_cancelled') {
    const steps = state.steps.length > 0
      ? state.steps.map((step, index) => index === state.steps.length - 1
        ? { ...step, status: 'completed', phase: 'cancelled', commentary: '任务已终止', label: '任务已终止' }
        : step)
      : [{
          stepId: 'agent-cancelled',
          kind: 'status',
          phase: 'cancelled',
          status: 'completed',
          commentary: '任务已终止',
          label: '任务已终止',
        }];
    return { ...state, agentDone: true, outcome: 'cancelled', steps };
  }

  return state;
}

export function shouldShowAgentRunProgress(state) {
  if (!state?.steps?.length) return false;
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
    return {
      router: { intent, pending: [] },
      events: current.pending,
    };
  }
  if (event?.type !== 'progress_update') return { router: current, events: [event] };
  if (current.intent === 'chat' || current.intent === 'image' || current.intent === 'skill_action') {
    return { router: current, events: [event] };
  }
  return {
    router: { ...current, pending: [...current.pending, event] },
    events: [],
  };
}

export function formatAgentProgressLabel(step) {
  const phase = String(step?.phase || '');
  const stepId = String(step?.stepId || '');
  const emoji = PHASE_EMOJI_RULES.find(([pattern]) => pattern.test(phase))?.[1]
    || PHASE_EMOJI_RULES.find(([pattern]) => pattern.test(stepId))?.[1]
    || '⚙️';
  const toolName = typeof step?.tool === 'string'
    ? step.tool
    : step?.tool?.name || step?.toolName || '';
  const friendlyTool = TOOL_LABELS[toolName] || String(step?.tool?.label || toolName).replaceAll('_', ' ');
  const commentary = String(step?.commentary || step?.label || '').trim();
  const label = commentary && commentary !== toolName
    ? commentary
    : friendlyTool
      ? step?.status === 'completed'
        ? `${friendlyTool}已完成`
        : step?.status === 'failed'
          ? `${friendlyTool}失败`
          : step?.status === 'waiting'
            ? `等待${friendlyTool}`
            : `正在${friendlyTool}`
      : '';
  return `${emoji} ${label}`.trim();
}

export function getAgentProgressElapsedMs(step, now = Date.now()) {
  if (!isImageGenerationStep(step) || !Number.isFinite(Number(step?.startedAt))) return null;
  const end = Number.isFinite(Number(step?.completedAt))
    ? Number(step.completedAt)
    : step?.status === 'active'
      ? Number(now)
      : null;
  return Number.isFinite(end) ? Math.max(0, end - Number(step.startedAt)) : null;
}
