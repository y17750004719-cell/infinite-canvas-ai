import {
  classifyAgentFailureCode,
  createNativeRequestExhaustedError,
  nativeRetryDelayMs,
  resolveNativeRetryDecision,
} from './agent-recovery-service.mjs';
import { markNativeContextForRotation } from './native-agent-service.ts';

const retrySleep = (delayMs, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(Object.assign(new Error('Native Agent request was cancelled'), { code: 'cancelled', retryable: false }));
    return;
  }
  const timer = setTimeout(resolve, delayMs);
  signal?.addEventListener?.('abort', () => {
    clearTimeout(timer);
    reject(Object.assign(new Error('Native Agent request was cancelled'), { code: 'cancelled', retryable: false }));
  }, { once: true });
});

export function composeNativeRetryBeforeRetry(sessionId, configuredBeforeRetry, markRotation = markNativeContextForRotation) {
  return async (event = {}) => {
    await markRotation(sessionId, `adapter_${event.lane || 'request'}_retry`);
    await configuredBeforeRetry?.(event);
  };
}

function nativeLoopFailure(loopResult = {}) {
  return {
    code: loopResult.failureCode || loopResult.error?.code || 'native_turn_failed',
    message: loopResult.errorMessage || loopResult.error?.message || 'Native Agent turn failed',
    failureStage: loopResult.failureStage || loopResult.error?.failureStage || 'native_runtime',
    retryable: loopResult.retryable === true || loopResult.error?.retryable === true,
    outcomeUnknown: loopResult.outcomeUnknown === true || loopResult.error?.outcomeUnknown === true,
  };
}

function replayablePublicEventFingerprint(name, args) {
  if (name === 'onCommentary') {
    return `${name}:${String(args[0]?.phase || '')}:${String(args[0]?.text || '')}`;
  }
  if (name === 'onActivityText') return `${name}:${String(args[1] || '')}`;
  if (name === 'onRawEvent') {
    const event = args[0] || {};
    const item = event?.params?.item || {};
    const method = String(event?.method || '');
    const itemType = String(item?.type || '');
    if (itemType !== 'agentMessage' && method !== 'item/agentMessage/delta') return '';
    const text = String(item?.text || item?.delta || event?.params?.delta || event?.params?.text || '');
    return text ? `${name}:${itemType || method}:${text}` : '';
  }
  return '';
}

function isNativeResponseEvent(name, args) {
  if (name === 'onCommentary' || name === 'onActivityText' || name === 'onToolStart' || name === 'onToolResult') {
    return true;
  }
  if (name !== 'onRawEvent') return false;
  const method = String(args[0]?.method || '');
  return Boolean(method) && method !== 'zflow/native_context_prepared';
}

function observedEventHandlers(eventHandlers = {}, observation, deliveredEvents, retrying, onFirstResponse) {
  const wrap = (name, callback) => typeof callback === 'function'
    ? async (...args) => {
      if (isNativeResponseEvent(name, args) && !observation.responseStarted) {
        observation.responseStarted = true;
        observation.firstResponseEventMs = Math.max(0, Date.now() - observation.startedAt);
        await onFirstResponse?.({ firstResponseEventMs: observation.firstResponseEventMs });
      }
      if (name === 'onToolStart' || name === 'onToolResult') observation.sideEffectStarted = true;
      const fingerprint = replayablePublicEventFingerprint(name, args);
      if (fingerprint) {
        if (retrying && deliveredEvents.has(fingerprint)) return undefined;
        deliveredEvents.add(fingerprint);
      }
      return callback(...args);
    }
    : callback;
  return Object.fromEntries(Object.entries(eventHandlers).map(([name, callback]) => [name, wrap(name, callback)]));
}

/**
 * Execute the Native turn with Codex Main-compatible request/stream budgets.
 * The injected retryState keeps this generic boundary independent of image
 * internals and lets context rotation replace the Native thread generation.
 */
