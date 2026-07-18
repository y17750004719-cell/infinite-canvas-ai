const isRecord = (value) => typeof value === 'object' && value !== null;

export function estimateStructuredValueBytes(value, options = {}) {
  const seen = new WeakSet();
  const maxVisitedNodes = Number.isFinite(options.maxVisitedNodes) ? options.maxVisitedNodes : 250_000;
  let visitedNodes = 0;
  let estimatedBytes = 0;
  let dataUrlCount = 0;
  let dataUrlBytes = 0;

  const visit = (candidate) => {
    if (candidate === null || candidate === undefined || visitedNodes >= maxVisitedNodes) return;
    const valueType = typeof candidate;
    if (valueType === 'string') {
      const bytes = candidate.length * 2;
      estimatedBytes += bytes;
      if (candidate.startsWith('data:image/')) {
        dataUrlCount += 1;
        dataUrlBytes += bytes;
      }
      return;
    }
    if (valueType === 'number' || valueType === 'bigint') {
      estimatedBytes += 8;
      return;
    }
    if (valueType === 'boolean') {
      estimatedBytes += 4;
      return;
    }
    if (!isRecord(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    visitedNodes += 1;
    if (Array.isArray(candidate)) {
      estimatedBytes += candidate.length * 8;
      candidate.forEach(visit);
      return;
    }
    for (const [key, nested] of Object.entries(candidate)) {
      estimatedBytes += key.length * 2 + 8;
      visit(nested);
    }
  };

  visit(value);
  return {
    estimatedBytes,
    dataUrlCount,
    dataUrlBytes,
    visitedNodes,
    truncated: visitedNodes >= maxVisitedNodes,
  };
}

export function collectSessionDiagnostics(session) {
  const size = estimateStructuredValueBytes(session);
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const referenceCount = messages.reduce(
    (total, message) => total + (Array.isArray(message?.referenceContext?.references)
      ? message.referenceContext.references.length
      : 0),
    0,
  );
  return {
    ...size,
    messageCount: messages.length,
    referenceCount,
    canvasItemCount: Array.isArray(session?.items) ? session.items.length : 0,
  };
}
