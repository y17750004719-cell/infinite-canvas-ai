import { claimNativeConfirmation, loadNativeConfirmation, saveNativeConfirmation } from './native-business-ledger.mjs';

export async function loadConfirmation(input) { return loadNativeConfirmation(input); }
export async function saveConfirmation(input) { return saveNativeConfirmation(input); }
export async function claimConfirmation(input) { return claimNativeConfirmation(input); }

export function createConfirmationContinuationService(overrides = {}) {
  return {
    load: overrides.load || loadConfirmation,
    save: overrides.save || saveConfirmation,
    claim: overrides.claim || claimConfirmation,
  };
}

/**
 * Resolve request-scoped confirmation and skill-selection inputs before the
 * main agent starts. Persistence and skill loading are injected so this
 * boundary remains independent from the HTTP/runtime implementation.
 */
export async function resolveRequestInteraction({
  body,
  sessionId,
  runId,
  providers,
  skillManifests = [],
  interactionService,
  continuationState,
  claimContinuation,
  assertLockedImageSkill,
  activeClarificationState,
  skillSource = null,
  selectedSkill = null,
  skillSelectionMethod = 'none',
  skillCandidateIds = [],
  referenceContext,
  referenceImages = [],
  progressTracker,
  writeEvent,
  controller,
  contextLogger,
  latestUserMessage = '',
} = {}) {
  let approvedConfirmation = null;
  let nextSkillSource = skillSource;
  let nextSelectedSkill = selectedSkill;
  let nextSkillSelectionMethod = skillSelectionMethod;
  let nextSkillCandidateIds = skillCandidateIds;
  let activeSkillChange;
  let nextReferenceContext = referenceContext;
  let nextReferenceImages = referenceImages;

  const requestedConfirmationId = body?.confirmation?.confirmationId;
  if (requestedConfirmationId) {
    approvedConfirmation = continuationState?.getConfirmation?.(requestedConfirmationId) || null;
    if (!approvedConfirmation || approvedConfirmation.sessionId !== sessionId) {
      throw new Error('Confirmation is unavailable for this session');
    }
    claimContinuation?.({
      record: approvedConfirmation,
      requestedToolName: body.confirmation?.toolName,
      userMessage: latestUserMessage,
      providers,
    });
    await continuationState.claimStoredConfirmation({
      sessionId,
      confirmationId: requestedConfirmationId,
      runId,
      contract: approvedConfirmation.toolArgs,
    });
    nextSelectedSkill = approvedConfirmation.skillId
      ? skillManifests.find((skill) => skill.id === approvedConfirmation.skillId) || null
      : null;
    if (approvedConfirmation.skillId && !nextSelectedSkill) throw new Error('Confirmed Skill is unavailable');
    nextSkillSource = approvedConfirmation.skillSource;
    body.activeSkillId = nextSelectedSkill?.id;
    body.imageOptions = approvedConfirmation.imageOptions || body.imageOptions;
    nextReferenceContext = approvedConfirmation.referenceContext;
    nextReferenceImages = [...(approvedConfirmation.referenceImages || [])];
    if (approvedConfirmation.toolName === 'generate_image') {
      await assertLockedImageSkill?.(nextSelectedSkill, approvedConfirmation.skillContentHash);
    }
  }

  if (activeClarificationState?.operationId) {
    progressTracker?.resume({
      operationId: activeClarificationState.operationId,
      lastSequence: activeClarificationState.lastSequence,
    });
    nextSkillSource = activeClarificationState.skillSource ?? nextSkillSource;
  }

  const isSkillSelectionResponse = Boolean(
    body?.clarificationResponse
      && body?.clarificationRequest?.dimension === 'skill_selection'
      && activeClarificationState,
  );
  const skillSelection = interactionService.selectSkillFromInput({
    activeSkillId: body?.activeSkillId,
    clarificationRequest: isSkillSelectionResponse ? body.clarificationRequest : undefined,
    clarificationResponse: isSkillSelectionResponse ? body.clarificationResponse : undefined,
    state: activeClarificationState,
    skills: skillManifests,
    latestUserMessage: isSkillSelectionResponse ? '' : latestUserMessage,
  });
  if (skillSelection.error) throw new Error(skillSelection.error.code);
  nextSelectedSkill = skillSelection.selectedSkill || null;
  nextSkillSource = skillSelection.skillSource || null;
  nextSkillSelectionMethod = skillSelection.method || 'none';
  nextSkillCandidateIds = skillSelection.candidateIds || [];
  if (isSkillSelectionResponse && activeClarificationState) {
    if (nextSelectedSkill) {
      activeClarificationState.skillId = nextSelectedSkill.id;
      activeClarificationState.skillSource = nextSkillSource;
    } else {
      delete activeClarificationState.skillId;
      activeClarificationState.skillSource = null;
    }
  }
  if (nextSkillSelectionMethod === 'manual_text' || nextSkillSelectionMethod === 'user_choice') {
    activeSkillChange = nextSelectedSkill
      ? { id: nextSelectedSkill.id, label: nextSelectedSkill.name }
      : null;
  }
  if (activeSkillChange !== undefined) {
    writeEvent?.(controller, { type: 'active_skill_changed', skill: activeSkillChange });
  }
  void contextLogger?.info?.('skill.selection_input', 'Explicit Skill state prepared for Main Agent Loop', {
    method: nextSkillSelectionMethod,
    selectedSkillId: nextSelectedSkill?.id || null,
    candidateIds: nextSkillCandidateIds,
  });
  return {
    approvedConfirmation,
    activeClarificationState,
    selectedSkill: nextSelectedSkill,
    skillSource: nextSkillSource,
    skillSelectionMethod: nextSkillSelectionMethod,
    skillCandidateIds: nextSkillCandidateIds,
    activeSkillChange,
    referenceContext: nextReferenceContext,
    referenceImages: nextReferenceImages,
  };
}