export async function executeMainAgentTurnWithSafeRetry(execute, options = {}) {
  const {
    eventHandlers = {},
    retryState = {},
    signal,
    sleep = retrySleep,
  } = options;
  let requestRetries = 0;
  let streamRetries = 0;
  let attempt = 0;
  const deliveredEvents = new Set();

  while (true) {
    const attemptDetails = {
      attempt: attempt + 1,
      requestAttempt: requestRetries + 1,
      streamAttempt: streamRetries + 1,
    };
    const observation = {
      responseStarted: false,
      sideEffectStarted: false,
      firstResponseEventMs: null,
      startedAt: Date.now(),
    };
    let execution;
    let failure;
    try {
      await retryState.onAttempt?.(attemptDetails);
      execution = await execute(observedEventHandlers(
        eventHandlers,
        observation,
        deliveredEvents,
        attempt > 0,
        (event) => retryState.onFirstResponse?.({ ...attemptDetails, ...event }),
      ));
      const loopResult = execution?.loopResult || {};
      if (loopResult.stopReason !== 'failed' && loopResult.stopReason !== 'cancelled') return execution;
      failure = nativeLoopFailure(loopResult);
    } catch (error) {
      failure = error;
    }

    const externalState = typeof retryState.getSnapshot === 'function'
      ? await retryState.getSnapshot()
      : {};
    const decision = resolveNativeRetryDecision({
      error: failure,
      state: {
        ...externalState,
        responseStarted: externalState?.responseStarted === true || observation.responseStarted,
        sideEffectStarted: externalState?.sideEffectStarted === true || observation.sideEffectStarted,
        cancelled: externalState?.cancelled === true || signal?.aborted === true,
        outcomeUnknown: externalState?.outcomeUnknown === true || failure?.outcomeUnknown === true,
      },
      requestRetries,
      streamRetries,
    });
    if (!decision.retry) {
      if (decision.reason === 'budget_exhausted') throw createNativeRequestExhaustedError(failure, decision);
      throw Object.assign(new Error(failure?.message || 'Native Agent turn failed'), failure);
    }

    if (decision.lane === 'stream') streamRetries += 1;
    else requestRetries += 1;
    const retryNumber = decision.lane === 'stream' ? streamRetries : requestRetries;
    await retryState.beforeRetry?.({
      lane: decision.lane,
      retryNumber,
      maxRetries: decision.maxRetries,
      error: failure,
    });
    await retryState.onRetry?.({
      lane: decision.lane,
      retryNumber,
      maxRetries: decision.maxRetries,
      failureStage: 'native_request',
      code: decision.code,
    });
    await sleep(nativeRetryDelayMs(retryNumber), signal);
    attempt += 1;
  }
}

/**
 * Runs the request's main-agent turn and resolves its result.
 *
 * This boundary keeps the request runtime responsible for composing state,
 * while the stream service owns the Native execution/result hand-off.
 */
