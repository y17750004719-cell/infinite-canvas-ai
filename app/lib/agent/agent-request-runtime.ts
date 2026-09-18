import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { runMainAgentFlow } from './agent-main-agent-flow.mjs';
import { handleManagementCommand as handleManagedCommand } from './agent-management-service.mjs';
import { handleThreadReplay } from './thread-replay-service.mjs';
import { buildImageCompletionSummary } from './agent-image-pipeline-service.mjs';
import { prepareAgentTurnContext } from './agent-context-preparation-service.mjs';
import { createInteractionService } from './agent-interaction-service.mjs';
import { createAgentRequestContextFlow } from './agent-request-context-flow.mjs';
import { agentSkillProviderService, IMAGEGEN_HOST_SKILL_ID } from './agent-skill-provider-service.mjs';
import { prepareAgentContext } from './agent-context-service.mjs';
import { loadTurnState } from './thread-turn-service.mjs';
import { NATIVE_AGENT_INSTRUCTIONS } from './native-agent-instructions.mjs';
import {
  createConfirmationContinuationService,
  resolveRequestInteraction,
} from './agent-confirmation-continuation-service.mjs';
import {
  normalizeRecentFailedTask,
  mergeTopicMemory,
  generatedAssetsFromResult,
  enrichGeneratedAssetEvents,
  positiveInteger,
  reserveTaskExecution,
  createContinuationPruners,
  createAgentEventWriter,
} from './agent-runtime-pure-helpers.mjs';
import {
  buildRecoveryRecord as buildRecoveryRecordFromService,
  materializeRecoveryReference,
  resolveRecoveryReferences,
  createRecoveryTaskHandler,
} from './agent-recovery-routing-service.mjs';
import { createAgentContinuationFlow } from './agent-continuation-flow.mjs';
import { admitAgentRequest, getAgentRequestPreparedBindings } from './agent-request-admission-service.mjs';
import { createAgentContinuationStateService } from './agent-continuation-state-service.mjs';
import { createAgentRequestRuntimeContextsFromRequest, getAgentRequestRuntimeBindings } from './agent-request-runtime-context-service.mjs';
import { createAgentMainExecutionRegistryFromScope, buildAgentMainResultContexts } from './agent-main-execution-context-service.mjs';
import { prepareAgentRequestExecution } from './agent-request-preparation-orchestrator.mjs';
import {
  prepareAgentMainAgentState,
  validateMainAgentContinuationResponses,
  createAgentReferenceLookupContext,
  createAgentMainAgentReferenceState,
  applyAgentImageOperationResponse,
} from './agent-request-execution-context-service.mjs';
import {
  buildCanonicalAgentReferenceContext,
  normalizeAgentRuntimeReferenceContext,
} from './agent-reference-context-service.mjs';
import {
  createAgentRuntimeToolRegistry,
  createAgentRuntimeToolHandlers,
  createAgentRuntimeImageToolHandler,
  getAgentRuntimeModelTools,
} from './agent-runtime-tool-registry-service.mjs';
import { createAgentMainAgentResultFlow } from './agent-main-agent-result-flow.mjs';
import { resolveAgentResult } from './agent-result-resolution-service.mjs';
import { executeMainAgentTurn } from './agent-main-agent-execution-service.mjs';
import {
  runAgentRequestMainLoopFromRuntimeState,
  createMainAgentExecutionContext,
} from './agent-request-stream-run-service.mjs';
import { runAgentRequestFailureBoundaryFromState } from './agent-failure-flow.mjs';
import { normalizeAgentConversationMemory } from '../chat-message-persistence.mjs';
import {
  applyAgentAnalysisCheckpoint,
  recordAgentUserDecision,
  restoreAgentAnalysisSnapshot,
} from './agent-analysis.mjs';
import {
  resolveImageOperationResponse,
} from './clarification-state.mjs';
import {
  createAgentProgressTracker,
  createAgentToolResultEvents,
  startAgentImageGenerationHeartbeat,
} from './agent-loop.mjs';
import {
  assertExpectedSequence,
  assertSameAgentOperation,
  isAgentLifecycleEvent,
  resolveAgentIdentity,
} from './event-contract.mjs';
import { assertImageExecutionContract } from './image-runtime-contract.mjs';
import {
  registerActiveAgentRun,
  registerActiveAgentRunControl,
  getActiveAgentRun,
  settleActiveAgentRun,
  takeActiveAgentRunInputs,
  updateActiveAgentRun,
} from './active-run-registry.mjs';
import {
  claimConfirmationContinuation,
  hashEnvelopeValue,
} from './confirmation-continuation.mjs';
import { createAgentTodoExecutor } from './agent-todo-service.mjs';
import { effectiveProviderProtocol } from '../provider-config.mjs';
import { createLogger } from '../logger';
import {
  materializeSessionVisualAsset,
  readSessionVisualAsset,
} from './session-visual-assets.mjs';
import {
  contextEventFromAgentEvent,
} from './context-events.mjs';
import {
  hashPrompt,
  getLatestUserMessage,
} from './agent-request-validation.mjs';
import { createThreadJournalService } from './thread-journal-service.mjs';
import {
  commandUsage, isManagementCommand, parseSlashCommand,
} from './commands.mjs';
import {
  AGENT_DEFAULT_IMAGE_OPTIONS,
  AGENT_IMAGE_ASPECT_RATIO_IDS,
  AGENT_MAX_IMAGE_BATCH_COUNT,
  buildAgentImageGenerationRequests,
} from './image-options.mjs';
import {
  resolveCanvasImageTaskExecutionMode,
} from '../workspace-session-view.mjs';
import type { AgentContextEntity } from './context-reference.types';
import type {
  AgentRecoveryRecord,
} from './events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();
const confirmationContinuationService = createConfirmationContinuationService();
const resolveRequestInteractionAny: any = resolveRequestInteraction;
const continuationFlow = createAgentContinuationFlow({ interactionService: createInteractionService() });

