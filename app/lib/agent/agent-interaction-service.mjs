import { resolveExplicitSkillDirective } from './skill-registry.mjs';

/**
 * Request-scoped interaction helpers used by the Native tool dispatcher.
 *
 * This module deliberately contains no HTTP, SSE, or provider calls.  It
 * validates and resolves user-facing interactions (visual Skill selection,
 * confirmations and clarifications) and delegates persistence through the
 * injected callbacks supplied by the controller.
 */

export function validateVisualSkillSelection({ args, skills = [], selectedSkill = null, imageStarted = false } = {}) {
  const input = args && typeof args === 'object' ? args : {};
  if (input.confidence !== 'high') return { locked: false, reason: 'confidence_below_high' };
  if (selectedSkill || imageStarted) {
    return { isError: true, failureCode: 'skill_locked', failureStage: 'tool_dispatch', retryable: false };
  }
  const skill = (Array.isArray(skills) ? skills : []).find((candidate) => (
    candidate?.id === input.skillId && candidate.executionMode === 'image_pipeline'
  ));
  if (!skill) return { isError: true, failureCode: 'unknown_visual_skill', failureStage: 'tool_dispatch', retryable: false };
  return { locked: true, skill };
}

export function validateConfirmation({ approved, toolName, args } = {}) {
  if (!approved) return { ok: true };
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
    return value;
  };
  if (approved.toolName !== toolName || JSON.stringify(stable(approved.toolArgs || {})) !== JSON.stringify(stable(args || {}))) {
    return {
      ok: false,
      error: {
        code: 'approval_contract_changed',
        failureStage: 'tool_dispatch',
        retryable: false,
        toolName,
      },
    };
  }
  return { ok: true };
}

export function resolveClarification({ state, response, userMessage } = {}) {
  const next = state && typeof state === 'object' ? structuredClone(state) : {};
  if (response && typeof response === 'object') {
    const text = typeof response.customText === 'string' ? response.customText.trim() : '';
    if (text) next.workingBrief = text;
    if (response.proceedWithCurrent === true) next.proceedWithCurrent = true;
    if (response.selectedOptionId) next.selectedOptionId = String(response.selectedOptionId);
  }
  if (!next.workingBrief && typeof userMessage === 'string' && userMessage.trim()) next.workingBrief = userMessage.trim();
  return next;
}

/** Resolve a user-facing clarification without allowing an option outside the
 * pending request to mutate durable state. */
export function validateClarificationResponse({ request, response, state } = {}) {
  const input = response && typeof response === 'object' ? response : {};
  const options = Array.isArray(request?.options) ? request.options : [];
  const selectedOptionId = typeof input.selectedOptionId === 'string' ? input.selectedOptionId.trim() : '';
  if (selectedOptionId && options.length && !options.some((option) => option?.id === selectedOptionId)) {
    return { ok: false, error: { code: 'clarification_option_invalid', failureStage: 'interaction', retryable: false } };
  }
  if (input.proceedWithCurrent === true && request?.allowProceed === false) {
    return { ok: false, error: { code: 'clarification_proceed_not_allowed', failureStage: 'interaction', retryable: false } };
  }
  if (typeof input.customText === 'string' && input.customText.length > 4000) {
    return { ok: false, error: { code: 'clarification_text_too_long', failureStage: 'interaction', retryable: false } };
  }
  return { ok: true, state: resolveClarification({ state, response: input }) };
}

export function resolveContextSelection({ candidates = [], selectedId, context = {} } = {}) {
  const id = typeof selectedId === 'string' ? selectedId.trim() : '';
  const candidate = (Array.isArray(candidates) ? candidates : []).find((item) => item?.id === id);
  if (!candidate) return { ok: false, error: { code: 'context_selection_invalid', failureStage: 'interaction', retryable: false } };
  return { ok: true, selected: candidate, context: { ...context, selectedContextId: candidate.id } };
}