export async function runAgentRequestMainLoop(scope = {}) {
  const {
    executeMainAgentTurn,
    mainAgentRegistry,
    selectedSkill,
    approvedConfirmation,
    recoveryCandidateForAgent,
    recoveryRevisionMessage,
    agentAnalysis,
    relevantContextCandidateIds,
    incrementRequestCount,
    getAgentRuntimeModelTools,
    prepareAgentTurnContext,
    nativeTurnContext,
    nativeContextEventHandlers,
    runMainAgent,
    buildNativeRequest,
    startKeepalive,
    toolCallbackOptions,
    onSkillSelection,
    eventHandlers,
    hasImageResult,
    toolCallCount,
    mainAgentResultFlow,
    resolveAgentResult,
    resultContext,
    resultResolutionContext,
    resultDependencies = {},
    getFallbackAssistantText,
    nativeRetryState,
    runSignal,
  } = scope;

  const execution = await executeMainAgentTurnWithSafeRetry(
    (attemptEventHandlers) => executeMainAgentTurn({
      mainAgentRegistry,
      selectedSkill,
      approvedConfirmation,
      recoveryCandidateForAgent,
      recoveryRevisionMessage,
      agentAnalysis,
      relevantContextCandidateIds,
      incrementRequestCount,
      getAgentModelTools: getAgentRuntimeModelTools,
      prepareContext: prepareAgentTurnContext,
      nativeTurnContext,
      nativeContextEventHandlers,
      runMainAgent,
      buildNativeRequest,
      startKeepalive,
      toolCallbackOptions,
      onSkillSelection,
      eventHandlers: attemptEventHandlers,
      hasImageResult,
      toolCallCount,
    }),
    { eventHandlers, retryState: nativeRetryState, signal: runSignal },
  ).catch(async (error) => {
    const saved = resultResolutionContext?.nativeGeneratedImageResult;
    const code = String(classifyAgentFailureCode(error) || error?.code || '');
    const finalResponseFailure = [
      'provider_overloaded', 'native_stream_disconnected', 'provider_stream_disconnect',
      'provider_timeout', 'transport', 'empty_model_response', 'native_process_exited',
    ].includes(code);
    if (runSignal?.aborted || !finalResponseFailure || error?.outcomeUnknown
      || resultResolutionContext?.nativeImageFailure
      || saved?.status !== 'completed' || saved?.outcomeUnknown
      || !saved?.result?.outputs?.some((asset) => asset.assetId && asset.localUrl)) throw error;
    // Recover delivery only. Never run the image tool or retry the Native
    // turn after a provider side effect has completed.
    const postImageResponseFailure = { code, failureStage: 'native_request' };
    await nativeRetryState?.onPostImageResponseFailure?.(postImageResponseFailure);
    return {
      loopResult: { stopReason: 'completed', content: '', postImageResponseFailure },
      resolveToolNames: () => [],
    };
  });
  let loopResult = execution.loopResult;
  if (loopResult.stopReason === 'failed' || loopResult.stopReason === 'cancelled') {
    throw Object.assign(new Error(loopResult.errorMessage || 'Native Agent turn failed'), {
      code: loopResult.failureCode || 'native_turn_failed',
      failureStage: 'native_runtime',
      retryable: loopResult.retryable === true,
    });
  }
  const fallbackAssistantText = typeof getFallbackAssistantText === 'function'
    ? String(getFallbackAssistantText() || '').trim()
    : '';
  if (!String(loopResult?.content || '').trim() && fallbackAssistantText) {
    loopResult = { ...loopResult, content: fallbackAssistantText, text: fallbackAssistantText };
  }

  const resultFlow = mainAgentResultFlow || resultDependencies.mainAgentResultFlow;
  const resultResolver = resolveAgentResult || resultDependencies.resolveAgentResult;
  const resultResolution = resultFlow.resolve({
    loopResult,
    context: resultContext,
  });
  const resultHandled = await resultResolver({
    resultResolution,
    loopResult,
    ...resultResolutionContext,
    ...resultDependencies,
    resolveMainAgentToolNames: execution.resolveToolNames,
  });
  return { loopResult, resultHandled, resolveMainAgentToolNames: execution.resolveToolNames };
}

/** Build one Native loop invocation from explicit request state refs. */
export function buildAgentRequestMainLoopOptions(scope = {}) {
  const {
    executeMainAgentTurn, mainAgentRegistry, selectedSkill, approvedConfirmation,
    recoveryCandidateForAgent, recoveryRevisionMessage, agentAnalysis,
    relevantContextCandidateIds, incrementRequestCount, getAgentRuntimeModelTools,
    prepareAgentTurnContext, nativeTurnContext, nativeContextEventHandlers,
    runMainAgent, buildNativeRequest, startKeepalive, toolCallbackOptions,
    onSkillSelection, eventHandlers, hasImageResult, toolCallCount,
    resultContext, resultResolutionContext, mainAgentResultFlow, resolveAgentResult,
    getFallbackAssistantText, nativeRetryState, runSignal,
  } = scope;
  return {
    executeMainAgentTurn, mainAgentRegistry, selectedSkill, approvedConfirmation,
    recoveryCandidateForAgent, recoveryRevisionMessage, agentAnalysis,
    relevantContextCandidateIds, incrementRequestCount,
    getAgentRuntimeModelTools, prepareAgentTurnContext, nativeTurnContext,
    nativeContextEventHandlers, runMainAgent, buildNativeRequest, startKeepalive,
    toolCallbackOptions, onSkillSelection, eventHandlers, hasImageResult, toolCallCount,
    mainAgentResultFlow, resolveAgentResult, resultContext, resultResolutionContext,
    getFallbackAssistantText, nativeRetryState, runSignal,
  };
}

