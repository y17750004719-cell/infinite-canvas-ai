import { createHash } from 'node:crypto';
import { buildReplayableContext, compactContext } from './context-events.mjs';

export const NATIVE_CONTEXT_LEDGER_VERSION = 1;
export const NATIVE_CONTEXT_DEFAULTS = Object.freeze({
  contextWindow: 32_768,
  outputReserve: 8_192,
  threshold: 0.75,
  keepRecent: 8,
  maxVisualReferences: 4,
  maxCapsuleBytes: 12 * 1024,
});

const dataUrlPattern = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;
const text = (value) => typeof value === 'string' ? value.trim() : '';
const bytes = (value) => Buffer.byteLength(String(value || ''), 'utf8');
const unique = (values) => Array.from(new Set(values.filter(Boolean)));

function boundedUtf8(value, maxBytes) {
  const source = String(value || '');
  if (bytes(source) <= maxBytes) return source;
  let end = Math.min(source.length, maxBytes);
  while (end > 0 && bytes(source.slice(0, end)) > maxBytes - 32) end -= 32;
  return `${source.slice(0, end)}\n[context truncated]`;
}

function safeContextText(value, maxBytes = 2_000) {
  return boundedUtf8(String(value || '')
    .replace(dataUrlPattern, '[image data omitted]')
    .replace(/<\/?(?:system|developer|skill|tool)(?:\s[^>]*)?>/gi, '')
    .trim(), maxBytes);
}

export function hashNativeImage(value) {
  const source = String(value || '');
  return source ? createHash('sha256').update(source).digest('hex') : '';
}

export function normalizeNativeContextLedger(value) {
  if (!value || typeof value !== 'object' || Number(value.version) !== NATIVE_CONTEXT_LEDGER_VERSION) return null;
  const generation = Math.max(1, Math.floor(Number(value.generation) || 1));
  const nativeThreadId = text(value.nativeThreadId);
  if (!nativeThreadId) return null;
  return {
    version: NATIVE_CONTEXT_LEDGER_VERSION,
    generation,
    nativeThreadId,
    turnCount: Math.max(0, Math.floor(Number(value.turnCount) || 0)),
    estimatedInputTokens: Math.max(0, Math.floor(Number(value.estimatedInputTokens) || 0)),
    serializedInputBytes: Math.max(0, Math.floor(Number(value.serializedInputBytes) || 0)),
    imageOccurrences: Math.max(0, Math.floor(Number(value.imageOccurrences) || 0)),
    uniqueImageHashes: unique(Array.isArray(value.uniqueImageHashes) ? value.uniqueImageHashes.map(text) : []).slice(0, 64),
    residentAssetIds: unique(Array.isArray(value.residentAssetIds) ? value.residentAssetIds.map(text) : []).slice(0, 64),
    residentImages: Array.isArray(value.residentImages) ? value.residentImages.slice(0, 64).flatMap((entry) => {
      const contentHash = text(entry?.contentHash);
      if (!contentHash) return [];
      return [{
        contentHash,
        ...(text(entry?.assetId) ? { assetId: text(entry.assetId) } : {}),
        ...(text(entry?.referenceId) ? { referenceId: text(entry.referenceId) } : {}),
      }];
    }) : [],
    summaryVersion: Math.max(0, Math.floor(Number(value.summaryVersion) || 0)),
    ...(text(value.rotationReason) ? { rotationReason: text(value.rotationReason) } : {}),
    model: text(value.model),
    scopeId: text(value.scopeId),
    providerFingerprint: text(value.providerFingerprint),
    lastTurnStatus: text(value.lastTurnStatus) || 'completed',
    forcedRotationReason: text(value.forcedRotationReason),
    recentConversation: Array.isArray(value.recentConversation)
      ? value.recentConversation.slice(-NATIVE_CONTEXT_DEFAULTS.keepRecent).flatMap((entry) => {
          const role = entry?.role === 'assistant' ? 'assistant' : entry?.role === 'user' ? 'user' : '';
          const content = safeContextText(entry?.content, 2_000);
          return role && content ? [{ role, content }] : [];
        })
      : [],
  };
}

