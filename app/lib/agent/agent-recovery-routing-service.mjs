import { createExecutionRecoveryRecord } from './agent-recovery-service.mjs';
import { isSessionVisualAssetAvailable, materializeSessionVisualAsset } from './session-visual-assets.mjs';
import { resolveExecutableVisualReferences } from './executable-visual-references.mjs';

export const buildRecoveryRecord = createExecutionRecoveryRecord;

/**
 * Rebuild the bounded conversation prefix used when a failed task is resumed.
 * Keeping this in the recovery boundary prevents request orchestration from
 * deciding which user message is authoritative.
 */
/** @param {any} options @returns {any[]} */
export function cropRecoveryMessages({ messages = [], record } = {}) {
  const sourceIndex = messages.findIndex((message) => message?.id === record?.sourceUserMessageId);
  const fallbackIndex = messages.findIndex((message) => (
    message?.role === 'user'
      && typeof message.content === 'string'
      && message.content.trim().slice(0, 4000) === record?.originalRequest
  ));
  const endIndex = sourceIndex >= 0 ? sourceIndex : fallbackIndex;
  const history = endIndex >= 0 ? messages.slice(0, endIndex + 1) : [];
  if (history.at(-1)?.role === 'user' && history.at(-1)?.content?.trim() === record?.originalRequest) return history;
  return [...history, {
    id: record?.sourceUserMessageId,
    role: 'user',
    content: record?.originalRequest,
  }];
}

/** Materialize a reference only when an existing session asset is unavailable. */
/** @param {any} options @returns {Promise<any>} */
export async function materializeRecoveryReference({ input, sessionId, isAvailable = isSessionVisualAssetAvailable, materialize = materializeSessionVisualAsset } = {}) {
  const sessionAsset = input?.existingAsset;
  if (sessionAsset && await isAvailable(sessionAsset)) return sessionAsset;
  return materialize({
    sessionId: input?.sessionId || sessionId,
    existingAsset: sessionAsset,
    source: {
      src: input?.source,
      originalSrc: input?.originalSrc,
      source: input?.sourceKind || 'upload',
      sourceReferenceId: input?.sourceReferenceId,
      taskId: input?.taskId,
      versionId: input?.versionId,
    },
  });
}

/** Resolve and materialize the visual references selected by a recovery turn. */
/** @param {any} options @returns {Promise<any>} */
export function resolveRecoveryReferences({ ids = [], runtimeReferenceById, referenceContext, contextEntityById, sessionVisualAssets = [], generatedImageHistory = [], sessionId, materialize = materializeRecoveryReference } = {}) {
  const availableIds = [...(runtimeReferenceById?.keys?.() || [])];
  const normalizeReferenceId = (id) => {
    if (runtimeReferenceById?.has(id)) return id;
    const suffix = `:${id}`;
    return availableIds.find((candidate) => String(candidate).endsWith(suffix)) || id;
  };
  return resolveExecutableVisualReferences({
    referenceIds: ids.map(normalizeReferenceId),
    runtimeReferenceById,
    referenceContext,
    contextEntityById,
    sessionVisualAssets,
    generatedImageHistory,
    sessionId,
    materialize: (input) => materialize({ input, sessionId }),
  });
}

/**
 * Build the Main Agent's recovery interaction callback. State is deliberately
 * supplied through getters/setters so this service does not own request state
 * or persistence and can be reused by continuation and native execution.
 * @param {any} deps
 * @returns {(args: Record<string, unknown>) => Promise<any>}
 */
export function createRecoveryTaskHandler(deps = {}) {
  return async (args = {}) => {
    const recoveryRecord = deps.getRecoveryRecord?.() || deps.recoveryRecord;
    if (!deps.recoveryCandidateForAgent || !recoveryRecord) throw new Error('当前没有可恢复的失败任务');
    const action = String(args.action || '');
    if (action === 'inspect') {
      deps.setRecoveryDecision?.('inspect');
      return {
        modelResult: {
          taskId: recoveryRecord.taskId,
          failureStage: recoveryRecord.failure.stage,
          failureMessage: recoveryRecord.failure.message,
          originalRequest: recoveryRecord.originalRequest,
        },
        publicResult: { inspected: true },
      };
    }
    if (action === 'continue_current_request') {
      deps.setRecoveryDecision?.('continue_current_request');
      return { modelResult: { accepted: true, recovery: 'ignored' }, publicResult: { accepted: true } };
    }
    if (action !== 'resume') throw new Error('失败任务操作无效');
    deps.setRecoveryDecision?.('resume');
    const skillId = recoveryRecord.skillId || null;
    if (skillId && !new Set((deps.skillManifests || []).map((manifest) => manifest.id)).has(skillId)) {
      throw new Error(`恢复任务使用的 Skill 已不可用：${skillId}`);
    }
    deps.setRecoveryBaseRecord?.(recoveryRecord);
    deps.setRecoveryTaskIdForExecution?.(recoveryRecord.taskId);
    deps.setRecoveryRevisionMessage?.(typeof args.revision === 'string' ? args.revision.trim().slice(0, 4000) : '');
    deps.setImageOperation?.(recoveryRecord.imageOperation || deps.getImageOperation?.());
    deps.setTargetReferenceId?.(recoveryRecord.targetReferenceId || deps.getTargetReferenceId?.());
    if (skillId) {
      const selectedSkill = (deps.skillManifests || []).find((manifest) => manifest.id === skillId) || null;
      if (!selectedSkill) throw new Error('Recovery Skill is no longer enabled');
      deps.setSelectedSkill?.(selectedSkill);
      deps.setSkillSource?.('recovery');
      deps.setSkillSelectionMethod?.('none');
      deps.setSkillCandidateIds?.([selectedSkill.id]);
      await deps.ensureSelectedSkillContent?.();
    }
    if (recoveryRecord.intent === 'image' || recoveryRecord.imageOperation) deps.setIntent?.('image');
    deps.setMainAgentInputMessages?.(cropRecoveryMessages({ messages: deps.messages || [], record: recoveryRecord }));
    const revisionMessage = typeof args.revision === 'string' ? args.revision.trim().slice(0, 4000) : '';
    if (revisionMessage) deps.appendMainAgentInputMessage?.({ id: `revision-${deps.runId}`, role: 'user', content: revisionMessage });
    if (recoveryRecord.referenceContext) {
      const referenceContext = structuredClone(recoveryRecord.referenceContext);
      deps.setMainAgentReferenceContext?.(referenceContext);
      deps.setMainAgentReferenceImages?.((referenceContext.references || []).map((reference) => reference.src));
      deps.setRunReferenceContext?.(referenceContext);
      deps.runtimeReferenceById?.clear?.();
      for (const reference of referenceContext.references || []) deps.runtimeReferenceById?.set?.(reference.id, reference);
    }
    void deps.contextLogger?.info?.('task.recovery_decision', 'Main Agent selected recovery for the supplied failed task', {
      taskId: recoveryRecord.taskId,
      runId: deps.runId,
      decision: 'resume',
      candidateCount: 1,
    });
    return {
      modelResult: { accepted: true, recovery: 'resumed', taskId: recoveryRecord.taskId },
      publicResult: { accepted: true, taskId: recoveryRecord.taskId },
    };
  };
}