export function resolveRecoveryContinuation({ record, decision, mode, revision } = {}) {
  if (!record || typeof record !== 'object') return { ok: false, error: { code: 'recovery_not_found', failureStage: 'recovery', retryable: false } };
  if (decision === 'continue_current_request') return { ok: true, decision, recoveryBaseRecord: null };
  if (decision !== 'resume') return { ok: false, error: { code: 'recovery_decision_invalid', failureStage: 'recovery', retryable: false } };
  if (mode && !['fill_missing', 'redo_all'].includes(mode)) return { ok: false, error: { code: 'recovery_mode_invalid', failureStage: 'recovery', retryable: false } };
  return {
    ok: true,
    decision,
    mode: mode || null,
    revision: typeof revision === 'string' ? revision.trim().slice(0, 4000) : '',
    recoveryBaseRecord: record,
    taskId: record.taskId || null,
    skillId: record.skillId || null,
    route: record.resumeRoute || 'main_agent',
  };
}

export function selectSkillFromInput({ activeSkillId, clarificationRequest, clarificationResponse, state, skills = [], explicitSkill, latestUserMessage } = {}) {
  const manifests = Array.isArray(skills) ? skills : [];
  const resolvedExplicitSkill = explicitSkill === undefined
    ? resolveExplicitSkillDirective(String(latestUserMessage || ''), manifests)
    : explicitSkill;
  if (resolvedExplicitSkill?.type === 'clear') return { selectedSkill: null, skillSource: null, method: 'manual_text', candidateIds: [] };
  if (resolvedExplicitSkill?.type === 'select') {
    const selectedSkill = manifests.find((item) => item?.id === resolvedExplicitSkill.id || item?.id === resolvedExplicitSkill.manifest?.id);
    if (!selectedSkill) return { error: { code: 'skill_unavailable', failureStage: 'interaction', retryable: false } };
    return { selectedSkill, skillSource: 'explicit_text', method: 'manual_text', candidateIds: [selectedSkill.id] };
  }
  if (clarificationRequest?.dimension === 'skill_selection' && clarificationResponse) {
    const id = String(clarificationResponse.selectedOptionId || '').trim();
    const permitted = new Set((clarificationRequest.options || []).map((option) => option?.id).filter(Boolean));
    if (!permitted.has(id)) return { error: { code: 'skill_selection_invalid', failureStage: 'interaction', retryable: false } };
    if (id === 'no_skill') return { selectedSkill: null, skillSource: null, method: 'user_choice', candidateIds: [...permitted].filter((value) => value !== 'no_skill') };
    const selectedSkill = manifests.find((item) => item?.id === id);
    if (!selectedSkill) return { error: { code: 'skill_unavailable', failureStage: 'interaction', retryable: false } };
    return { selectedSkill, skillSource: 'user_confirmation', method: 'user_choice', candidateIds: [...permitted].filter((value) => value !== 'no_skill') };
  }
  const selectedSkill = manifests.find((item) => item?.id === activeSkillId) || manifests.find((item) => item?.id === state?.skillId) || null;
  return { selectedSkill, skillSource: selectedSkill ? (state?.skillSource || 'manual_ui') : null, method: selectedSkill ? 'manual_ui' : 'none', candidateIds: selectedSkill ? [selectedSkill.id] : [] };
}

/**
 * Resolve request-level confirmation and Skill input before Native execution.
 * All persistence and side effects are injected by the request runtime.
 * @param {any} options
 * @returns {Promise<any>}
 */