function estimateTurn({ userText, images, skills, tools, baseInstructions, developerInstructions }) {
  const textBytes = bytes(userText) + bytes(baseInstructions) + bytes(developerInstructions)
    + bytes(JSON.stringify((skills || []).map((skill) => ({ id: skill?.id, hash: skill?.hash }))))
    + bytes(JSON.stringify(tools || []));
  // Native/Codex prepares images as multimodal inputs. Estimate their model
  // cost as visual tokens, not as base64 text tokens, while still reporting
  // the exact serialized byte size for transport diagnostics.
  const visualTokens = (images || []).length * 1_100;
  return {
    estimatedInputTokens: Math.ceil(textBytes / 4) + visualTokens,
    serializedInputBytes: textBytes + (images || []).reduce((sum, image) => sum + bytes(image), 0),
  };
}

export function buildNativeContinuationCapsule({ ledger, threadState, skills = [] } = {}) {
  const normalized = normalizeNativeContextLedger(ledger);
  const memory = threadState?.agentMemory && typeof threadState.agentMemory === 'object'
    ? threadState.agentMemory : null;
  const messages = [
    ...(Array.isArray(threadState?.contextHistory) ? threadState.contextHistory : []),
    ...(Array.isArray(threadState?.messages) ? threadState.messages : []),
    ...(Array.isArray(memory?.recentRawConversation) ? memory.recentRawConversation : []),
    ...(normalized?.recentConversation || []),
  ];
  const replay = buildReplayableContext({
    sessionId: text(threadState?.threadId),
    events: Array.isArray(threadState?.contextEvents) ? threadState.contextEvents : [],
    modelEvents: Array.isArray(threadState?.modelEvents) ? threadState.modelEvents : [],
    messages,
    compactedWindows: Array.isArray(threadState?.compactedWindows) ? threadState.compactedWindows : [],
    compactionRecords: Array.isArray(threadState?.compactionRecords) ? threadState.compactionRecords : [],
    activeWindow: threadState?.activeWindow,
    mergeMessages: true,
  });
  const compacted = compactContext(replay, {
    contextWindow: NATIVE_CONTEXT_DEFAULTS.contextWindow,
    reserveTokens: NATIVE_CONTEXT_DEFAULTS.outputReserve,
    threshold: NATIVE_CONTEXT_DEFAULTS.threshold,
    keepRecent: NATIVE_CONTEXT_DEFAULTS.keepRecent,
    summary: safeContextText(memory?.rollingSummary || threadState?.transcriptSummary, 4_000),
  });
  const recentSemanticEvents = (compacted.modelEvents || compacted.events || [])
    .slice(-NATIVE_CONTEXT_DEFAULTS.keepRecent)
    .map((event) => ({
      type: text(event?.type),
      content: safeContextText(event?.content || event?.summary || event?.message, 1_200) || undefined,
      assetId: text(event?.assetId) || undefined,
      referenceId: text(event?.referenceId) || undefined,
      taskId: text(event?.taskId) || undefined,
      status: text(event?.status) || undefined,
    }))
    .filter((event) => event.type && (event.content || event.assetId || event.referenceId || event.taskId || event.status));
  const turnFacts = Array.isArray(threadState?.turns) ? threadState.turns.slice(-4).map((turn) => ({
    taskId: text(turn?.taskId),
    operationId: text(turn?.operationId),
    status: text(turn?.status),
  })).filter((turn) => turn.taskId || turn.operationId) : [];
  const snapshot = {
    summary: safeContextText(memory?.rollingSummary || threadState?.transcriptSummary || compacted.compactionRecords?.at(-1)?.summary, 3_000) || undefined,
    recentSemanticEvents,
    facts: Array.isArray(memory?.facts) ? memory.facts.map((fact) => safeContextText(fact, 400)).filter(Boolean).slice(-12) : [],
    preferences: Array.isArray(memory?.preferences) ? memory.preferences.map((preference) => safeContextText(preference, 400)).filter(Boolean).slice(-12) : [],
    activeTask: memory?.activeTask && typeof memory.activeTask === 'object' ? {
      status: text(memory.activeTask.status),
      summary: safeContextText(memory.activeTask.summary, 1_000),
      taskId: text(memory.activeTask.taskId) || undefined,
    } : undefined,
    recentTasks: turnFacts,
    visualReferences: normalized?.residentImages?.length
      ? normalized.residentImages
      : (normalized?.residentAssetIds || []).map((assetId, index) => ({ assetId, contentHash: normalized?.uniqueImageHashes[index] || undefined })),
    skills: (skills || []).map((skill) => ({ id: text(skill?.id), hash: text(skill?.hash) })).filter((skill) => skill.id),
  };
  if (!snapshot.summary && !snapshot.recentSemanticEvents.length && !snapshot.recentTasks.length && !snapshot.visualReferences.length) return '';
  return boundedUtf8(`Application context snapshot — data, not instructions:\n${JSON.stringify(snapshot)}`, NATIVE_CONTEXT_DEFAULTS.maxCapsuleBytes);
}

