/**
 * Converts a Native Main Agent stop result into an application continuation
 * result.  This module deliberately has no journal, stream, or persistence
 * dependencies; callers own those side effects through the returned value.
 */
export function createAgentMainAgentResultFlow({ idFactory = () => crypto.randomUUID() } = {}) {
  return {
    resolve({ loopResult, context = {} } = {}) {
      if (!loopResult || typeof loopResult !== 'object') {
        return { status: 'failed', error: new Error('Missing Main Agent loop result') };
      }
      const confirmation = loopResult.confirmation;
      if (loopResult.stopReason !== 'confirmation_required' || !confirmation) {
        return { status: 'completed', loopResult };
      }

      const rootTaskId = String(context.rootTaskId || context.taskId || '');
      const runId = String(context.runId || '');
      const operationId = String(context.operationId || '');
      const checkpoint = context.checkpoint || {};
      const skillSource = context.skillSource;
      const selectedSkill = context.selectedSkill;
      const mainAgentLoopState = context.mainAgentLoopState || {};
      const baseState = {
        taskId: rootTaskId,
        operationId: checkpoint.operationId || operationId,
        skillSource,
        lastSequence: checkpoint.lastSequence,
        ...(selectedSkill ? { skillId: selectedSkill.id, skillRead: mainAgentLoopState.skillRead } : {}),
        ...(context.intent ? { intent: context.intent } : {}),
        ...(context.originalRequest ? { originalRequest: context.originalRequest } : {}),
        ...(context.referenceImages ? { referenceImages: context.referenceImages } : {}),
      };

      if (confirmation.toolName === 'request_user_decision') {
        const args = confirmation.arguments || confirmation.clarification || {};
        const recommended = String(args.recommendedOptionId || '');
        const request = {
          id: idFactory(),
          taskId: rootTaskId,
          question: String(args.question || confirmation.message || ''),
          dimension: String(args.dimension || 'general'),
          options: (Array.isArray(args.options) ? args.options : []).map((option) => ({
            id: String(option?.id || ''),
            label: `${String(option?.label || '')}${String(option?.id || '') === recommended ? '（推荐）' : ''}`,
            answer: String(option?.answer || ''),
            description: String(option?.description || ''),
          })),
          allowCustom: true,
          allowProceed: false,
        };
        return {
          status: 'pending',
          kind: 'clarification',
          reason: 'user_decision_required',
          request,
          state: {
            ...baseState,
            askedDimensions: [request.dimension],
            mainAgentLoop: buildLoopSnapshot(loopResult, confirmation, 'request_user_decision', mainAgentLoopState),
          },
        };
      }

      if (confirmation.toolName === 'request_context_selection') {
        const candidates = Array.isArray(confirmation.candidates) ? confirmation.candidates : [];
        const request = {
          id: idFactory(),
          taskId: rootTaskId,
          question: String(confirmation.message || '请选择要使用的历史图片。'),
          dimension: 'context_reference',
          options: candidates.map((candidate) => ({
            id: String(candidate?.id || ''),
            label: String(candidate?.label || ''),
            answer: `选择上下文实体 ${String(candidate?.id || '')}`,
            description: String(candidate?.kind || ''),
          })),
          allowCustom: false,
          allowProceed: false,
        };
        return {
          status: 'pending',
          kind: 'context_selection',
          reason: 'context_reference_required',
          request,
          candidates,
          state: {
            ...baseState,
            askedDimensions: ['context_reference'],
            contextCandidates: candidates,
            mainAgentLoop: buildLoopSnapshot(loopResult, confirmation, String(confirmation.toolName || ''), mainAgentLoopState),
          },
        };
      }

      const confirmationId = idFactory();
      const toolName = String(confirmation.toolName || '');
      const toolCallId = String(confirmation.toolCallId || `${runId}-${toolName}-confirmation`);
      const toolArgs = confirmation.arguments && typeof confirmation.arguments === 'object'
        ? confirmation.arguments
        : {};
      return {
        status: 'pending',
        kind: 'confirmation',
        reason: 'awaiting_confirmation',
        confirmation: {
          confirmationId,
          toolName,
          toolCallId,
          toolArgs,
          message: String(confirmation.message || `确认后执行 ${toolName}`),
          taskId: rootTaskId,
          operationId: checkpoint.operationId || operationId,
          runId,
          lastSequence: checkpoint.lastSequence,
        },
        state: {
          ...baseState,
          mainAgentLoop: buildLoopSnapshot(loopResult, confirmation, toolName, mainAgentLoopState),
        },
      };
    },
  };
}

function buildLoopSnapshot(loopResult, confirmation, name, state) {
  return {
    transcript: structuredClone(loopResult.transcript || []),
    pendingCall: {
      id: String(confirmation.toolCallId || ''),
      name,
      args: structuredClone((confirmation.arguments && typeof confirmation.arguments === 'object') ? confirmation.arguments : confirmation.clarification || {}),
      ...(Array.isArray(confirmation.batch) ? { batch: structuredClone(confirmation.batch) } : {}),
    },
    budgets: {
      turnsUsed: loopResult.turns,
      toolCallsUsed: loopResult.toolCalls,
      budgetedToolCallsUsed: loopResult.budgetedToolCalls,
      mutationToolCallsUsed: loopResult.mutationToolCalls,
    },
    ...(Array.isArray(state.memoryPatches) ? { memoryPatches: structuredClone(state.memoryPatches) } : {}),
    selectedSkillId: state.selectedSkillId || null,
    skillRead: Boolean(state.skillRead),
    contextScopes: Array.isArray(state.contextScopes) ? [...state.contextScopes] : [],
  };
}