/** Execute a fully assembled request loop through this service boundary. */
export async function runAgentRequestMainLoopFromRequest(scope = {}) {
  return runAgentRequestMainLoop(buildAgentRequestMainLoopOptions(scope));
}

/**
 * Assemble the request-specific Native loop callbacks.  The request runtime
 * supplies state references, while this service owns protocol input shaping,
 * interaction callbacks, and event callback wiring.
 */
export async function runAgentRequestMainLoopFromRuntimeState(scope = {}) {
  const {
    executeMainAgentTurn, mainAgentRegistry, selectedSkill, approvedConfirmation,
    recoveryCandidateForAgent, recoveryRevisionMessage, agentAnalysis,
    relevantContextCandidateIds, incrementRequestCount, getAgentRuntimeModelTools,
    prepareAgentTurnContext, mainAgentReferenceImages, sessionId, latestUserMessage,
    body, imagegenHostContent, imagegenHostContentHash, skillContent, skillContentHash,
    skillManifests, runReferenceContext, recoveryBaseRecord, recoveryMode,
    resolvedChatSelection, resolvedChatProvider, effectiveProviderProtocol,
    rootTaskId, operationId, runId, taskId, runSignal, nativeGeneratedImageResult,
    toolCallRecords, materializeSessionVisualAsset, readSessionVisualAsset,
    sessionVisualAssets, imagegenHostSkillId, nativeAgentInstructions,
    runMainAgent, startKeepalive, hashArguments, canvasContext, journalTurnId,
    progressTracker, mainAgentRegistryForTools, interactionService, directGenerateImageCall,
    hashPrompt, mainAgentLoopState, writeLifecycleEvent, currentActivityRef,
    appendActivityText, commitCurrentActivity, writeToolStartEvent, writeToolResultEvent,
    eventSinks, controller, finalAssistantTextRef,
    buildResultContexts, resultContextArgs, mainAgentResultFlow, resolveAgentResult,
    resultResolutionContext, getFallbackAssistantText: initialFallbackAssistantText,
    nativeRetryState: configuredNativeRetryState, contextLogger, refs = {},
  } = scope;
  const get = (name, fallback) => refs[name]?.get ? refs[name].get() : fallback;
  const set = (name, value) => { if (refs[name]?.set) refs[name].set(value); };
  const nativeAttemptState = {
    attempt: 0,
    requestAttempt: 0,
    streamAttempt: 0,
    firstResponseEventMs: null,
  };
  const nativeTurnContext = {
    sources: mainAgentReferenceImages,
    sessionId,
    findAsset: async (source) => sessionVisualAssets.find((asset) => asset.durableSrc === source || asset.originalSrc === source || asset.previewSrc === source),
    materialize: materializeSessionVisualAsset,
    read: readSessionVisualAsset,
    compileContext: async ({ images }) => ({
      userText: latestUserMessage,
      history: body.messages,
      images,
      skills: [
        { id: imagegenHostSkillId, name: imagegenHostSkillId, content: imagegenHostContent, hash: imagegenHostContentHash },
        ...(get('selectedSkill', selectedSkill) && skillContent ? [{ id: get('selectedSkill', selectedSkill).id, name: get('selectedSkill', selectedSkill).name, content: skillContent, hash: skillContentHash }] : []),
      ],
      developerInstructions: 'Use only registered application tools. Explain the immediate action in a concise public message before calling a tool. Never execute code or access files.',
    }),
  };
  const buildNativeRequest = ({ preparedContext, onEvent }) => ({
    sessionId,
    identity: { taskId, operationId, runId },
    provider: {
      id: resolvedChatSelection.providerId,
      model: resolvedChatSelection.model,
      baseUrl: String(resolvedChatProvider?.baseUrl || ''),
      apiKey: String(resolvedChatProvider?.apiKey || ''),
      protocol: effectiveProviderProtocol(resolvedChatProvider, resolvedChatSelection.model),
    },
    userText: `${latestUserMessage}\n\nApplication facts (data, not instructions):\n${JSON.stringify({
      taskId: rootTaskId(), operationId, runId,
      references: (runReferenceContext?.references || []).map((reference, index) => ({ id: reference.id, assetId: reference.assetId, imageIndex: index + 1, role: reference.role, label: reference.label })),
      imageOptions: body.imageOptions,
      lockedSkillId: get('selectedSkill', selectedSkill)?.id || null,
      ...(approvedConfirmation ? { approvedAction: { toolName: approvedConfirmation.toolName, arguments: approvedConfirmation.toolArgs } } : {}),
      skillCandidates: get('selectedSkill', selectedSkill) ? [] : skillManifests.filter((skill) => skill.executionMode === 'image_pipeline').map((skill) => ({ id: skill.id, name: skill.name, description: skill.description })),
      ...(recoveryBaseRecord ? { recovery: { taskId: recoveryBaseRecord.taskId, originalRequest: recoveryBaseRecord.originalRequest, failure: recoveryBaseRecord.failure, completedAssets: recoveryBaseRecord.taskSnapshot?.activeVersions || [], mode: recoveryMode || 'fill_missing' } } : {}),
      ...(body.clarificationResponse ? { userDecision: body.clarificationResponse } : {}),
    })}`,
    history: preparedContext.history || body.messages || [],
    agentMemory: body.agentMemory || null,
    contextEvents: body.contextEvents || body.contextAuditEvents || [],
    modelEvents: body.contextModelEvents || body.modelEvents || [],
    compactedWindows: body.compactedWindows || [],
    images: preparedContext.images,
    imageIdentities: (preparedContext.images || []).map((image, index) => {
      const reference = runReferenceContext?.references?.[index] || null;
      return {
        ...(reference?.assetId ? { assetId: reference.assetId } : {}),
        ...(reference?.id ? { referenceId: reference.id } : {}),
        contentHash: hashPrompt(String(image || '')),
      };
    }),
    skills: preparedContext.skills,
    baseInstructions: nativeAgentInstructions,
    developerInstructions: preparedContext.developerInstructions,
    signal: runSignal, onEvent,
    hasImageResult: Boolean(nativeGeneratedImageResult), toolCallCount: toolCallRecords.length,
  });
  const onSkillSelection = async ({ args }) => {
    const selection = await interactionService.selectVisualSkill({ args, skills: skillManifests, selectedSkill: get('selectedSkill', selectedSkill), imageStarted: directGenerateImageCall, context: { taskId, operationId, runId } });
    if (!selection.locked) {
      mainAgentLoopState.skillSelectionFailed = true;
      const reason = selection.reason || 'visual Skill could not be locked';
      return {
        isError: true,
        modelResult: { code: 'skill_lock_failed', reason, retryable: false },
        publicResult: { kind: 'tool_error', toolName: 'select_visual_skill', status: 'failed', code: 'skill_lock_failed', message: reason },
      };
    }
    if (selection.isError) return selection;
    const skill = selection.skill;
    const content = String(selection.content || '');
    set('selectedSkill', skill); set('skillSource', 'auto');
    set('skillContent', content); set('skillContentHash', String(selection.contentHash || hashPrompt(content)));
    set('visualSkillLoaded', true);
    mainAgentLoopState.skillRead = true; mainAgentLoopState.selectedSkillId = skill.id;
    writeLifecycleEvent({ type: 'skill_selected', skillId: skill.id, label: skill.name, source: 'auto' });
    return { modelResult: { skillId: skill.id, content, contentHash: get('skillContentHash', skillContentHash), truncated: false } };
  };
  let assistantText = '';
  const eventHandlers = {
    onActivityText: async (id, delta) => { if (currentActivityRef.value && currentActivityRef.value.activityId !== id) currentActivityRef.value = null; appendActivityText(id, delta); },
    onToolStart: async (id, tool) => writeToolStartEvent(id, tool),
    onToolResult: async (id, tool, item) => writeToolResultEvent(id, tool, { success: item.success === true }, item.success !== true),
    onCommentary: async (item) => {
      if (item.phase === 'commentary' && item.text) {
        const id = String(item.id || `${runId}:native-commentary`);
        if (currentActivityRef.value?.activityId !== id) currentActivityRef.value = null;
        if (!currentActivityRef.value) appendActivityText(id, String(item.text));
        commitCurrentActivity({ content: [{ type: 'text', text: String(item.text) }] }, 'commentary');
      } else if (item.text) {
        assistantText += String(item.text);
        writeLifecycleEvent({ type: 'assistant_delta', delta: String(item.text), channel: 'content', model: resolvedChatSelection.model, ...progressTracker.stamp() });
        finalAssistantTextRef.value = `${String(finalAssistantTextRef.value || '')}${String(item.text)}`;
      }
    },
    onRawEvent: async (event) => {
      const params = event?.params || {};
      const item = params.item || {};
      const method = String(event?.method || '');
      if (method === 'zflow/native_context_prepared') {
        await contextLogger?.info?.('native.context_prepared', 'Prepared bounded Native context', {
          ...params,
          requestAttempt: nativeAttemptState.requestAttempt,
          streamAttempt: nativeAttemptState.streamAttempt,
          firstResponseEventMs: nativeAttemptState.firstResponseEventMs,
        });
      }
      if (item.type === 'agentMessage' || method === 'item/agentMessage/delta') {
        const text = String(item.text || item.delta || params.delta || params.text || '').trim();
        if (text && !assistantText && !String(finalAssistantTextRef.value || '')) {
          assistantText += text;
          finalAssistantTextRef.value = `${String(finalAssistantTextRef.value || '')}${text}`;
        }
      }
    },
    flush: async () => { await eventSinks.get(controller)?.flush(); },
  };
  const resultContexts = buildResultContexts(resultContextArgs);
  const resultContext = resultContexts.resultContext;
  const effectiveResultResolutionContext = {
    ...(resultContexts.resultResolutionContext || {}),
    ...(resultResolutionContext || {}),
  };
  // The image tool mutates request-scoped state while the Native turn is
  // running. Keep result resolution lazy so it observes the completed image
  // payload and emits the asset delivery action after the provider returns.
  for (const name of [
    'selectedSkill', 'skillSource', 'activeClarificationState', 'runReferenceContext',
    'executionReferenceImages', 'nativeGeneratedImageResult', 'directGenerateImageCallId',
    'directGenerateImageCall', 'nativeImageFailure', 'workingContextData',
    'lockedImageToolArgs', 'directImageExecution',
  ]) {
    if (!refs[name]?.get) continue;
    Object.defineProperty(effectiveResultResolutionContext, name, {
      configurable: true,
      enumerable: true,
      get: () => refs[name].get(),
    });
  }
  effectiveResultResolutionContext.fallbackAssistantText = () => {
    const observed = assistantText || String(finalAssistantTextRef.value || '');
    return observed || (typeof initialFallbackAssistantText === 'function' ? String(initialFallbackAssistantText() || '') : '');
  };
  const initialToolCallCount = toolCallRecords.length;
  const nativeRetryState = {
    ...configuredNativeRetryState,
    onPostImageResponseFailure: async (failure) => {
      await contextLogger?.info?.('native.final_response_failed_after_image', 'Saved image retained after final response failure', {
        runId, operationId, ...failure,
        assetCount: get('nativeGeneratedImageResult', nativeGeneratedImageResult)?.result?.outputs?.length || 0,
        providerRetrySkipped: true,
      });
      await configuredNativeRetryState?.onPostImageResponseFailure?.(failure);
    },
    beforeRetry: composeNativeRetryBeforeRetry(
      sessionId,
      configuredNativeRetryState?.beforeRetry,
    ),
    onAttempt: async (event) => {
      Object.assign(nativeAttemptState, event, { firstResponseEventMs: null });
      await contextLogger?.info?.('native.request_attempt_started', 'Starting Native request attempt', {
        runId,
        operationId,
        requestAttempt: event.requestAttempt,
        streamAttempt: event.streamAttempt,
      });
      await configuredNativeRetryState?.onAttempt?.(event);
    },
    onFirstResponse: async (event) => {
      Object.assign(nativeAttemptState, event);
      await contextLogger?.info?.('native.first_response_event', 'Native request produced its first response event', {
        runId,
        operationId,
        requestAttempt: event.requestAttempt,
        streamAttempt: event.streamAttempt,
        firstResponseEventMs: event.firstResponseEventMs,
      });
      await configuredNativeRetryState?.onFirstResponse?.(event);
    },
    onRetry: async (event) => {
      await contextLogger?.info?.('native.retry_scheduled', 'Scheduling safe Native retry before image provider submission', {
        runId,
        operationId,
        requestAttempt: nativeAttemptState.requestAttempt,
        streamAttempt: nativeAttemptState.streamAttempt,
        ...event,
      });
      await configuredNativeRetryState?.onRetry?.(event);
    },
    getSnapshot: async () => {
      const configured = typeof configuredNativeRetryState?.getSnapshot === 'function'
        ? await configuredNativeRetryState.getSnapshot()
        : {};
      const generated = get('nativeGeneratedImageResult', nativeGeneratedImageResult);
      const imageFailure = get('nativeImageFailure', null);
      const outputs = Array.isArray(generated?.result?.outputs)
        ? generated.result.outputs
        : Array.isArray(generated?.outputs) ? generated.outputs : [];
      return {
        ...configured,
        cancelled: configured?.cancelled === true || runSignal?.aborted === true,
        confirmationPending: configured?.confirmationPending === true,
        sideEffectStarted: configured?.sideEffectStarted === true
          || toolCallRecords.length > initialToolCallCount,
        providerRequestStarted: configured?.providerRequestStarted === true
          || generated?.providerCalled === true
          || imageFailure?.providerRequestStarted === true,
        assetCount: Math.max(Number(configured?.assetCount || 0), outputs.length),
        outcomeUnknown: configured?.outcomeUnknown === true
          || imageFailure?.outcomeUnknown === true
          || generated?.outcomeUnknown === true,
      };
    },
  };
  return runAgentRequestMainLoopFromRequest({
    executeMainAgentTurn, mainAgentRegistry, selectedSkill: get('selectedSkill', selectedSkill), approvedConfirmation,
    recoveryCandidateForAgent, recoveryRevisionMessage, agentAnalysis, relevantContextCandidateIds,
    incrementRequestCount, getAgentRuntimeModelTools, prepareAgentTurnContext, nativeTurnContext,
    nativeContextEventHandlers: { userText: latestUserMessage, selectedSkill: get('selectedSkill', selectedSkill), sessionAssets: sessionVisualAssets },
    runMainAgent, buildNativeRequest, startKeepalive: startKeepalive,
    toolCallbackOptions: { hashArguments, registry: mainAgentRegistryForTools, executionContext: { canvasContext, threadId: sessionId, turnId: journalTurnId, taskId, operationId, runId, expectedSequence: progressTracker.snapshot().lastSequence } },
    onSkillSelection, eventHandlers, hasImageResult: Boolean(nativeGeneratedImageResult), toolCallCount: toolCallRecords.length,
    resultContext, resultResolutionContext: effectiveResultResolutionContext, mainAgentResultFlow, resolveAgentResult,
    getFallbackAssistantText: () => {
      const observed = assistantText || String(finalAssistantTextRef.value || '');
      return observed || (typeof initialFallbackAssistantText === 'function' ? String(initialFallbackAssistantText() || '') : '');
    },
    nativeRetryState,
    runSignal,
  });
}

/** Build the application tool surface for one Native turn. */
export function createMainAgentExecutionContext(scope = {}) {
  const {
    createAgentRuntimeToolHandlers,
    createAgentRuntimeToolRegistry,
    createAgentRuntimeImageToolHandler,
    createRecoveryTaskHandler,
    createTodoUpdateExecutor,
    runtimeContextToolHandlerScope,
    recoveryHandlerScope,
    imageHandlerScope,
    runtimeContextToolHandlers,
  } = scope;
  const contextHandlers = createAgentRuntimeToolHandlers({
    ...runtimeContextToolHandlerScope,
    createTodoUpdateExecutor,
  });
  const registry = createAgentRuntimeToolRegistry({
    handleFailedTask: createRecoveryTaskHandler(recoveryHandlerScope),
    generateImage: createAgentRuntimeImageToolHandler(imageHandlerScope),
    ...runtimeContextToolHandlers,
    ...contextHandlers,
  });
  return { contextHandlers, registry };
}
