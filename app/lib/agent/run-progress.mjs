const ASSET_STEP_PATTERN = /(?:image|asset|render|generat)/i;

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
    steps: [{
      stepId: 'routing',
      phase: 'routing',
      status: 'active',
      label: '正在理解你的需求…',
    }],
    agentDone: false,
    assets: { expected: 0, settled: 0, succeeded: 0, failed: 0 },
    outcome: 'running',
  };
}

export function reduceAgentRunProgress(state, event) {
  if (!event || typeof event !== 'object') return state;

  if (event.type === 'progress_update') {
    const sequence = finiteCount(event.sequence);
    if (state && sequence <= state.lastSequence) return state;

    const base = state || {
      runId: typeof event.runId === 'string' ? event.runId : '',
      operationId: typeof event.operationId === 'string' ? event.operationId : '',
      intent: null,
      lastSequence: 0,
      steps: [],
      agentDone: false,
      assets: { expected: 0, settled: 0, succeeded: 0, failed: 0 },
      outcome: 'running',
    };
    const nextStep = {
      stepId: String(event.stepId || `step-${sequence}`),
      phase: String(event.phase || ''),
      status: ['active', 'waiting', 'completed', 'failed'].includes(event.status)
        ? event.status
        : 'active',
      label: String(event.label || ''),
      ...(typeof event.toolCallId === 'string' ? { toolCallId: event.toolCallId } : {}),
      ...(typeof event.toolName === 'string' ? { toolName: event.toolName } : {}),
    };
    const existingIndex = base.steps.findIndex((step) => (
      step.stepId === nextStep.stepId
      && (nextStep.toolCallId ? step.toolCallId === nextStep.toolCallId : !step.toolCallId)
    ));
    const steps = existingIndex === -1
      ? [...base.steps, nextStep]
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
      phase: 'generating',
      status: settled >= expected && expected > 0 ? 'completed' : 'active',
      label: settled >= expected && expected > 0
        ? `素材生成完成（${settled}/${expected}）`
        : `正在生成素材（${settled}/${expected || 0}）`,
      toolName: 'start_skill_job',
    };
    const existingIndex = state.steps.findIndex((step) => step.stepId === nextStep.stepId);
    const steps = existingIndex === -1
      ? [...state.steps, nextStep]
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
      steps: state.steps.map((step, index) => index === state.steps.length - 1
        ? { ...step, status: 'failed' }
        : step),
    };
  }

  return state;
}

export function shouldShowAgentRunProgress(state) {
  return Boolean(state?.steps?.length);
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
  return `${emoji} ${String(step?.label || '')}`.trim();
}
