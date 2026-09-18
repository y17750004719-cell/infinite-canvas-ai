/* Request-scoped execution state shared by the turn, tool, and response flows. */
export function createAgentRequestExecutionState(scope) {
  const {
    tracker,
    emit,
    contextEventFromAgentEvent,
    assertSameAgentOperation,
    isAgentLifecycleEvent,
    sessionId,
    runId,
    taskId,
    operationId,
    latestUserMessage,
    sourceUserMessageId,
    runtimeReferenceContext,
    requestHistoryRevision,
    requestUserMessageRevision,
    requestActiveWindowRevision,
    threadJournalService,
    journalTurnId,
    runSignal,
    contextLogger,
    updateActiveAgentRun,
    toolResultState,
    resolvedModel,
  } = scope;
  let nextContextSequence = Number(scope.nextContextSequence || 0);
  let currentActivity = null;
  let activitySequence = 0;
  let lastCommentaryItemId = '';
  let activeAgentStageLabel = '正在分析当前请求';
  let activeAgentStage = { label: activeAgentStageLabel, phase: 'analyzing', action: 'analyze_request' };
  let lastModelTaskDescription = '';
  let emittedIntent = null;
  let imagePublicProgress;
  const publicProgressByToolCallId = new Map();
  const announcedToolStarts = new Set();
  const settledToolCalls = new Set();

  const stamp = () => tracker.stamp();
  const toolItemId = (id) => `${runId}:tool:${id}`;
  const toolExecutionId = (id) => `${runId}:execution:${id}`;
  const toolEventMetadata = (id) => ({
    itemId: toolItemId(id), executionId: toolExecutionId(id),
    ...(lastCommentaryItemId ? { parentItemId: lastCommentaryItemId } : {}),
  });

  const writeContextEvent = (event) => {
    const mapped = contextEventFromAgentEvent(event, { sessionId });
    const events = Array.isArray(mapped) ? mapped : mapped ? [mapped] : [];
    for (const contextEvent of events) {
      nextContextSequence += 1;
      emit({ type: 'context_event', event: {
        ...contextEvent, sequence: nextContextSequence,
        historyRevision: requestHistoryRevision,
        userMessageRevision: requestUserMessageRevision,
        activeWindowRevision: requestActiveWindowRevision,
      } });
    }
  };
  const writeUserContextEvent = () => {
    nextContextSequence += 1;
    emit({ type: 'context_event', event: {
      eventId: `${sessionId}:user:${sourceUserMessageId}`, sessionId,
      sequence: nextContextSequence, turnId: runId, timestampMs: Date.now(),
      type: 'user_text', source: 'request', content: latestUserMessage,
      historyRevision: requestHistoryRevision, userMessageRevision: requestUserMessageRevision,
      activeWindowRevision: requestActiveWindowRevision,
    } });
    for (const reference of (runtimeReferenceContext?.references || []).filter((item) => item?.id && item?.src)) {
      nextContextSequence += 1;
      emit({ type: 'context_event', event: {
        eventId: `${sessionId}:image:${sourceUserMessageId}:${reference.id}`, sessionId,
        sequence: nextContextSequence, turnId: runId, timestampMs: Date.now(),
        type: 'image_input', source: reference.source || 'request', referenceId: reference.id,
        ...(reference.assetId ? { assetId: reference.assetId } : {}), ...(reference.src ? { src: reference.src } : {}),
        ...(reference.previewSrc ? { previewSrc: reference.previewSrc } : {}), role: reference.role,
        historyRevision: requestHistoryRevision, userMessageRevision: requestUserMessageRevision,
        activeWindowRevision: requestActiveWindowRevision,
      } });
    }
  };
  const writeLifecycleEvent = (event) => {
    if (!isAgentLifecycleEvent(event)) return emit(event);
    const input = event;
    const identity = tracker.snapshot();
    if (typeof input.operationId === 'string' && input.operationId !== identity.operationId) {
      assertSameAgentOperation(identity.operationId, input.operationId);
    }
    const hasIdentity = typeof input.taskId === 'string' && typeof input.runId === 'string'
      && typeof input.operationId === 'string' && Number.isFinite(Number(input.sequence));
    const stamped = hasIdentity ? input : { ...input, ...stamp() };
    emit(stamped);
    writeContextEvent(stamped);
  };
  const writeInteractionEvent = (event) => {
    const input = { ...event };
    if (input.state && typeof input.state === 'object' && scope.getSkillContentHash?.()) {
      input.state = { ...input.state, skillContentHash: scope.getSkillContentHash() };
    }
    const request = input.request && typeof input.request === 'object' ? { ...input.request } : undefined;
    const checkpoint = tracker.snapshot();
    const id = input.type === 'confirmation_required' ? String(request?.confirmationId || 'confirmation')
      : input.type === 'clarification_required' ? String(request?.id || 'clarification') : '';
    return writeLifecycleEvent({ ...input, ...(request ? { request: {
      ...request, taskId: String(request.taskId || checkpoint.taskId), operationId: String(request.operationId || checkpoint.operationId),
      ...(input.type === 'confirmation_required' ? { expectedSequence: Number(request.expectedSequence ?? checkpoint.lastSequence) } : { lastSequence: Number(request.lastSequence ?? checkpoint.lastSequence) }),
    } } : {}), ...(id ? { itemId: `${runId}:${input.type === 'confirmation_required' ? 'approval' : 'clarification'}:${id}` } : {}), ...stamp() });
  };
  const writeProgress = (input) => {
    if (input.status === 'active' && input.label && (!input.toolCallId || !settledToolCalls.has(input.toolCallId))) {
      activeAgentStageLabel = input.label;
      activeAgentStage = { label: input.label, phase: input.phase, action: input.action || activeAgentStage.action,
        ...(input.toolName ? { toolName: input.toolName } : {}), ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}) };
    }
    const independent = ['image_brief', 'image_prompt', 'image_contract', 'asset_delivery'].includes(input.stepId);
    return tracker.update({ ...input, ...(input.toolCallId ? (independent ? {
      itemId: `${runId}:${input.stepId}:${input.toolCallId}`, executionId: toolExecutionId(input.toolCallId), parentItemId: toolItemId(input.toolCallId),
    } : { ...toolEventMetadata(input.toolCallId) }) : {}) });
  };
  const emitTaskSnapshotCheckpoint = (snapshot) => {
    const identity = stamp();
    const checkpoint = { ...snapshot, operationId: identity.operationId, lastSequence: identity.sequence };
    writeLifecycleEvent({ type: 'agent_task_checkpoint', taskSnapshot: structuredClone(checkpoint), ...identity });
    return checkpoint;
  };
  const toolActionLabel = (name) => ({ generate_image: '正在整理图片合同', read_relevant_context: '正在读取相关上下文', load_visual_reference: '正在加载视觉参考' }[name] || `正在执行 ${name}`);
  const writeToolStartEvent = (toolCallId, toolName, args = {}, turnMetadata = {}) => {
    const key = `${toolCallId}:${toolName}`;
    if (announcedToolStarts.has(key)) return;
    announcedToolStarts.add(key);
    writeProgress({ stepId: toolName === 'generate_image' ? 'generate_image' : 'tool', phase: toolName === 'generate_image' ? 'checking' : 'reading', status: 'active', label: lastModelTaskDescription || toolActionLabel(toolName), action: toolName, toolCallId, toolName });
    writeLifecycleEvent({ type: 'tool_start', toolCallId, toolName, arguments: args, ...turnMetadata, action: toolName, ...toolEventMetadata(toolCallId), ...stamp() });
  };
  const writeToolUpdateEvent = (id, message) => writeLifecycleEvent({ type: 'tool_update', toolCallId: id, message, ...toolEventMetadata(id), ...stamp() });
  const writeToolResultEvent = (id, name, result, isError = false) => {
    settledToolCalls.add(id); lastCommentaryItemId = '';
    if (activeAgentStage.toolCallId === id) {
      activeAgentStageLabel = '正在等待模型响应';
      activeAgentStage = { label: activeAgentStageLabel, phase: 'analyzing', action: 'await_model_response' };
    }
    return writeLifecycleEvent({ type: 'tool_result', toolCallId: id, toolName: name, result, isError, ...toolEventMetadata(id), ...stamp() });
  };
  const rememberToolPublicProgress = (id, name, args) => {
    const raw = args && typeof args === 'object' ? args.publicProgress : undefined;
    if (!raw || typeof raw !== 'object') return undefined;
    const text = (key, max) => typeof raw[key] === 'string' ? raw[key].trim().slice(0, max) : '';
    const value = { activeLabel: text('activeLabel', 120), completedLabel: text('completedLabel', 120), completionSummary: text('completionSummary', 500), failedLabel: text('failedLabel', 120) };
    if (!Object.values(value).some(Boolean)) return undefined;
    publicProgressByToolCallId.set(id, value); if (name === 'generate_image') imagePublicProgress = value; return value;
  };
  const normalizePublicProgress = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value;
    const text = (key, max) => typeof raw[key] === 'string' ? raw[key].trim().slice(0, max) : '';
    const progress = { activeLabel: text('activeLabel', 120), completedLabel: text('completedLabel', 120), completionSummary: text('completionSummary', 500), failedLabel: text('failedLabel', 120) };
    return Object.values(progress).some(Boolean) ? progress : undefined;
  };
  const copyToolPublicProgress = (id, value, name = '') => { if (!id || !value) return; publicProgressByToolCallId.set(id, value); if (name === 'generate_image') imagePublicProgress = value; };
  const appendActivityText = (activityId, delta) => {
    if (!delta) return;
    const identity = currentActivity?.sequence ? currentActivity : stamp();
    currentActivity = { activityId, text: `${currentActivity?.text || ''}${delta}`, ...identity };
    writeLifecycleEvent({ type: 'agent_activity_delta', activityId, delta, model: resolvedModel, ...identity });
  };
  const commitCurrentActivity = (message, disposition) => {
    const fullText = Array.isArray(message?.content) ? message.content.filter((p) => p?.type === 'text').map((p) => p.text || '').join('') : '';
    if (!currentActivity && !fullText) return;
    const id = currentActivity?.activityId || `${runId}-activity-${++activitySequence}`;
    if (fullText && (currentActivity?.text || '').length < fullText.length) appendActivityText(id, fullText.slice(currentActivity?.text.length || 0));
    if (currentActivity?.text) {
      if (disposition === 'commentary') lastModelTaskDescription = currentActivity.text.trim();
      lastCommentaryItemId = `commentary:${runId}:${id}`;
      writeLifecycleEvent({ type: 'agent_activity_commit', activityId: id, disposition: disposition || 'final', ...(disposition === 'commentary' ? { commentaryKind: 'model_task_description' } : {}), ...stamp() });
    }
    currentActivity = null;
  };
  const writeToolUpdate = ({ id, name, partialResult }) => {
    const detail = typeof partialResult === 'string' ? partialResult.trim().slice(0, 600) : '';
    writeToolUpdateEvent(id, detail); if (detail) writeProgress({ stepId: 'tool', phase: 'executing', status: 'active', label: detail, toolCallId: id, toolName: name, detail });
  };
  const writeToolProgress = (toolName, status, toolCallId, detail = '') => {
    const labels = { generate_image: '生成图片', read_relevant_context: '读取相关上下文', load_visual_reference: '加载视觉参考' };
    const label = labels[toolName] || toolName.replaceAll('_', ' ');
    updateActiveAgentRun?.(runId, { phase: status === 'waiting' ? 'waiting' : status === 'active' ? 'executing' : 'reasoning', nonInterruptible: status === 'active' && toolName === 'generate_image' });
    return writeProgress({ stepId: toolName === 'generate_image' ? 'generate_image' : 'tool', phase: toolName === 'generate_image' ? 'generating' : 'executing', status, label: `${status === 'completed' ? '' : '正在'}${label}${status === 'completed' ? '已完成' : ''}`, toolCallId, toolName, ...(detail ? { detail } : {}) });
  };
  const writeStampedAgentEvent = (event) => writeLifecycleEvent(event);
  const emitIntentResolved = (intent) => { if (emittedIntent === intent) return; emittedIntent = intent; emit({ type: 'intent_resolved', intent }); };
  const takeDurableRunInputs = async (delivery) => {
    const messages = scope.takeActiveAgentRunInputs(runId, delivery);
    if (messages.length) await threadJournalService.consumeThreadInputs(sessionId, { threadId: sessionId, turnId: journalTurnId, taskId, operationId, runId }, delivery);
    return messages;
  };
  const startMainAgentKeepalive = () => scope.startHeartbeat({ intervalMs: 10000, onPulse: (elapsedMs) => {
    if (runSignal?.aborted) return; writeProgress({ stepId: 'agent_analysis', phase: activeAgentStage.phase, status: 'active', label: activeAgentStage.label, action: activeAgentStage.action, detail: `已等待 ${Math.round(elapsedMs / 1000)} 秒` });
    void contextLogger?.info?.('main_agent.keepalive', 'Main Agent request is still active', { runId, taskId, elapsedMs });
  } });
  return {
    tracker, writeContextEvent, writeUserContextEvent, writeLifecycleEvent, writeInteractionEvent, writeProgress, emitTaskSnapshotCheckpoint,
    writeToolStartEvent, writeToolUpdateEvent, writeToolResultEvent, writeToolUpdate, writeToolProgress, writeStampedAgentEvent,
    rememberToolPublicProgress, normalizePublicProgress, copyToolPublicProgress, appendActivityText, commitCurrentActivity, emitIntentResolved,
    startMainAgentKeepalive, getExternalSteeringMessages: () => takeDurableRunInputs('steer'), getExternalFollowUpMessages: () => takeDurableRunInputs('follow_up'),
    toolEventMetadata, toolItemId, toolExecutionId, publicProgressByToolCallId,
    get currentActivity() { return currentActivity; }, set currentActivity(value) { currentActivity = value; },
    get lastCommentaryItemId() { return lastCommentaryItemId; }, get imagePublicProgress() { return imagePublicProgress; },
    get activeAgentStage() { return activeAgentStage; }, get hasMutationEvidence() { return toolResultState.hasMutationEvidence; },
    noteToolResult: (name, isError = false) => { if (!isError && name === 'generate_image') toolResultState.hasMutationEvidence = true; },
  };
}
