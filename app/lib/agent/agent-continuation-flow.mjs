import { enrichGeneratedAssetDeliveryAction } from './generated-asset-delivery.mjs';

/**
 * Request-level continuation routing.
 *
 * This is intentionally free of HTTP, Native runtime, journal and provider
 * dependencies.  Interaction validation remains in agent-interaction-service;
 * this flow only combines the request continuation inputs into a stable
 * decision that the request runtime can execute.
 */
export function createAgentContinuationFlow({ interactionService } = {}) {
  const resolveRecovery = ({ record, requestedTaskId, clarificationRequest, clarificationResponse } = {}) => {
    if (!record) return { ok: true, resolution: null, mode: null };

    const hasScopeResponse = clarificationRequest?.dimension === 'recovery_scope' && clarificationResponse;
    if (hasScopeResponse) {
      const mode = clarificationResponse.selectedOptionId;
      const result = interactionService?.resolveRecoveryContinuation
        ? interactionService.resolveRecoveryContinuation({ record, decision: 'resume', mode })
        : { ok: true, decision: 'resume', mode, recoveryBaseRecord: record, route: record.resumeRoute || 'main_agent', skillId: record.skillId || null };
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        mode: result.mode,
        resolution: {
          decision: result.decision,
          route: result.route || record.resumeRoute,
          skillId: result.skillId || record.skillId || null,
          confidence: 'high',
        },
      };
    }

    if (requestedTaskId) {
      if (!record.resumeRoute) return { ok: true, resolution: null, mode: null };
      const result = interactionService?.resolveRecoveryContinuation
        ? interactionService.resolveRecoveryContinuation({ record, decision: 'resume' })
        : { ok: true, decision: 'resume', recoveryBaseRecord: record, route: record.resumeRoute, skillId: record.skillId || null };
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        mode: result.mode || null,
        resolution: {
          decision: result.decision,
          route: result.route || record.resumeRoute,
          skillId: result.skillId || record.skillId || null,
        },
      };
    }

    return { ok: true, resolution: null, mode: null };
  };

  const resolveClarification = (input = {}) => {
    const result = interactionService?.validateClarificationResponse
      ? interactionService.validateClarificationResponse(input)
      : { ok: true };
    if (!result.ok) return result;
    return {
      ok: true,
      state: result.state || interactionService?.resolveClarification?.(input.state, input.response) || input.state || null,
    };
  };

  /**
   * Resolve and route a persisted failed task.  The request runtime supplies
   * mutable request state and side-effect callbacks; this function owns the
   * recovery decision branch and returns whether the request was completed.
   */
  const routeRecoveryContinuation = async (scope = {}) => {
    const {
      state, recoveryRecord, requestedRecoveryTaskId, body, runId,
      sessionVisualAssets, contextEntityById, runtimeReferenceById,
      runtimeReferenceContext, normalizeReferenceContext, progressTracker,
      writeLifecycleEvent, writeProgress, writeInteractionEvent, writeEvent,
      writeContextEvent, writeAgentDone, contextLogger, controller,
      resolvedChatSelection,
    } = scope;
    if (!recoveryRecord) return { handled: false };
    const continuation = resolveRecovery({
      record: recoveryRecord,
      requestedTaskId: requestedRecoveryTaskId,
      clarificationRequest: body.clarificationRequest,
      clarificationResponse: body.clarificationResponse,
    });
    if (!continuation.ok) throw new Error(continuation.error?.code || 'Recovery continuation is invalid');
    state.recoveryMode = continuation.mode || null;
    if (state.recoveryMode && state.activeClarificationState) state.activeClarificationState.recoveryMode = state.recoveryMode;
    const recoveryResolution = continuation.resolution;
    if (!recoveryResolution) return { handled: false };

    if (recoveryResolution.decision === 'direct_response') {
      writeLifecycleEvent({ type: 'assistant_delta', delta: String(recoveryResolution.content || ''), channel: 'content', model: resolvedChatSelection.model });
      writeAgentDone('completed');
      return { handled: true, reason: 'direct_response' };
    }
    if (recoveryResolution.decision === 'continue_current_request') {
      state.recoveryDecision = 'continue_current_request';
      state.recoveryBaseRecord = null;
      state.imageOperation = null;
      state.targetReferenceId = null;
      state.preserveRecoveryRecordOnFailure = false;
      return { handled: false, state };
    }
    if (recoveryResolution.decision !== 'resume') return { handled: false, state };

    state.recoveryDecision = 'resume';
    state.recoveryBaseRecord = recoveryRecord;
    state.preserveRecoveryRecordOnFailure = false;
    state.recoveryTaskIdForExecution = recoveryRecord.taskId;
    writeProgress({ stepId: 'routing', phase: 'resuming', status: 'completed', label: recoveryResolution.route === 'main_agent' ? '已定位上次任务，正在继续分析' : '已定位上次任务，正在重新规划' });
    void contextLogger.info('task.resumed', 'Agent resumed the latest failed root task', {
      taskId: recoveryRecord.taskId, runId, sourceRunId: recoveryRecord.runId,
      skillId: recoveryResolution.skillId || recoveryRecord.skillId || null, route: recoveryResolution.route,
    });
    state.imageOperation = recoveryRecord.imageOperation || state.imageOperation;
    state.targetReferenceId = recoveryRecord.targetReferenceId || state.targetReferenceId;
    if (recoveryRecord.assetId && !state.runReferenceContext?.references.some((reference) => reference.assetId === recoveryRecord.assetId)) {
      const recoveredAsset = sessionVisualAssets.find((asset) => asset.id === recoveryRecord.assetId);
      if (recoveredAsset) {
        const recoveredId = state.targetReferenceId || `asset:${recoveryRecord.assetId}`;
        const recoveredReference = {
          id: recoveredId, assetId: recoveredAsset.id, src: recoveredAsset.durableSrc,
          originalSrc: recoveredAsset.originalSrc, previewSrc: recoveredAsset.previewSrc,
          label: '恢复的图片资产', source: recoveredAsset.source === 'canvas' ? 'canvas' : recoveredAsset.source === 'generated' ? 'history' : 'upload', role: 'reference',
        };
        state.runReferenceContext = {
          references: [...(state.runReferenceContext?.references || []), recoveredReference],
          composerSegments: state.runReferenceContext?.composerSegments || [],
          ...(state.runReferenceContext?.evidenceImages ? { evidenceImages: state.runReferenceContext.evidenceImages } : {}),
        };
        runtimeReferenceById.set(recoveredId, recoveredReference);
      }
    }
    state.recoveryRevisionMessage = typeof recoveryResolution.revision === 'string' ? recoveryResolution.revision.trim() : '';
    if (recoveryResolution.skillId) {
      state.selectedSkill = scope.skillManifests.find((manifest) => manifest.id === recoveryResolution.skillId) || null;
      if (!state.selectedSkill) throw new Error('Recovery Skill is no longer enabled');
      state.skillSource = 'recovery'; state.skillSelectionMethod = 'none'; state.skillCandidateIds = [state.selectedSkill.id];
    } else {
      state.selectedSkill = null; state.skillSource = null; state.skillSelectionMethod = 'none'; state.skillCandidateIds = [];
    }
    if (recoveryRecord.completedAssetCount > 0 && recoveryResolution.route === 'main_agent' && !state.recoveryMode) {
      const request = {
        id: scope.randomUUID(), taskId: recoveryRecord.taskId,
        question: `上次已有 ${recoveryRecord.completedAssetCount} 个素材完成，这次要如何继续？`, dimension: 'recovery_scope',
        options: [
          { id: 'fill_missing', label: '只补齐未完成项', answer: '只生成缺失的素材，保留已完成结果。' },
          { id: 'redo_all', label: '全部重做', answer: '忽略已完成结果，重新生成完整任务。' },
        ], allowCustom: false, allowProceed: false,
      };
      const checkpoint = progressTracker.snapshot();
      writeInteractionEvent({ type: 'clarification_required', message: request.question, request, state: {
        taskId: recoveryRecord.taskId, sourceUserMessageId: recoveryRecord.sourceUserMessageId,
        operationId: checkpoint.operationId, skillSource: state.skillSource, lastSequence: checkpoint.lastSequence,
        intent: recoveryRecord.intent === 'skill_action' ? 'skill_action' : 'image',
        ...(recoveryRecord.skillId ? { skillId: recoveryRecord.skillId, skillRead: false } : {}),
        originalRequest: recoveryRecord.originalRequest, workingBrief: recoveryRecord.originalRequest,
        askedDimensions: ['recovery_scope'], answers: [], recoveryRecord,
      } });
      writeAgentDone('recovery_scope_required');
      return { handled: true, reason: 'recovery_scope_required', state };
    }
    const sourceIndex = body.messages.findIndex((message) => message.id === recoveryRecord.sourceUserMessageId);
    const fallbackIndex = body.messages.findIndex((message) => message.role === 'user' && message.content.trim().slice(0, 4000) === recoveryRecord.originalRequest);
    const endIndex = sourceIndex >= 0 ? sourceIndex : fallbackIndex;
    state.recoveryHistoryMessages = endIndex >= 0 ? body.messages.slice(0, endIndex + 1) : [];
    if (state.recoveryHistoryMessages.at(-1)?.role !== 'user' || state.recoveryHistoryMessages.at(-1)?.content.trim() !== recoveryRecord.originalRequest) state.recoveryHistoryMessages.push({ id: recoveryRecord.sourceUserMessageId, role: 'user', content: recoveryRecord.originalRequest });
    if (state.recoveryRevisionMessage) {
      const revisionSource = [...body.messages].reverse().find((message) => message.role === 'user');
      state.recoveryHistoryMessages.push({ id: revisionSource?.id || `revision-${runId}`, role: 'user', content: state.recoveryRevisionMessage });
    }
    const recoveredReferenceContext = recoveryRecord.visualReferenceIds.length > 0
      ? normalizeReferenceContext({ references: recoveryRecord.visualReferenceIds.map((id) => {
        const runtimeReference = recoveryRecord.referenceContext?.references?.find((reference) => reference.id === id) || runtimeReferenceById.get(id);
        const entity = contextEntityById.get(id); const src = runtimeReference?.src || entity?.assetUrl || entity?.referenceImageUrls?.[0];
        if (!src) throw new Error(`Visual reference is unavailable: ${id}`);
        return runtimeReference || { id, src, label: entity?.label || id, source: entity?.kind === 'canvas_item' ? 'canvas' : 'history', role: 'reference' };
      }), composerSegments: [{ type: 'text', text: recoveryRecord.originalRequest }, ...recoveryRecord.visualReferenceIds.map((referenceId) => ({ type: 'reference', referenceId }))] })
      : undefined;
    if (recoveryResolution.route === 'main_agent') {
      state.mainAgentInputMessages = state.recoveryHistoryMessages;
      state.mainAgentReferenceImages = body.referenceImages?.length ? body.referenceImages : recoveredReferenceContext?.references.map((reference) => reference.src) || [];
      state.mainAgentReferenceContext = runtimeReferenceContext || recoveryRecord.referenceContext || recoveredReferenceContext;
      if (state.mainAgentReferenceContext) {
        state.runReferenceContext = structuredClone(state.mainAgentReferenceContext); runtimeReferenceById.clear();
        for (const reference of state.runReferenceContext.references || []) runtimeReferenceById.set(reference.id, reference);
        state.executionReferenceImages = state.runReferenceContext.references.map((reference) => reference.src);
        state.initiallyAttachedVisualIds.clear(); state.loadedVisualReferenceIds.clear();
        for (const reference of state.runReferenceContext.references || []) { state.initiallyAttachedVisualIds.add(reference.id); state.loadedVisualReferenceIds.add(reference.id); }
      }
    } else if (recoveryResolution.route === 'local_delivery') {
      const assets = (recoveryRecord.taskSnapshot?.activeVersions || []).flatMap((version) => {
        const entity = contextEntityById.get(version.referenceId); const src = version.assetUrl || entity?.assetUrl || entity?.referenceImageUrls?.[0];
        return src ? [{ src, slotId: version.slotId, versionId: version.versionId, previewSrc: version.previewSrc, naturalWidth: version.naturalWidth, naturalHeight: version.naturalHeight, model: version.model, itemId: version.itemId, index: version.index, label: version.label, promptTrace: version.promptTrace }] : [];
      });
      if (assets.length === 0) throw new Error('已生成素材不再可读取，无法重新交付');
      const deliveryAction = enrichGeneratedAssetDeliveryAction({
        type: 'add_generated_assets', runId, taskId: recoveryRecord.taskId, assets,
      });
      writeEvent(controller, { type: 'client_action', action: deliveryAction });
      writeContextEvent({ type: 'client_action', action: deliveryAction });
      writeAgentDone('local_delivery_recovered');
      return { handled: true, reason: 'local_delivery_recovered', state };
    } else {
      state.mainAgentInputMessages = state.recoveryHistoryMessages; state.mainAgentReferenceImages = []; state.mainAgentReferenceContext = runtimeReferenceContext || recoveredReferenceContext;
    }
    return { handled: false, state };
  };

  return { resolveRecovery, resolveClarification, routeRecoveryContinuation };
}
