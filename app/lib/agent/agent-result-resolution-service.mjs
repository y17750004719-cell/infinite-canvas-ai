/**
 * Owns the post-Native-turn result branches that can finish a request before
 * the normal assistant response path.  The runtime supplies state accessors
 * and event callbacks so this service remains independent of HTTP/journal
 * storage and can be exercised with a small harness.
 */
export async function resolveAgentResult({
  resultResolution,
  nativeGeneratedImageResult,
  approvedConfirmation,
  directGenerateImageCallId,
  directGenerateImageCall,
  nativeImageFailure,
  loopResult,
  runId,
  operationId,
  sessionId,
  taskId,
  skillSource,
  selectedSkill,
  activeClarificationState,
  runReferenceContext,
  executionReferenceImages,
  agentAnalysis,
  workingContextData,
  latestUserMessage,
  body,
  resolvedChatSelection,
  lockedImageToolArgs,
  directImageExecution,
  contextEntityById,
  confirmationTaskIdentity,
  continuationState,
  resolveMainAgentToolNames,
  rootTaskId = () => taskId,
  rootOriginalRequest,
  rootSourceUserMessageId,
  writeInteractionEvent,
  writeProgress,
  writeToolProgress,
  writeAgentDone,
  writeResolvedImageOptionUpdate,
  writeStampedAgentEvent,
  writeImageCompletionSummary,
  createToolResultEvents,
  enrichGeneratedAssetEvents,
  updateTopicMemory,
  commitMainAgentMemory,
  emitIntentResolved,
  hashEnvelopeValue,
  confirmationTtlMs,
  intentRef,
  fallbackAssistantText,
}) {
  // A failed prerequisite (for example visual Skill locking) is terminal for
  // this turn. Keep the structured failure intact and never convert it into
  // an image-generated completion merely because image intent was selected.
  if (nativeImageFailure || loopResult?.stopReason === 'failed' || loopResult?.failureCode === 'skill_lock_failed') {
    const failure = nativeImageFailure || Object.assign(new Error(loopResult?.errorMessage || 'Agent turn failed'), {
      code: loopResult?.failureCode || 'agent_turn_failed',
      failureStage: loopResult?.failureStage || 'agent_runtime',
      retryable: loopResult?.retryable === true,
      outcomeUnknown: loopResult?.outcomeUnknown === true,
    });
    throw failure;
  }
  if (resultResolution?.status === 'pending' && resultResolution.kind === 'clarification') {
    const request = resultResolution.request;
    writeInteractionEvent({ type: 'clarification_required', message: request.question, request, state: {
      ...resultResolution.state,
      sourceUserMessageId: rootSourceUserMessageId(),
      workingBrief: rootOriginalRequest(),
      answers: [],
      ...(runReferenceContext ? { referenceContext: structuredClone(runReferenceContext) } : {}),
      ...(agentAnalysis ? { agentAnalysis: structuredClone(agentAnalysis) } : {}),
    } });
    writeProgress({ stepId: 'agent_analysis', phase: 'waiting_input', status: 'waiting', label: '等待你选择' });
    writeAgentDone(resultResolution.reason);
    return { handled: true };
  }

  if (resultResolution?.status === 'pending' && resultResolution.kind === 'context_selection') {
    const request = resultResolution.request;
    writeInteractionEvent({ type: 'clarification_required', message: request.question, request, state: {
      ...resultResolution.state,
      sourceUserMessageId: rootSourceUserMessageId(),
      workingBrief: activeClarificationState?.workingBrief || rootOriginalRequest(),
      answers: [],
      contextCandidates: (resultResolution.candidates || [])
        .map((candidate) => contextEntityById.get(String(candidate.id)))
        .filter(Boolean),
    } });
    writeAgentDone(resultResolution.reason);
    return { handled: true };
  }

  if (resultResolution?.status === 'pending' && resultResolution.kind === 'confirmation') {
    const confirmation = resultResolution.confirmation;
    const confirmationId = confirmation.confirmationId;
    const toolName = confirmation.toolName;
    const toolArgs = confirmation.toolArgs;
    const pendingConfirmation = {
      ...confirmationTaskIdentity(), version: 1, confirmationId, runId, status: 'pending',
      operationId: confirmation.operationId, skillSource, lastSequence: confirmation.lastSequence,
      progressToolCallId: confirmation.toolCallId, skillId: selectedSkill?.id || null,
      toolName, toolArgs,
      pendingToolCall: {
        id: confirmation.toolCallId, name: toolName, args: structuredClone(toolArgs),
        argsHash: hashEnvelopeValue(toolArgs), batch: [],
      },
      resolvedProviderId: resolvedChatSelection.providerId,
      resolvedModel: resolvedChatSelection.model,
      imageOptions: body.imageOptions ? structuredClone(body.imageOptions) : undefined,
      referenceContext: runReferenceContext ? structuredClone(runReferenceContext) : undefined,
      workingContext: structuredClone(workingContextData),
      allowedTools: resolveMainAgentToolNames(), userMessage: latestUserMessage,
      referenceImages: [...executionReferenceImages],
      canvasContext: body.canvasContext ? structuredClone(body.canvasContext) : undefined,
      sessionId, expiresAt: Date.now() + confirmationTtlMs,
    };
    await continuationState.storePendingConfirmation({
      sessionId, confirmationId, taskId: rootTaskId(), operationId, runId,
      contract: toolArgs, parameters: pendingConfirmation,
      expiresAt: pendingConfirmation.expiresAt,
    });
    writeToolProgress(toolName, 'waiting', confirmation.toolCallId);
    writeInteractionEvent({ type: 'confirmation_required', request: {
      confirmationId, toolName, message: confirmation.message,
    } });
    writeAgentDone(resultResolution.reason);
    return { handled: true };
  }

  const nativeImageOutputs = Array.isArray(nativeGeneratedImageResult?.result?.outputs)
    ? nativeGeneratedImageResult.result.outputs
    : [];
  const nativeImageCompleted = nativeGeneratedImageResult?.status === 'completed'
    && nativeImageOutputs.length > 0;

  if (nativeGeneratedImageResult && !nativeImageCompleted) {
    throw nativeImageFailure || Object.assign(new Error('Image execution did not complete successfully'), {
      code: nativeGeneratedImageResult?.error?.code || 'image_execution_failed',
      failureStage: 'image_execution',
      retryable: false,
      outcomeUnknown: nativeGeneratedImageResult?.status === 'unknown',
    });
  }

  if (nativeImageCompleted) {
    if (approvedConfirmation) continuationState.completeConfirmation(approvedConfirmation.confirmationId);
    intentRef.value = 'image';
    emitIntentResolved('image');
    const toolCallId = directGenerateImageCallId || `${runId}-generate-image`;
    writeResolvedImageOptionUpdate(toolCallId, nativeGeneratedImageResult);
    const events = createToolResultEvents({
      source: 'direct', runId, toolCallId, toolName: 'generate_image',
      rawResult: nativeGeneratedImageResult,
      includeAssets: nativeGeneratedImageResult.assetDeliveryQueued !== true,
    });
    for (const event of enrichGeneratedAssetEvents(events, nativeGeneratedImageResult)) {
      writeStampedAgentEvent(event);
    }
    writeImageCompletionSummary(loopResult?.postImageResponseFailure ? {
      ...nativeGeneratedImageResult,
      presentation: {
        ...nativeGeneratedImageResult.presentation,
        summary: '图片已生成并保存。主模型结束语生成中断，已保留图片结果，无需重新生图。',
      },
    } : nativeGeneratedImageResult);
    updateTopicMemory({
      activeTask: {
        status: 'completed',
        summary: directImageExecution?.presentation?.completionSummary || 'Image delivery completed.',
      },
      recentReferencedAssetIds: lockedImageToolArgs?.referenceIds || [],
    });
    commitMainAgentMemory();
    writeAgentDone('image_generated');
    return { handled: true };
  }

  if (!String(loopResult?.content || '').trim() && typeof fallbackAssistantText === 'function') {
    const observed = String(fallbackAssistantText() || '').trim();
    if (observed) loopResult.content = observed;
  }
  if (!String(loopResult?.content || '').trim()) {
    throw Object.assign(new Error('Native model returned no final response'), {
      code: 'empty_model_response', failureStage: 'native_runtime',
    });
  }
  if (directGenerateImageCall && !nativeGeneratedImageResult) {
    throw nativeImageFailure || Object.assign(new Error('Image execution did not return saved assets'), {
      code: 'image_execution_incomplete', failureStage: 'image_execution',
    });
  }
  // The image pipeline may have already committed durable assets while the
  // Native turn continues to produce its final acknowledgement. Preserve the
  // resolved image intent instead of emitting a contradictory chat event.
  if (intentRef.value === 'image' && nativeGeneratedImageResult) {
    commitMainAgentMemory();
    writeAgentDone('image_generated');
    return { handled: true };
  }
  intentRef.value = 'chat';
  emitIntentResolved('chat');
  commitMainAgentMemory();
  writeAgentDone('completed');
  return { handled: true };
}