type AgentSkillSource = 'manual_ui' | 'explicit_text' | 'user_confirmation' | 'recovery' | 'manual' | 'auto';

// Keep journal persistence behind the business-facing facade. The controller
// coordinates requests; it does not bind to the storage implementation.
const threadJournalService = createThreadJournalService();
const continuationState = createAgentContinuationStateService({
  threadJournal: threadJournalService,
  confirmationLedger: confirmationContinuationService,
  confirmationTtlMs: CONFIRMATION_TTL_MS,
} as any);
const mainAgentResultFlow = createAgentMainAgentResultFlow({ idFactory: () => randomUUID() });

const createTodoUpdateExecutor = () => createAgentTodoExecutor({ threadJournal: threadJournalService });

const { journalContexts, eventSinks, writeEvent } = createAgentEventWriter({ threadJournal: threadJournalService, encoder });

const { pruneConfirmationStore } = createContinuationPruners(continuationState);

export async function handlePost(request: NextRequest) {
  const admission = await admitAgentRequest({
    request, nextResponse: NextResponse, randomUUID, getLatestUserMessage,
    normalizeReferenceContext: normalizeAgentRuntimeReferenceContext,
    parseSlashCommand, isManagementCommand, commandUsage,
    handleManagementCommand: handleManagedCommand, loadThread: loadTurnState,
    createContextFlow: (options) => createAgentRequestContextFlow(options),
    prepareContext: (input) => prepareAgentContext({ ...input, skillProviderService: agentSkillProviderService }),
    normalizeRecentFailedTask, resolveAgentIdentity, continuationState,
    pruneConfirmationStore, assertSameAgentOperation, assertExpectedSequence,
    createLogger, createInteractionService,
    loadSkillContent: agentSkillProviderService.loadSkillContent.bind(agentSkillProviderService),
  });
  if (admission.response) return admission.response;
  const { body, runtimeReferenceContext, runId, sessionId, latestUserMessage,
    preparedSnapshot, journalTurnId, initialAgentIdentity,
    requestedRecoveryTaskId, contextLogger, interactionService } = admission;

  const { conversationIntent, contextEntities: preparedContextEntities, sessionVisualAssets, contextAuditEvents, requestHistoryRevision, requestUserMessageRevision, requestActiveWindowRevision, generatedImageHistory, recentFailedTask, selectedContextEntityIds, initialDeliveryPlan, initialContextResolution, initialWorkingContext, skillManifests, skillCatalogLoaded, providers, providerImageOptionProfiles, requestedInterfaceImageCount, resolvedChatSelection, resolvedChatProvider } = getAgentRequestPreparedBindings(preparedSnapshot);
  const contextEntities = preparedContextEntities as AgentContextEntity[];
  // Main Agent lifetime is bounded by provider completion, protocol budgets, or user cancellation.
  const runController = new AbortController();
  const runSignal = runController.signal;
  registerActiveAgentRun(runId, initialAgentIdentity);
  registerActiveAgentRunControl(runId, { cancel: () => runController.abort() });
  updateActiveAgentRun(runId, { threadId: sessionId, turnId: journalTurnId });
  const stream = new ReadableStream({
    async start(controller) {
      journalContexts.set(controller as unknown as object, {
        threadId: sessionId,
        turnId: journalTurnId,
        taskId: initialAgentIdentity.taskId,
        operationId: initialAgentIdentity.operationId,
        runId,
      });
      const taskId = initialAgentIdentity.taskId;
      const operationId = initialAgentIdentity.operationId;
      let emitTaskSnapshotCheckpointRef: any;
      let writeLifecycleEventRef: any;
      let directImageExecutionRef: any;
      const runtimeContexts = createAgentRequestRuntimeContextsFromRequest({ body, controller, sessionId, taskId, runId, operationId, journalTurnId, preparedIntent: conversationIntent.intent, initialContextResolution, initialWorkingContext, runtimeReferenceContext, requestedInterfaceImageCount, initialDeliveryPlan, normalizeReferenceContext: normalizeAgentRuntimeReferenceContext, buildReferenceContext: buildCanonicalAgentReferenceContext, selectedSkill: body.activeSkillId ? skillManifests.find((manifest) => manifest.id === body.activeSkillId) || null : null, reserveTaskExecution, emitTaskSnapshotCheckpoint: (...args: any[]) => emitTaskSnapshotCheckpointRef?.(...args), getIntent: () => intent, getSelectedSkill: () => selectedSkill, getWorkingContext: () => workingContext, getImageDeliveryPlan: () => imageDeliveryPlan, getDirectImageExecution: () => directImageExecutionRef, getRunReferenceContext: () => runReferenceContext, getAgentAnalysis: () => agentAnalysis, getRecoveryTaskIdForExecution: () => recoveryTaskIdForExecution, interactionService, contextLogger, normalizeConversationMemory: normalizeAgentConversationMemory, mergeTopicMemory, latestUserMessage, writeEvent, writeLifecycleEvent: (...args: any[]) => writeLifecycleEventRef?.(...args), request, runSignal, providers, providerImageOptionProfiles, buildRequests: buildAgentImageGenerationRequests, resolveExecutionMode: resolveCanvasImageTaskExecutionMode, materializeSessionVisualAsset, generatedAssetsFromResult, hashPrompt, startHeartbeat: (options) => startAgentImageGenerationHeartbeat(options), resolvedModel: resolvedChatSelection.model, requestHistoryRevision, requestUserMessageRevision, requestActiveWindowRevision, threadJournalService, updateActiveAgentRun, takeActiveAgentRunInputs, resolvedChatSelection, imagegenHostSkillId: IMAGEGEN_HOST_SKILL_ID, createProgressTracker: createAgentProgressTracker, initialAgentIdentity, eventDependencies: { contextEventFromAgentEvent, assertSameAgentOperation, isAgentLifecycleEvent }, getSkillContentHash: () => skillContentHash, getSelectedSkillRef: () => selectedSkill, skillContentRef: () => skillContent, imagegenHostContentRef: () => imagegenHostContent, setSkillContent: (value) => { skillContent = value; }, setSkillContentHash: (value) => { skillContentHash = value; }, setImagegenHostContent: (value) => { imagegenHostContent = value; }, setImagegenHostContentHash: (value) => { imagegenHostContentHash = value; }, stagedMainAgentMemoryPatchesRef: () => stagedMainAgentMemoryPatches, clearStagedMainAgentMemoryPatches: () => { stagedMainAgentMemoryPatches = []; }, flush: async () => eventSinks.get(controller as unknown as object)?.flush() });
      const runtimeBindings = getAgentRequestRuntimeBindings(runtimeContexts);
      let {
        intent, selectedSkill, skillSelectionMethod, skillCandidateIds,
        skillContent, skillContentHash, imagegenHostContent, imagegenHostContentHash,
        imagegenSkillOriginalBytes, imagegenSkillInjectedBytes, visualSkillOriginalBytes,
        visualSkillInjectedBytes, skillContentTruncated, imagegenLoaded, visualSkillLoaded,
        mainAgentRequestCount, directGenerateImageCall, directGenerateImageCallId,
        workingContextData, workingContext, executionReferenceImages,
        activeClarificationState, stagedMainAgentMemoryPatches, runReferenceContext,
        clarificationSubmissionKey,
        requestedImageCount, requestedTotalImageCount, requestedImageCountSource,
        imageDeliveryPlan, directImageExecution, lockedImageToolArgs,
        nativeGeneratedImageResult, nativeImageFailure, approvedConfirmation, executionKind,
        completedTaskIdentities, taskSnapshot, recoveryBaseRecord,
        imageOperation, targetReferenceId, mainAgentFailureCheckpoint, agentAnalysis,
        writeAgentAnalysisCheckpoint, preserveRecoveryRecordOnFailure,
        recoveryTaskIdForExecution, recoveryMode, recoveryDecision, recoveryRevisionMessage,
        toolCallRecords,
      } = runtimeBindings;
      let skillSource: AgentSkillSource | null = runtimeBindings.skillSource as AgentSkillSource | null;
      const {
        sourceUserMessageId, writeAgentDone, getTopicMemory, updateTopicMemory, commitMainAgentMemory,
        confirmationTaskIdentity, executionState, skillRuntimeContext, executeImagePayload,
        progressTracker, writeContextEvent, writeUserContextEvent, writeLifecycleEvent, emitTaskSnapshotCheckpoint,
        writeInteractionEvent, writeProgress, writeToolStartEvent, writeToolUpdateEvent, writeToolResultEvent,
        writeStampedAgentEvent, writeToolProgress,
        appendActivityText, commitCurrentActivity, emitIntentResolved, startMainAgentKeepalive,
      } = runtimeBindings;
      emitTaskSnapshotCheckpointRef = executionState.emitTaskSnapshotCheckpoint;
      writeLifecycleEventRef = writeLifecycleEvent;
      directImageExecutionRef = directImageExecution;
      const rootTaskId = () => taskId;
      const rootSourceUserMessageId = () => recoveryBaseRecord?.sourceUserMessageId
        || activeClarificationState?.sourceUserMessageId
        || sourceUserMessageId;
      const rootOriginalRequest = () => recoveryBaseRecord?.originalRequest
        || activeClarificationState?.originalRequest
        || latestUserMessage;
      const buildRecoveryRecord = ({
        stage,
        message,
        reason,
        retryable,
        status = 'failed',
        resumeRoute,
      }: {
        stage: string;
        message: string;
        reason?: string;
        retryable?: boolean;
        status?: 'failed' | 'cancelled';
        resumeRoute?: AgentRecoveryRecord['resumeRoute'];
      }) => buildRecoveryRecordFromService({
        stage,
        message,
        reason,
        retryable,
        status,
        resumeRoute,
        taskId: rootTaskId(),
        runId,
        operationId: progressTracker.snapshot().operationId,
        lastSequence: progressTracker.snapshot().lastSequence,
        sessionId,
        sourceUserMessageId,
        latestUserMessage,
        recoveryBaseRecord,
        activeClarificationState,
        intent,
        selectedSkill,
        skillContentHash,
        imageOperation,
        runReferenceContext,
        targetReferenceId,
        selectedContextEntityIds,
        taskSnapshot,
        recoveryMode,
        mainAgentFailureCheckpoint,
        toolCallRecords,
        completedTaskIdentities,
      }) as AgentRecoveryRecord;
      const { ensureSelectedSkillContent, ensureImagegenHostContent, assertLockedImageSkill } = skillRuntimeContext;
      const { normalizePublicProgress } = executionState;
      let currentActivity = null;
      let finalAssistantTextEmitted = '';
      const writeResolvedImageOptionUpdate = (toolCallId: string, result: any) => {
        const resolvedOptions = result?.resolvedImageOptions;
        const updates = [];
        if (resolvedOptions?.ratioFallback) updates.push(`当前模型不支持 ${resolvedOptions.requestedAspectRatio}，已使用 ${resolvedOptions.aspectRatio}`);
        if (resolvedOptions?.sizeFallback) updates.push(`当前模型不支持 ${resolvedOptions.requestedSize}，已使用 ${resolvedOptions.size}`);
        if (resolvedOptions?.qualityFallback) updates.push(`当前模型不支持 ${resolvedOptions.requestedQuality} 质量，已使用 ${resolvedOptions.quality}`);
        if (result?.partialFailureMessage) updates.push(result.partialFailureMessage);
        for (const message of updates) writeToolUpdateEvent(toolCallId, message);
      };
      const writeImageCompletionSummary = (result: any) => {
        const summary = buildImageCompletionSummary(result);
        if (summary) writeLifecycleEvent({ type: 'agent_completion_summary', ...progressTracker.stamp(), ...summary });
      };
      let failureBoundaryFinalized = false;
      try {
        writeUserContextEvent();
        writeLifecycleEvent({ type: 'agent_start', runId, ...progressTracker.stamp() });
        const preparationRuntimeState: any = {
          intent, selectedSkill, skillSelectionMethod, skillCandidateIds, skillSource,
          skillContent, skillContentHash, imagegenSkillOriginalBytes, imagegenSkillInjectedBytes,
          visualSkillOriginalBytes, visualSkillInjectedBytes, skillContentTruncated,
          imagegenLoaded, visualSkillLoaded, activeClarificationState, approvedConfirmation,
          runReferenceContext, executionReferenceImages, recoveryMode, recoveryDecision,
          recoveryBaseRecord, recoveryTaskIdForExecution, recoveryRevisionMessage,
          preserveRecoveryRecordOnFailure, imageOperation, targetReferenceId,
          taskSnapshot,
        };
        const preparation = await prepareAgentRequestExecution({
          body, state: preparationRuntimeState, providers, skillManifests, interactionService,
          continuationState, claimContinuation: claimConfirmationContinuation, assertLockedImageSkill,
          resolveRequestInteraction: resolveRequestInteractionAny, sessionId, runId, writeEvent,
          controller, contextLogger, latestUserMessage, progressTracker, contextEntities,
          sessionVisualAssets, generatedImageHistory, runtimeReferenceContext, recentFailedTask,
          requestedRecoveryTaskId, materializeRecoveryReference, resolveRecoveryReferences,
          continuationFlow, normalizeReferenceContext: normalizeAgentRuntimeReferenceContext,
          resolvedChatSelection, rootTaskId, randomUUID,
          applyImageOperationResponse: applyAgentImageOperationResponse,
          resolveImageOperationResponse, prepareMainAgentState: prepareAgentMainAgentState,
          hash: (value) => createHash('sha256').update(value).digest('hex'),
          imagegenHostSkillId: IMAGEGEN_HOST_SKILL_ID, recordAgentUserDecision,
          restoreAgentAnalysisSnapshot, emitTaskSnapshotCheckpoint, skillCatalogLoaded,
          createReferenceLookupContext: createAgentReferenceLookupContext,
          createReferenceState: createAgentMainAgentReferenceState,
          getSkillContentHash: () => runtimeContexts.state.skillContentHash || skillContentHash,
          writeLifecycleEvent, writeProgress, writeInteractionEvent, writeContextEvent,
          writeAgentDone, rootOriginalRequest, ensureImagegenHostContent, ensureSelectedSkillContent,
        });
        if (preparation.handled) return;
        ({ intent, selectedSkill, skillSelectionMethod, skillCandidateIds, skillSource, skillContent, skillContentHash, imagegenSkillOriginalBytes, imagegenSkillInjectedBytes, visualSkillOriginalBytes, visualSkillInjectedBytes, skillContentTruncated, imagegenLoaded, visualSkillLoaded, activeClarificationState, approvedConfirmation, runReferenceContext, executionReferenceImages, recoveryMode, recoveryDecision, recoveryBaseRecord, recoveryTaskIdForExecution, recoveryRevisionMessage, preserveRecoveryRecordOnFailure, imageOperation, targetReferenceId, taskSnapshot } = preparationRuntimeState);
        if (selectedSkill && !String(skillContentHash || runtimeContexts.state.skillContentHash || '').trim()) {
          throw Object.assign(new Error('The selected Skill could not be locked'), {
            code: 'skill_lock_failed',
            failureStage: 'skill_selection',
            retryable: false,
            skillId: selectedSkill.id,
          });
        }
        const { contextEntityById, runtimeReferenceById, validateContextIds } = preparation;
        const preparationState = preparation.preparationState;
        let { mainAgentInputMessages, mainAgentReferenceContext, mainAgentReferenceImages, initiallyAttachedVisualIds, loadedVisualReferenceIds, recoveryRecord, recoveryCandidateForAgent, resolveVisualReferences } = preparationRuntimeState;
        const { mainAgentLoopState, relevantContextCandidateIds, analysisDefaults, selectedContextResponse, confirmedSkillResponse, savedMainAgentLoop } = preparationState;
        agentAnalysis = preparationState.getAgentAnalysis();
        writeAgentAnalysisCheckpoint = preparationState.writeAgentAnalysisCheckpoint;
        const ref = (_name: string, get: () => any, set: (value: any) => void) => ({ get, set });
        const { registry: mainAgentRegistry } = createAgentMainExecutionRegistryFromScope({ createMainAgentExecutionContext, createAgentRuntimeToolHandlers, createAgentRuntimeToolRegistry, createAgentRuntimeImageToolHandler, createRecoveryTaskHandler, createTodoUpdateExecutor, body, contextEntities, contextEntityById, relevantContextCandidateIds, initiallyAttachedVisualIds, sessionVisualAssets, sessionId, resolveVisualReferences, readSessionVisualAsset, writeEvent, controller, runtimeReferenceById, runReferenceContext, loadedVisualReferenceIds, validateContextIds, getTopicMemory, normalizeConversationMemory: normalizeAgentConversationMemory, mergeTopicMemory, stagedMainAgentMemoryPatches, mainAgentLoopState, analysisDefaults, applyAnalysisCheckpoint: applyAgentAnalysisCheckpoint, writeAgentAnalysisCheckpoint, writeProgress, contextLogger, runId, threadJournalService, recoveryCandidateForAgent, recoveryRecord, skillManifests, ensureSelectedSkillContent, messages: body.messages, skillCatalogLoaded, skillSelectionMethod, imagegenLoaded, visualSkillLoaded, recoveryMode, recoveryDecision, approvedConfirmation, generatedImageHistory, contextAuditEvents, writeLifecycleEvent, writeToolProgress, emitIntentResolved, hashPrompt, normalizePublicProgress, positiveInteger, assertImageExecutionContract, assertLockedImageSkill, executeImagePayload, generatedAssetsFromResult, imageOptions: { AGENT_DEFAULT_IMAGE_OPTIONS, AGENT_IMAGE_ASPECT_RATIO_IDS, AGENT_MAX_IMAGE_BATCH_COUNT }, runSignal, toolCallRecords, rootTaskId, refs: { intent: ref('intent', () => intent, (v) => { intent = v; }), selectedSkill: ref('selectedSkill', () => selectedSkill, (v) => { selectedSkill = v; }), agentAnalysis: ref('agentAnalysis', () => agentAnalysis, (v) => { agentAnalysis = v; }), skillContent: ref('skillContent', () => skillContent, (v) => { skillContent = v; }), skillContentHash: ref('skillContentHash', () => skillContentHash, (v) => { skillContentHash = v; }), imageOperation: ref('imageOperation', () => imageOperation, (v) => { imageOperation = v; }), recoveryDecision: ref('recoveryDecision', () => recoveryDecision, (v) => { recoveryDecision = v; }), recoveryBaseRecord: ref('recoveryBaseRecord', () => recoveryBaseRecord, (v) => { recoveryBaseRecord = v; }), recoveryTaskIdForExecution: ref('recoveryTaskIdForExecution', () => recoveryTaskIdForExecution, (v) => { recoveryTaskIdForExecution = v; }), recoveryRevisionMessage: ref('recoveryRevisionMessage', () => recoveryRevisionMessage, (v) => { recoveryRevisionMessage = v; }), targetReferenceId: ref('targetReferenceId', () => targetReferenceId, (v) => { targetReferenceId = v; }), skillSource: ref('skillSource', () => skillSource, (v) => { skillSource = v; }), lockedImageToolArgs: ref('lockedImageToolArgs', () => lockedImageToolArgs, (v) => { lockedImageToolArgs = v; }), requestedTotalImageCount: ref('requestedTotalImageCount', () => requestedTotalImageCount, (v) => { requestedTotalImageCount = v; }), requestedImageCount: ref('requestedImageCount', () => requestedImageCount, (v) => { requestedImageCount = v; }), requestedImageCountSource: ref('requestedImageCountSource', () => requestedImageCountSource, (v) => { requestedImageCountSource = v; }), executionKind: ref('executionKind', () => executionKind, (v) => { executionKind = v; }), imageDeliveryPlan: ref('imageDeliveryPlan', () => imageDeliveryPlan, (v) => { imageDeliveryPlan = v; }), directImageExecution: ref('directImageExecution', () => directImageExecution, (v) => { directImageExecution = v; }), workingContextData: ref('workingContextData', () => workingContextData, (v) => { workingContextData = v; }), workingContext: ref('workingContext', () => workingContext, (v) => { workingContext = v; }), runReferenceContext: ref('runReferenceContext', () => runReferenceContext, (v) => { runReferenceContext = v; }), executionReferenceImages: ref('executionReferenceImages', () => executionReferenceImages, (v) => { executionReferenceImages = v; }), nativeGeneratedImageResult: ref('nativeGeneratedImageResult', () => nativeGeneratedImageResult, (v) => { nativeGeneratedImageResult = v; }), nativeImageFailure: ref('nativeImageFailure', () => nativeImageFailure, (v) => { nativeImageFailure = v; }), directGenerateImageCall: ref('directGenerateImageCall', () => directGenerateImageCall, (v) => { directGenerateImageCall = v; }), directGenerateImageCallId: ref('directGenerateImageCallId', () => directGenerateImageCallId, (v) => { directGenerateImageCallId = v; }), mainAgentInputMessages: ref('mainAgentInputMessages', () => mainAgentInputMessages, (v) => { mainAgentInputMessages = v; }), mainAgentReferenceContext: ref('mainAgentReferenceContext', () => mainAgentReferenceContext, (v) => { mainAgentReferenceContext = v; }), mainAgentReferenceImages: ref('mainAgentReferenceImages', () => mainAgentReferenceImages, (v) => { mainAgentReferenceImages = v; }) } });
        const analysisCheckpointResume = preparationState.analysisCheckpointResume;
        if (analysisCheckpointResume && agentAnalysis) agentAnalysis.status = 'analyzing';
        validateMainAgentContinuationResponses({
          savedMainAgentLoop, selectedContextResponse, confirmedSkillResponse,
          contextEntityById, selectedSkill, imageOperation,
          permittedContextOptionIds: (body.clarificationRequest?.options || []).map((option) => option.id),
          setTargetReferenceId: (value) => { targetReferenceId = value; },
        });
        {
          const execution = await runAgentRequestMainLoopFromRuntimeState({
            executeMainAgentTurn, mainAgentRegistry, selectedSkill, approvedConfirmation,
            recoveryCandidateForAgent, recoveryRevisionMessage, agentAnalysis, relevantContextCandidateIds,
            incrementRequestCount: () => { mainAgentRequestCount += 1; }, getAgentRuntimeModelTools,
            prepareAgentTurnContext, mainAgentReferenceImages, sessionId, latestUserMessage, body,
            imagegenHostContent, imagegenHostContentHash, skillContent, skillContentHash, skillManifests,
            runReferenceContext, recoveryBaseRecord, recoveryMode, resolvedChatSelection, resolvedChatProvider,
            effectiveProviderProtocol, rootTaskId, operationId, runId, taskId, runSignal, nativeGeneratedImageResult,
            toolCallRecords, materializeSessionVisualAsset, readSessionVisualAsset, sessionVisualAssets,
            imagegenHostSkillId: IMAGEGEN_HOST_SKILL_ID, nativeAgentInstructions: NATIVE_AGENT_INSTRUCTIONS,
            runMainAgent: runMainAgentFlow, startKeepalive: startMainAgentKeepalive, hashArguments: hashEnvelopeValue,
            canvasContext: body.canvasContext, journalTurnId, progressTracker, mainAgentRegistryForTools: mainAgentRegistry,
            interactionService, directGenerateImageCall, hashPrompt, mainAgentLoopState, writeLifecycleEvent,
            currentActivityRef: { get value() { return currentActivity; }, set value(value) { currentActivity = value; } },
            appendActivityText, commitCurrentActivity, writeToolStartEvent, writeToolResultEvent, eventSinks, controller,
            finalAssistantTextRef: { get value() { return finalAssistantTextEmitted; }, set value(value) { finalAssistantTextEmitted = typeof value === 'string' ? value : finalAssistantTextEmitted; } },
            writeToolUpdateEvent, contextLogger,
            buildResultContexts: buildAgentMainResultContexts,
            resultContextArgs: {
              agentAnalysis, rootTaskId, runId, operationId, checkpoint: progressTracker.snapshot(),
              skillSource, selectedSkill, mainAgentLoopState, stagedMainAgentMemoryPatches,
              intent: body.intent === 'image' ? 'image' : 'chat', originalRequest: rootOriginalRequest(),
              executionReferenceImages, nativeGeneratedImageResult, approvedConfirmation,
              directGenerateImageCallId, directGenerateImageCall, nativeImageFailure, sessionId, taskId,
              activeClarificationState, runReferenceContext, workingContextData, latestUserMessage,
              body, resolvedChatSelection, lockedImageToolArgs, directImageExecution, contextEntityById,
              confirmationTaskIdentity, continuationState, rootOriginalRequest, rootSourceUserMessageId,
              writeInteractionEvent, writeProgress, writeToolProgress, writeAgentDone,
              writeResolvedImageOptionUpdate, writeStampedAgentEvent, writeImageCompletionSummary,
              createToolResultEvents: createAgentToolResultEvents, enrichGeneratedAssetEvents,
              updateTopicMemory, commitMainAgentMemory, emitIntentResolved, hashEnvelopeValue,
              confirmationTtlMs: CONFIRMATION_TTL_MS,
              getIntent: () => intent, setIntent: (value) => { intent = value; },
            }, mainAgentResultFlow, resolveAgentResult, resultDependencies: { mainAgentResultFlow, resolveAgentResult },
            refs: {
              intent: ref('intent', () => intent, (v) => { intent = v; }),
              selectedSkill: ref('selectedSkill', () => selectedSkill, (v) => { selectedSkill = v; }),
              skillSource: ref('skillSource', () => skillSource, (v) => { skillSource = v; }),
              skillContent: ref('skillContent', () => skillContent, (v) => { skillContent = v; }),
              skillContentHash: ref('skillContentHash', () => skillContentHash, (v) => { skillContentHash = v; }),
              imageOperation: ref('imageOperation', () => imageOperation, (v) => { imageOperation = v; }),
              targetReferenceId: ref('targetReferenceId', () => targetReferenceId, (v) => { targetReferenceId = v; }),
              lockedImageToolArgs: ref('lockedImageToolArgs', () => lockedImageToolArgs, (v) => { lockedImageToolArgs = v; }),
              requestedTotalImageCount: ref('requestedTotalImageCount', () => requestedTotalImageCount, (v) => { requestedTotalImageCount = v; }),
              requestedImageCount: ref('requestedImageCount', () => requestedImageCount, (v) => { requestedImageCount = v; }),
              requestedImageCountSource: ref('requestedImageCountSource', () => requestedImageCountSource, (v) => { requestedImageCountSource = v; }),
              executionKind: ref('executionKind', () => executionKind, (v) => { executionKind = v; }),
              imageDeliveryPlan: ref('imageDeliveryPlan', () => imageDeliveryPlan, (v) => { imageDeliveryPlan = v; }),
              directImageExecution: ref('directImageExecution', () => directImageExecution, (v) => { directImageExecution = v; }),
              workingContextData: ref('workingContextData', () => workingContextData, (v) => { workingContextData = v; }),
              workingContext: ref('workingContext', () => workingContext, (v) => { workingContext = v; }),
              runReferenceContext: ref('runReferenceContext', () => runReferenceContext, (v) => { runReferenceContext = v; }),
              executionReferenceImages: ref('executionReferenceImages', () => executionReferenceImages, (v) => { executionReferenceImages = v; }),
              nativeGeneratedImageResult: ref('nativeGeneratedImageResult', () => nativeGeneratedImageResult, (v) => { nativeGeneratedImageResult = v; }),
              nativeImageFailure: ref('nativeImageFailure', () => nativeImageFailure, (v) => { nativeImageFailure = v; }),
              directGenerateImageCall: ref('directGenerateImageCall', () => directGenerateImageCall, (v) => { directGenerateImageCall = v; }),
              directGenerateImageCallId: ref('directGenerateImageCallId', () => directGenerateImageCallId, (v) => { directGenerateImageCallId = v; }),
              visualSkillLoaded: ref('visualSkillLoaded', () => visualSkillLoaded, (v) => { visualSkillLoaded = v; }),
            },
          });
          const resultHandled = execution.resultHandled;
          if (resultHandled.handled) return;
        }

      } catch (error) {
        await runAgentRequestFailureBoundaryFromState({
          error,
          state: {
            clarificationSubmissionKey,
            continuationState,
            runSignal,
            executionKind,
            intent,
            bodyIntent: body.intent,
            selectedSkill,
            imageOperation,
            recoveryBaseRecord,
            preserveRecoveryRecordOnFailure,
            mainAgentFailureCheckpoint,
            buildRecoveryRecord,
            contextLogger,
            runId,
            taskId,
            directGenerateImageCallId,
            resolvedChatSelection,
            agentAnalysis,
            progressTracker,
            writeLifecycleEvent,
            settleActiveRun: () => settleActiveAgentRun(runId),
            eventSinks,
            controller,
          },
        });
        failureBoundaryFinalized = true;
      } finally {
        if (!failureBoundaryFinalized) {
          await runAgentRequestFailureBoundaryFromState({
            state: {
              settleActiveRun: () => settleActiveAgentRun(runId),
              eventSinks,
              controller,
            },
          });
        }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export async function handleGet(request: NextRequest) {
  return handleThreadReplay(request, { activeRunRegistry: { getActiveAgentRun } });
}