export async function prepareAgentInteraction(options = {}) {
  const {
    body = {}, latestUserMessage = '', activeClarificationState, skillManifests = [],
    getConfirmation, claimConfirmation, claimStoredConfirmation,
    assertLockedImageSkill, providers, sessionId, runId, progressTracker,
  } = options;
  let approvedConfirmation = null;
  let selectedSkill = null;
  let skillSource = null;
  let skillSelectionMethod = 'none';
  let skillCandidateIds = [];
  let activeSkillChange;
  let runReferenceContext = options.runReferenceContext;
  let executionReferenceImages = options.executionReferenceImages || [];
  const explicitSkillRequested = body.skillSelectionSource === 'manual_ui'
    || body.skillSelectionSource === 'explicit_text'
    || body.activeSkillExplicit === true;
  if (explicitSkillRequested && !String(body.activeSkillId || '').trim()) {
    const error = Object.assign(new Error('Explicit Skill selection is missing; choose the Skill again'), {
      code: 'skill_lock_failed',
      failureStage: 'skill_selection',
      retryable: false,
    });
    throw error;
  }
  if (body.confirmation?.confirmationId) {
    approvedConfirmation = await getConfirmation?.(body.confirmation.confirmationId) || null;
    if (!approvedConfirmation || approvedConfirmation.sessionId !== sessionId) throw new Error('Confirmation is unavailable for this session');
    await claimConfirmation?.({ record: approvedConfirmation, requestedToolName: body.confirmation.toolName, userMessage: latestUserMessage, providers });
    await claimStoredConfirmation?.({ sessionId, confirmationId: body.confirmation.confirmationId, runId, contract: approvedConfirmation.toolArgs });
    selectedSkill = approvedConfirmation.skillId
      ? skillManifests.find((skill) => skill.id === approvedConfirmation.skillId) || null
      : null;
    if (approvedConfirmation.skillId && !selectedSkill) throw new Error('Confirmed Skill is unavailable');
    skillSource = approvedConfirmation.skillSource;
    body.activeSkillId = selectedSkill?.id;
    body.imageOptions = approvedConfirmation.imageOptions || body.imageOptions;
    runReferenceContext = approvedConfirmation.referenceContext;
    executionReferenceImages = [...(approvedConfirmation.referenceImages || [])];
    if (approvedConfirmation.toolName === 'generate_image') await assertLockedImageSkill?.(selectedSkill, approvedConfirmation.skillContentHash);
  }
  if (activeClarificationState?.operationId) {
    progressTracker?.resume?.({ operationId: activeClarificationState.operationId, lastSequence: activeClarificationState.lastSequence });
    skillSource = activeClarificationState.skillSource ?? skillSource;
  }
  const isSkillSelectionResponse = Boolean(
    body.clarificationResponse && body.clarificationRequest?.dimension === 'skill_selection' && activeClarificationState,
  );
  const skillSelection = selectSkillFromInput({
    activeSkillId: body.activeSkillId,
    clarificationRequest: isSkillSelectionResponse ? body.clarificationRequest : undefined,
    clarificationResponse: isSkillSelectionResponse ? body.clarificationResponse : undefined,
    state: activeClarificationState,
    skills: skillManifests,
    latestUserMessage: isSkillSelectionResponse ? '' : latestUserMessage,
    explicitSkill: explicitSkillRequested
      ? { type: 'select', id: String(body.activeSkillId).trim() }
      : undefined,
  });
  if (skillSelection.error) {
    throw Object.assign(new Error(skillSelection.error.code), skillSelection.error);
  }
  if (explicitSkillRequested && !skillSelection.selectedSkill) {
    throw Object.assign(new Error('Explicit Skill could not be locked'), {
      code: 'skill_lock_failed', failureStage: 'skill_selection', retryable: false,
    });
  }
  selectedSkill = skillSelection.selectedSkill || null;
  skillSource = skillSelection.skillSource;
  skillSelectionMethod = skillSelection.method;
  skillCandidateIds = skillSelection.candidateIds || [];
  if (isSkillSelectionResponse && activeClarificationState) {
    if (selectedSkill) {
      activeClarificationState.skillId = selectedSkill.id;
      activeClarificationState.skillSource = skillSource;
    } else {
      delete activeClarificationState.skillId;
      activeClarificationState.skillSource = null;
    }
  }
  if (skillSelectionMethod === 'manual_text' || skillSelectionMethod === 'user_choice') {
    activeSkillChange = selectedSkill ? { id: selectedSkill.id, label: selectedSkill.name } : null;
  }
  return {
    approvedConfirmation, selectedSkill, skillSource, skillSelectionMethod, skillCandidateIds,
    activeSkillChange, runReferenceContext, executionReferenceImages,
  };
}

