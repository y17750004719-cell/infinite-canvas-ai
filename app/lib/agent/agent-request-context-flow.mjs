import { CURRENT_CONTRACT_VERSION, MigrationRequiredError, migrationErrorMeta } from '../compatibility-gate.mjs';
import { resolveContinuationTurn } from './thread-turn-service.mjs';
import { prepareAgentContext } from './agent-context-service.mjs';
import { enrichAgentRecoverySkillMetadata } from './recovery.mjs';

const invalid = (payload, status = 400) => ({ ok: false, response: { payload, status } });

/**
 * Request-level context boundary. This owns validation and preparation only;
 * it never starts a Native turn, writes a journal event, or performs a side
 * effect. Adapters are injected so the flow remains usable by HTTP and replay
 * callers alike.
 */
export function createAgentRequestContextFlow(dependencies = {}) {
  const {
    loadThread,
    normalizeReferenceContext = (value) => value,
    prepare = prepareAgentContext,
    resolveContinuation = resolveContinuationTurn,
    contractVersion = CURRENT_CONTRACT_VERSION,
  } = dependencies;
  if (typeof loadThread !== 'function') throw new TypeError('loadThread is required');

  return {
    async prepare({ body, sessionId, latestUserMessage, normalizedRecentFailedTask } = {}) {
      if (!body || !Array.isArray(body.messages)) {
        return invalid({ error: 'Messages are required' });
      }
      if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 200) {
        return invalid({ error: 'sessionId is required', code: 'invalid_identity' });
      }
      const runtimeReferenceContext = normalizeReferenceContext(body.referenceContext);
      const hasUnconfirmedRegion = [
        body.referenceContext,
        body.clarificationState?.referenceContext,
      ].some((referenceContext) => (
        Array.isArray(referenceContext?.references)
        && referenceContext.references.some((reference) => (
          reference?.role === 'region_target' && reference.confirmationStatus !== 'confirmed'
        ))
      ));
      if (hasUnconfirmedRegion) {
        return invalid({ error: 'Region targets must be explicitly confirmed before sending' });
      }
      if (!latestUserMessage) return invalid({ error: 'A user message is required' });

      let thread;
      try {
        thread = await loadThread(sessionId);
      } catch (error) {
        return invalid({ error: error instanceof Error ? error.message : 'Unable to load thread', code: 'thread_unavailable' }, 500);
      }
      const state = thread?.state || {};
      const durableRecentFailedTask = enrichAgentRecoverySkillMetadata(normalizedRecentFailedTask, {
        messages: body.messages,
        journalEvents: thread?.events,
        sessionId,
      });
      const suppliedVersion = body.contractVersion;
      const persistedNative = state.nativeCodex;
      const persistedVersion = state.contractVersion || persistedNative?.contractVersion;
      const legacyWirePresent = Object.prototype.hasOwnProperty.call(body, 'generationPrompt')
        || Object.prototype.hasOwnProperty.call(body, 'planner')
        || Object.prototype.hasOwnProperty.call(body, 'legacyProtocol');
      if ((suppliedVersion !== undefined && suppliedVersion !== contractVersion)
        || (persistedVersion !== undefined && persistedVersion !== contractVersion)
        || (persistedNative && persistedVersion === undefined)
        || legacyWirePresent) {
        const error = new MigrationRequiredError({
          sourceType: legacyWirePresent ? 'wire_request' : 'session',
          sourceVersion: String(suppliedVersion || persistedVersion || 'legacy'),
        });
        return invalid({ error: error.message, ...migrationErrorMeta(error) }, 409);
      }
      if ((body.recoveryTaskId || body.clarificationState || body.confirmation) && !persistedNative) {
        return invalid({ error: '历史任务不支持原生运行时恢复，请新建请求；聊天和图片资产仍保留', code: 'history_not_resumable' }, 409);
      }
      if (state.archived) return invalid({ error: 'Thread is archived; unarchive before creating a turn', code: 'thread_archived' }, 409);
      if (state.activeTurn && !body.recoveryTaskId && !body.clarificationState && !body.confirmation) {
        return invalid({ error: 'Thread already has an active turn', code: 'turn_active', activeTurn: state.activeTurn }, 409);
      }

      let journalTurnId = null;
      if (body.recoveryTaskId || body.clarificationState || body.confirmation) {
        const operation = body.operationId || body.confirmation?.operationId || body.clarificationState?.operationId;
        try {
          journalTurnId = resolveContinuation({ state, operationId: operation });
        } catch (error) {
          return invalid({ error: error instanceof Error ? error.message : 'Continuation is stale', code: 'stale_operation' }, 409);
        }
      }

      const prepared = await prepare({
        body,
        sessionId,
        latestUserMessage,
        runtimeReferenceContext,
        normalizedRecentFailedTask: durableRecentFailedTask,
      });
      if (!prepared?.ok) return prepared;
      return {
        ok: true,
        value: {
          ...prepared.value,
          body,
          sessionId,
          thread,
          threadState: state,
          runtimeReferenceContext,
          journalTurnId,
        },
      };
    },
  };
}
