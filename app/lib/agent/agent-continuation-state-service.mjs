/**
 * Request continuation state shared by confirmation and clarification flows.
 * The runtime only consumes this small state API; persistence is injected so
 * this module remains independent from request transport and Native runtime.
 */
export function createAgentContinuationStateService({
  threadJournal,
  confirmationLedger,
  persistence = {},
  confirmationTtlMs = 10 * 60 * 1000,
} = {}) {
  const confirmationStore = new Map();
  const clarificationSubmissionStore = new Map();

  const updateThreadSnapshot = persistence.updateSnapshot || ((sessionId, snapshot) => (
    threadJournal?.updateThreadState?.(sessionId, snapshot)
  ));
  const clearThreadSnapshot = persistence.clearSnapshot || ((sessionId) => (
    threadJournal?.updateThreadState?.(sessionId, { pendingApproval: null })
  ));

  const persistApprovalSnapshot = (record) => {
    if (!record?.sessionId || !record.confirmationId) return;
    const snapshot = {
      confirmationId: record.confirmationId,
      sessionId: record.sessionId,
      taskId: record.taskId || null,
      operationId: record.operationId,
      runId: record.runId || null,
      toolName: record.toolName,
      status: record.status,
      lastSequence: record.lastSequence,
      expiresAt: record.expiresAt,
      ...(record.toolName === 'todo_update' ? {
        continuation: {
          toolName: record.toolName,
          toolArgs: { items: Array.isArray(record.toolArgs?.items) ? record.toolArgs.items.slice(0, 100) : [] },
          allowedTools: ['todo_update'],
          userMessage: String(record.userMessage || '').slice(0, 8000),
          confirmationId: record.confirmationId,
        },
      } : {}),
    };
    void updateThreadSnapshot(record.sessionId, { pendingApproval: snapshot });
  };

  const clearApprovalSnapshot = (record) => {
    if (record?.sessionId) void clearThreadSnapshot(record.sessionId);
  };

  const setConfirmation = (id, record) => {
    confirmationStore.set(id, record);
    persistApprovalSnapshot(record);
    return record;
  };

  const deleteConfirmation = (id) => {
    const record = confirmationStore.get(id);
    const deleted = confirmationStore.delete(id);
    if (deleted) clearApprovalSnapshot(record);
    return deleted;
  };

  return {
    get confirmationStore() { return confirmationStore; },
    get clarificationSubmissionStore() { return clarificationSubmissionStore; },
    getConfirmation(id) { return confirmationStore.get(id); },
    setConfirmation,
    deleteConfirmation,
    async hydrateConfirmation({ sessionId, confirmationId } = {}) {
      if (!confirmationId) return null;
      const local = confirmationStore.get(confirmationId);
      if (local) return local;
      const saved = await (persistence.load || confirmationLedger?.load)?.({ sessionId, confirmationId });
      if (saved?.status === 'pending' && saved.parameters) {
        return setConfirmation(confirmationId, saved.parameters);
      }
      return null;
    },
    async storePendingConfirmation({ sessionId, confirmationId, taskId, operationId, runId, contract, parameters, expiresAt } = {}) {
      if (!confirmationId || !parameters) return null;
      setConfirmation(confirmationId, parameters);
      await (persistence.save || confirmationLedger?.save)?.({
        sessionId, confirmationId, taskId, operationId, runId, contract, parameters, expiresAt,
      });
      return parameters;
    },
    async claimStoredConfirmation(input) {
      return (persistence.claim || confirmationLedger?.claim)?.(input);
    },
    completeConfirmation(id) {
      const record = confirmationStore.get(id);
      if (record) record.status = 'completed';
      return deleteConfirmation(id);
    },
    setClarificationSubmission(key, expiresAt = Date.now() + confirmationTtlMs) {
      clarificationSubmissionStore.set(key, expiresAt);
      return expiresAt;
    },
    deleteClarificationSubmission(key) { return clarificationSubmissionStore.delete(key); },
    async loadConfirmation(input) { return (persistence.load || confirmationLedger?.load)?.(input); },
    async saveConfirmation(input) { return (persistence.save || confirmationLedger?.save)?.(input); },
    async claimConfirmation(input) { return (persistence.claim || confirmationLedger?.claim)?.(input); },
    prune(now = Date.now()) {
      for (const [id, record] of confirmationStore) {
        if (record?.expiresAt <= now) this.deleteConfirmation(id);
      }
      for (const [key, expiresAt] of clarificationSubmissionStore) {
        if (expiresAt <= now) clarificationSubmissionStore.delete(key);
      }
    },
    confirmationTtlMs,
  };
}