export function createInteractionService({ loadSkillContent, emitEvent, logger, persistState, loadState, persistConfirmation, claimConfirmation, requestUserDecision, requestContextSelection, resolveFailedTaskRecovery, requestMainAgentContext, rewindAgentAnalysis } = {}) {
  const delegate = (handler) => async ({ args, context } = {}) => {
    if (typeof handler !== 'function') return { isError: true, modelResult: { code: 'interaction_unavailable', failureStage: 'interaction', retryable: false } };
    return handler(args, context);
  };
  return {
    async loadSkill(skillId, options = {}) {
      if (typeof loadSkillContent !== 'function') throw new Error('skill_loader_unavailable');
      const content = await loadSkillContent(skillId, options);
      if (!String(content || '').trim()) throw new Error('skill_empty');
      return { content: String(content), contentHash: await hashText(content) };
    },
    async assertLockedSkill(skill, expectedHash = null) {
      if (!skill) return { content: '', contentHash: '' };
      if (skill.executionMode !== 'image_pipeline' || !skill.allowedTools?.includes('generate_image')) {
        throw new Error('The locked Skill is not allowed to generate images');
      }
      const loaded = await this.loadSkill(skill.id);
      if (expectedHash && expectedHash !== loaded.contentHash) {
        throw new Error('The locked Skill content changed after this task was created');
      }
      return loaded;
    },
  async selectVisualSkill({ args, skills, selectedSkill, imageStarted, context = {} } = {}) {
    const result = validateVisualSkillSelection({ args, skills, selectedSkill, imageStarted });
    if (!result.locked) return result;
    if (typeof loadSkillContent !== 'function') {
        return { isError: true, failureCode: 'skill_lock_failed', failureStage: 'interaction', retryable: false, reason: 'skill_loader_unavailable' };
    }
    let content;
    try {
      content = await loadSkillContent(result.skill.id);
    } catch (error) {
      return {
        isError: true,
        failureCode: 'skill_lock_failed',
        failureStage: 'interaction',
        retryable: false,
        skillId: result.skill.id,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (!String(content || '').trim()) {
        return { isError: true, failureCode: 'skill_lock_failed', failureStage: 'interaction', retryable: false, reason: 'skill_empty', skillId: result.skill.id };
    }
      const contentHash = await hashText(content);
      emitEvent?.({ type: 'skill_selected', skillId: result.skill.id, label: result.skill.name, source: 'auto', ...context });
      await logger?.info?.('skill.loaded', 'Visual Skill selected by Native Agent', { skillId: result.skill.id, contentHash, ...context });
      return { modelResult: { skillId: result.skill.id, content, contentHash, truncated: false }, skill: result.skill, content, contentHash };
    },
    resolveClarification,
    validateClarificationResponse,
    resolveContextSelection,
    resolveRecoveryContinuation,
    selectSkillFromInput,
    prepareAgentInteraction,
    request_user_decision: delegate(requestUserDecision),
    request_context_selection: delegate(requestContextSelection),
    resolve_failed_task_recovery: delegate(resolveFailedTaskRecovery),
    request_main_agent_context: delegate(requestMainAgentContext),
    rewind_agent_analysis: delegate(rewindAgentAnalysis),
    validateConfirmation,
    async saveState(key, state) {
      if (typeof persistState === 'function') return persistState(key, state);
      return state;
    },
    async loadState(key) {
      return typeof loadState === 'function' ? loadState(key) : null;
    },
    async saveConfirmation(record) {
      if (typeof persistConfirmation === 'function') return persistConfirmation(record);
      return record;
    },
    async claimConfirmation(record, context) {
      if (typeof claimConfirmation === 'function') return claimConfirmation(record, context);
      return record;
    },
  };
}

async function hashText(value) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(String(value)).digest('hex');
}