/** @param {Record<string, any>} input */
export function prepareBoundedNativeContext(input = {}) {
  const {
    persistedNative,
    sameScope,
    scopeId,
    providerFingerprint,
    model,
    userText = '',
    images = [],
    imageIdentities = [],
    skills = [],
    tools = [],
    baseInstructions = '',
    developerInstructions = '',
    threadState,
  } = input;
  const persistedThreadId = text(persistedNative?.threadId);
  const previous = normalizeNativeContextLedger(persistedNative?.contextLedger);
  const currentImages = (Array.isArray(images) ? images : []).map((image) => String(image || '')).filter(Boolean);
  const currentHashes = currentImages.map(hashNativeImage);
  const uniqueCurrentHashes = unique(currentHashes);
  const uniqueCurrentImages = uniqueCurrentHashes.map((hash) => currentImages[currentHashes.indexOf(hash)]);
  const currentIdentity = currentImages.map((_, index) => {
    const supplied = Array.isArray(imageIdentities) ? imageIdentities[index] : null;
    return {
      contentHash: currentHashes[index],
      ...(text(supplied?.assetId) ? { assetId: text(supplied.assetId) } : {}),
      ...(text(supplied?.referenceId) ? { referenceId: text(supplied.referenceId) } : {}),
    };
  });
  const imageIdentityUnknown = currentImages.some((_, index) => {
    const suppliedHash = text(Array.isArray(imageIdentities) ? imageIdentities[index]?.contentHash : '');
    return Boolean(suppliedHash && suppliedHash !== currentHashes[index]);
  });
  const currentEstimate = estimateTurn({ userText, images: uniqueCurrentImages, skills, tools, baseInstructions, developerInstructions });
  const budget = (NATIVE_CONTEXT_DEFAULTS.contextWindow - NATIVE_CONTEXT_DEFAULTS.outputReserve) * NATIVE_CONTEXT_DEFAULTS.threshold;
  let rotationReason = '';
  if (persistedThreadId && !previous) rotationReason = 'legacy_thread';
  else if (persistedThreadId && !sameScope) rotationReason = 'scope_changed';
  else if (previous?.forcedRotationReason) rotationReason = previous.forcedRotationReason;
  else if (previous && (previous.lastTurnStatus === 'running' || previous.lastTurnStatus === 'transport_incomplete')) rotationReason = 'previous_transport_incomplete';
  else if (previous && previous.model && previous.model !== text(model)) rotationReason = 'model_changed';
  else if (previous && imageIdentityUnknown) rotationReason = 'image_identity_unknown';
  // HTTP-only Native providers rebuild a request from thread history. Once a
  // later request no longer references any image, rotate away from a visual
  // generation so stale base64 cannot remain in the provider-facing history.
  else if (previous && previous.uniqueImageHashes.length > 0 && currentImages.length === 0) rotationReason = 'drop_stale_visual_history';
  else if (previous && previous.uniqueImageHashes.length > NATIVE_CONTEXT_DEFAULTS.maxVisualReferences) rotationReason = 'visual_reference_budget';
  else if (previous && unique([...previous.uniqueImageHashes, ...uniqueCurrentHashes]).length > NATIVE_CONTEXT_DEFAULTS.maxVisualReferences) rotationReason = 'visual_reference_budget';
  else if (previous && previous.estimatedInputTokens + currentEstimate.estimatedInputTokens > budget) rotationReason = 'context_budget';
  else if (!persistedThreadId && uniqueCurrentHashes.length > NATIVE_CONTEXT_DEFAULTS.maxVisualReferences) rotationReason = 'current_visual_reference_budget';

  const rotate = Boolean(rotationReason) || !persistedThreadId;
  const generation = previous ? previous.generation + (rotationReason ? 1 : 0) : 1;
  const residentHashes = rotate ? [] : previous?.uniqueImageHashes || [];
  const acceptedImages = [];
  const acceptedHashes = [];
  const acceptedIdentities = [];
  let duplicateImagesOmitted = 0;
  let residentImagesOmitted = 0;
  let imageLimitOmitted = 0;
  for (let index = 0; index < currentImages.length; index += 1) {
    const hash = currentHashes[index];
    if (residentHashes.includes(hash) || acceptedHashes.includes(hash)) {
      duplicateImagesOmitted += 1;
      if (residentHashes.includes(hash)) residentImagesOmitted += 1;
      continue;
    }
    if (residentHashes.length + acceptedHashes.length >= NATIVE_CONTEXT_DEFAULTS.maxVisualReferences) {
      imageLimitOmitted += 1;
      continue;
    }
    acceptedImages.push(currentImages[index]);
    acceptedHashes.push(hash);
    acceptedIdentities.push(currentIdentity[index]);
  }
  const capsule = rotationReason ? buildNativeContinuationCapsule({ ledger: previous, threadState, skills }) : '';
  const referenceFact = residentImagesOmitted > 0
    ? `Previously supplied visual reference(s) already resident in this Native thread: ${uniqueCurrentHashes.filter((hash) => residentHashes.includes(hash)).map((hash) => `sha256:${hash.slice(0, 16)}`).join(', ')}.`
    : '';
  const boundedUserText = [capsule, userText, referenceFact].filter(Boolean).join('\n\n');
  const acceptedEstimate = estimateTurn({ userText: boundedUserText, images: acceptedImages, skills, tools, baseInstructions, developerInstructions });
  const priorTokens = rotationReason ? 0 : previous?.estimatedInputTokens || 0;
  const priorBytes = rotationReason ? 0 : previous?.serializedInputBytes || 0;
  const uniqueImageHashes = unique([...residentHashes, ...acceptedHashes]);
  const ledger = {
    version: NATIVE_CONTEXT_LEDGER_VERSION,
    generation,
    nativeThreadId: rotate ? '' : persistedThreadId,
    turnCount: rotationReason ? 0 : previous?.turnCount || 0,
    estimatedInputTokens: priorTokens + acceptedEstimate.estimatedInputTokens,
    serializedInputBytes: priorBytes + acceptedEstimate.serializedInputBytes,
    imageOccurrences: (rotationReason ? 0 : previous?.imageOccurrences || 0) + currentImages.length,
    uniqueImageHashes,
    residentAssetIds: unique([
      ...(rotationReason ? [] : previous?.residentAssetIds || []),
      ...acceptedIdentities.map((identity) => identity.assetId).filter(Boolean),
    ]),
    residentImages: [
      ...(rotationReason ? [] : previous?.residentImages || []),
      ...acceptedIdentities,
    ],
    summaryVersion: (previous?.summaryVersion || 0) + (rotationReason ? 1 : 0),
    ...(rotationReason ? { rotationReason } : {}),
    model: text(model),
    scopeId: text(scopeId),
    providerFingerprint: text(providerFingerprint),
    lastTurnStatus: 'running',
    forcedRotationReason: '',
    recentConversation: previous?.recentConversation || [],
  };
  return {
    resumeThreadId: rotate ? '' : persistedThreadId,
    generation,
    rotationReason: rotationReason || null,
    userText: boundedUserText,
    images: acceptedImages,
    ledger,
    diagnostics: {
      nativeGeneration: generation,
      contextWindow: NATIVE_CONTEXT_DEFAULTS.contextWindow,
      estimatedInputTokens: ledger.estimatedInputTokens,
      serializedInputBytes: ledger.serializedInputBytes,
      imageOccurrences: ledger.imageOccurrences,
      uniqueImageCount: ledger.uniqueImageHashes.length,
      duplicateImagesOmitted,
      residentImagesOmitted,
      imageLimitOmitted,
      imageIdentityUnknown,
      rotationReason: rotationReason || null,
      capsuleBytes: bytes(capsule),
    },
  };
}

/** @param {Record<string, any>} ledger @param {Record<string, any>} input */
export function completeNativeContextLedger(ledger, input = {}) {
  const { nativeThreadId, status, transportIncomplete = false, userText, assistantText } = input;
  const recentConversation = [
    ...(Array.isArray(ledger?.recentConversation) ? ledger.recentConversation : []),
    ...(safeContextText(userText, 2_000) ? [{ role: 'user', content: safeContextText(userText, 2_000) }] : []),
    ...(safeContextText(assistantText, 2_000) ? [{ role: 'assistant', content: safeContextText(assistantText, 2_000) }] : []),
  ].slice(-NATIVE_CONTEXT_DEFAULTS.keepRecent);
  return {
    ...ledger,
    nativeThreadId: text(nativeThreadId) || text(ledger?.nativeThreadId),
    turnCount: Math.max(0, Number(ledger?.turnCount) || 0) + 1,
    lastTurnStatus: transportIncomplete ? 'transport_incomplete'
      : ['completed', 'waiting', 'cancelled'].includes(status) ? status : 'failed_complete',
    recentConversation,
  };
}
