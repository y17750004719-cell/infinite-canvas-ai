import { resolveAgentConversationIntent, resolveImageDeliveryPlan } from './image-delivery-utils.mjs';
import { agentSkillProviderService } from './agent-skill-provider-service.mjs';
import { normalizeGeneratedImageHistory } from '../generated-image-history.mjs';
import { normalizeSessionVisualAssets } from './session-visual-asset-metadata.mjs';
import { normalizeCompactedWindows } from './context-events.mjs';
import { extractAgentImageCount, normalizeAgentImageCount } from './image-options.mjs';
import { isReferentialShorthand, resolveContextReference } from './context-reference.mjs';
import { migrationErrorMeta } from '../compatibility-gate.mjs';
import { buildWorkingContext } from './agent-request-validation.mjs';

const response = (payload, status) => ({ ok: false, response: { payload, status } });

/**
 * Builds the request-scoped context snapshot used by the agent loop.
 * This function intentionally does not mutate journal state or start provider work.
 */
export async function prepareAgentContext({ body, sessionId, latestUserMessage, runtimeReferenceContext, normalizedRecentFailedTask, skillProviderService = agentSkillProviderService }) {
  const inferredConversationIntent = resolveAgentConversationIntent(body.messages, Boolean(body.referenceImages?.length));
  const conversationIntent = body.intent === 'image' || body.intent === 'chat'
    ? { ...inferredConversationIntent, intent: body.intent }
    : inferredConversationIntent;
  const contextEntities = Array.isArray(body.contextEntities)
    ? body.contextEntities.filter((entity) => entity && typeof entity.id === 'string').slice(-200)
    : [];
  const sessionVisualAssets = normalizeSessionVisualAssets(body.sessionVisualAssets, { sessionId });
  const contextEvents = Array.isArray(body.contextEvents)
    ? body.contextEvents.filter((event) => event.sessionId === sessionId)
    : [];
  const contextAuditEvents = Array.isArray(body.contextHistory?.auditEvents)
    ? body.contextHistory.auditEvents.filter((event) => event.sessionId === sessionId)
    : contextEvents;
  const contextModelEvents = Array.isArray(body.contextHistory?.modelEvents)
    ? body.contextHistory.modelEvents.filter((event) => event.sessionId === sessionId)
    : contextEvents;
  const normalizeRevision = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
  };
  const incomingHistoryRevision = normalizeRevision(body.contextHistory?.historyRevision, contextAuditEvents.length);
  const incomingUserMessageRevision = normalizeRevision(
    body.contextHistory?.userMessageRevision,
    contextAuditEvents.filter((event) => event?.type === 'user_text').length,
  );
  const incomingActiveWindowRevision = normalizeRevision(
    body.contextHistory?.activeWindowRevision,
    normalizeRevision(body.contextHistory?.activeWindow?.summaryVersion),
  );
  const revisionChecks = [
    ['historyRevision', body.expectedHistoryRevision, incomingHistoryRevision],
    ['userMessageRevision', body.expectedUserMessageRevision, incomingUserMessageRevision],
    ['activeWindowRevision', body.expectedActiveWindowRevision, incomingActiveWindowRevision],
  ];
  for (const [name, expected, actual] of revisionChecks) {
    if (expected === undefined) continue;
    const normalizedExpected = Number(expected);
    if (!Number.isFinite(normalizedExpected) || normalizedExpected < 0 || Math.floor(normalizedExpected) !== normalizedExpected) {
      return response({ error: `Invalid expected ${name}`, code: 'invalid_revision' }, 400);
    }
    if (normalizedExpected !== actual) {
      return response({
        error: 'Session context revision conflict; reload the latest session and retry',
        code: 'revision_conflict',
        revision: { expected: normalizedExpected, actual, field: name },
      }, 409);
    }
  }
  const requestHistoryRevision = incomingHistoryRevision + 1;
  const requestUserMessageRevision = incomingUserMessageRevision + 1;
  const requestActiveWindowRevision = Math.max(incomingActiveWindowRevision, requestHistoryRevision);
  const persistedCompactedWindows = normalizeCompactedWindows(body.contextHistory?.compactionRecords, sessionId);
  let nextContextSequence = contextAuditEvents.reduce((max, event) => {
    const sequence = Number(event?.sequence);
    return Number.isFinite(sequence) ? Math.max(max, Math.floor(sequence)) : max;
  }, 0);
  const replayContext = {
    sessionId,
    events: contextModelEvents,
    auditEvents: contextAuditEvents,
    modelEvents: contextModelEvents,
    visualAssets: sessionVisualAssets,
    compactedWindows: persistedCompactedWindows,
    compactionRecords: Array.isArray(body.contextHistory?.compactionRecords) ? body.contextHistory.compactionRecords : [],
    messages: body.messages,
    mergeMessages: true,
    activeWindow: body.contextHistory?.activeWindow && body.contextHistory.activeWindow.sessionId === sessionId
      ? body.contextHistory.activeWindow
      : body.activeContextWindow && body.activeContextWindow.sessionId === sessionId
        ? body.activeContextWindow
        : undefined,
    historyRevision: incomingHistoryRevision,
    userMessageRevision: incomingUserMessageRevision,
    activeWindowRevision: incomingActiveWindowRevision,
  };
  const generatedImageHistory = normalizeGeneratedImageHistory(body.generatedImageHistory)
    .filter((entry) => entry.sessionId === sessionId)
    .slice(0, 200);
  const knownContextEntityIds = new Set(contextEntities.map((entity) => entity.id));
  const knownVisualReferenceIds = new Set([
    ...knownContextEntityIds,
    ...(runtimeReferenceContext?.references || []).map((reference) => reference.id),
  ]);
  const recentTask = normalizedRecentFailedTask || body.recentFailedTask || body.clarificationState?.recoveryRecord || null;
  const recentFailedTask = recentTask && recentTask.sessionId === sessionId
    ? {
        ...recentTask,
        contextEntityIds: Array.isArray(recentTask.contextEntityIds)
          ? recentTask.contextEntityIds.filter((id) => knownContextEntityIds.has(id)) : [],
        visualReferenceIds: Array.isArray(recentTask.visualReferenceIds)
          ? recentTask.visualReferenceIds.filter((id) => knownVisualReferenceIds.has(id)) : [],
      }
    : null;
  let selectedContextEntityIds = Array.isArray(body.selectedContextEntityIds)
    ? body.selectedContextEntityIds.filter((id) => typeof id === 'string').slice(0, 64)
    : [];
  const initialBriefSource = conversationIntent.brief || latestUserMessage;
  const rawUserCountResolution = extractAgentImageCount(latestUserMessage);
  const briefCountResolution = initialBriefSource === latestUserMessage ? rawUserCountResolution : extractAgentImageCount(initialBriefSource);
  const explicitBatchCountResolution = rawUserCountResolution.status !== 'none' ? rawUserCountResolution : briefCountResolution;
  const rawUserDeliveryPlan = resolveImageDeliveryPlan(latestUserMessage, rawUserCountResolution.count || 1);
  const briefDeliveryPlan = initialBriefSource === latestUserMessage ? rawUserDeliveryPlan : resolveImageDeliveryPlan(initialBriefSource, briefCountResolution.count || 1);
  const initialDeliveryPlan = rawUserDeliveryPlan.evidence.length > 0 ? rawUserDeliveryPlan : briefDeliveryPlan;
  const explicitBatchImageRequest = !body.activeSkillId && conversationIntent.intent === 'image' && initialDeliveryPlan.outputCount > 1;
  const shouldResolveInitialContext = !explicitBatchImageRequest || selectedContextEntityIds.length > 0 || isReferentialShorthand(latestUserMessage);
  const initialContextResolution = shouldResolveInitialContext
    ? resolveContextReference({ userMessage: latestUserMessage, entities: contextEntities, selectedEntityIds: selectedContextEntityIds })
    : { status: 'none', detected: false, confidence: 'none', candidates: [], entityIds: [] };
  const initialWorkingContext = initialContextResolution.status === 'resolved'
    ? buildWorkingContext(latestUserMessage, initialContextResolution)
    : buildWorkingContext(body.workingContext?.plainText || initialBriefSource);

  let skillManifests;
  let skillCatalogLoaded = false;
  const explicitSkillRequested = body.skillSelectionSource === 'manual_ui'
    || body.skillSelectionSource === 'explicit_text'
    || body.activeSkillExplicit === true;
  try {
    skillManifests = await skillProviderService.listSkillManifests();
    skillCatalogLoaded = true;
    if (explicitSkillRequested && !String(body.activeSkillId || '').trim()) {
      return response({
        error: 'Explicit Skill selection is missing; choose the Skill again',
        code: 'skill_lock_failed',
        failureStage: 'skill_selection',
        retryable: false,
      }, 409);
    }
    if (body.activeSkillId && !skillManifests.some((manifest) => manifest.id === body.activeSkillId)) {
      return response({ error: `Unknown skill: ${body.activeSkillId}`, code: 'skill_lock_failed', failureStage: 'skill_selection', retryable: false, skillId: body.activeSkillId }, 400);
    }
  } catch (error) {
    return response({
      error: error instanceof Error ? error.message : 'Invalid skill',
      code: error?.code || 'skill_lock_failed',
      failureStage: error?.failureStage || 'skill_selection',
      retryable: error?.retryable === true,
      ...(body.activeSkillId ? { skillId: body.activeSkillId } : {}),
    }, 400);
  }
  let providers;
  let providerSelection;
  try {
    providerSelection = await skillProviderService.prepareProviderSelection({ body, purpose: 'chat' });
    providers = providerSelection.providers;
  } catch (error) {
    const migrationMeta = migrationErrorMeta(error);
    if (migrationMeta) {
      return response({ error: error instanceof Error ? error.message : 'Migration required', ...migrationMeta }, 409);
    }
    throw error;
  }
  const providerImageOptionProfiles = providerSelection.providerImageOptionProfiles;
  const requestedInterfaceImageCount = normalizeAgentImageCount(body.imageOptions?.count);
  const requestedChatModel = body.chatOptions?.model || process.env.AGENT_CHAT_MODEL || undefined;
  const requestedChatProviderId = body.chatOptions?.providerId || process.env.AGENT_CHAT_PROVIDER_ID;
  const requestedIntent = body.intent === 'image' ? 'image' : null;
  const hasExplicitChatSelection = Boolean(body.chatOptions?.providerId || body.chatOptions?.model);
  const resolvedChatSelection = providerSelection.selection;
  const resolvedProviderSelection = providerSelection.resolvedSelection || null;
  if (!resolvedChatSelection.model || !resolvedChatSelection.providerId || resolvedProviderSelection?.validated === false) {
    return response({
      error: 'No enabled chat provider and model are configured',
      reason: 'model_unavailable',
      failureCode: resolvedProviderSelection?.providerId ? 'provider_capability_mismatch' : 'provider_selection_empty',
      retryable: false,
      providerId: resolvedProviderSelection?.providerId || null,
      model: resolvedProviderSelection?.model || null,
      protocol: resolvedProviderSelection?.protocol || null,
      capability: resolvedProviderSelection?.capability || 'chat',
      providerFingerprint: resolvedProviderSelection?.providerFingerprint || null,
    }, 400);
  }
  const resolvedChatProvider = providers.find((provider) => provider.id === resolvedChatSelection.providerId) || null;
  const resolvedChatModelMetadata = { ...(resolvedChatProvider || {}) };
  return {
    ok: true,
    value: {
      conversationIntent, contextEntities, sessionVisualAssets, contextEvents, contextAuditEvents, contextModelEvents,
      incomingHistoryRevision, incomingUserMessageRevision, incomingActiveWindowRevision,
      requestHistoryRevision, requestUserMessageRevision, requestActiveWindowRevision,
      persistedCompactedWindows, nextContextSequence, replayContext, generatedImageHistory,
      knownContextEntityIds, knownVisualReferenceIds, recentFailedTask, selectedContextEntityIds,
      initialBriefSource, rawUserCountResolution, briefCountResolution, explicitBatchCountResolution,
      rawUserDeliveryPlan, briefDeliveryPlan, initialDeliveryPlan, explicitBatchImageRequest,
      shouldResolveInitialContext, initialContextResolution, initialWorkingContext,
      skillManifests, skillCatalogLoaded, providers, providerImageOptionProfiles,
      requestedInterfaceImageCount, requestedChatModel, requestedChatProviderId, requestedIntent,
      hasExplicitChatSelection, resolvedChatSelection, resolvedProviderSelection, resolvedChatProvider, resolvedChatModelMetadata,
    },
  };
}
