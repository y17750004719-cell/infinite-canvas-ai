import { normalizeAgentVisualSummary } from './visual-summary.mjs';

const ROUTES = new Set(['main_agent', 'image_planner', 'local_delivery']);
const INTENTS = new Set(['chat', 'vision_analysis', 'image', 'skill_action']);
const FAILURE_KINDS = new Set([
  'cancelled', 'timeout', 'transport', 'upstream_http', 'protocol', 'validation',
  'permission', 'resource', 'capability', 'unknown',
]);
const RETRYABILITY = new Set(['retryable', 'requires_change', 'unknown']);

const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const bounded = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const ids = (value, limit = 20) => Array.isArray(value)
  ? Array.from(new Set(value.map((entry) => bounded(String(entry || ''), 200)).filter(Boolean))).slice(0, limit)
  : [];

export function sanitizeAgentFailureMessage(value, fallback = '任务未完成') {
  const cleaned = bounded(value, 12_000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:request|trace|ray)[-_ ]?id\s*[:=]\s*[\w.-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, 1200);
}

export function classifyAgentFailure({ stage, reason, message, aborted = false } = {}) {
  const normalizedStage = bounded(stage, 120).toLowerCase();
  const normalizedReason = bounded(reason, 120).toLowerCase();
  const normalizedMessage = bounded(message, 4000).toLowerCase();
  const haystack = `${normalizedStage} ${normalizedReason} ${normalizedMessage}`;
  let kind = 'unknown';
  if (aborted || /cancel|abort|取消|终止/.test(haystack)) kind = 'cancelled';
  else if (/timeout|timed out|504|超时/.test(haystack)) kind = 'timeout';
  else if (/permission|forbidden|unauthori[sz]ed|权限|拒绝/.test(haystack)) kind = 'permission';
  else if (/capability|unsupported|not support|能力|不支持/.test(haystack)) kind = 'capability';
  else if (/validation|invalid_|conflict|missing|required|校验|无效|缺少/.test(haystack)) kind = 'validation';
  else if (/resource|not found|unavailable|missing asset|引用.*(?:失效|不存在)|资源/.test(haystack)) kind = 'resource';
  else if (/\b5\d\d\b|upstream|bad gateway|service unavailable/.test(haystack)) kind = 'upstream_http';
  else if (/transport|network|fetch|connection|socket|econn|连接|网络/.test(haystack)) kind = 'transport';
  else if (/protocol|tool call|schema|parse|json|协议/.test(haystack)) kind = 'protocol';
  return {
    kind,
    retryability: ['cancelled', 'timeout', 'transport', 'upstream_http'].includes(kind)
      ? 'retryable'
      : ['validation', 'permission', 'resource', 'capability'].includes(kind)
        ? 'requires_change'
        : 'unknown',
  };
}

export function normalizeAgentRecoveryRecord(value) {
  const input = record(value);
  const failure = record(input?.failure);
  if (!input || !failure || Number(input.version) !== 1) return null;
  const taskId = bounded(input.taskId, 200);
  const runId = bounded(input.runId, 200);
  const topicId = bounded(input.topicId, 200);
  const sourceUserMessageId = bounded(input.sourceUserMessageId, 200);
  const originalRequest = bounded(input.originalRequest, 4000);
  if (!taskId || !runId || !topicId || !sourceUserMessageId || !originalRequest) return null;
  if (!['failed', 'cancelled'].includes(input.status)) return null;
  const failureKind = FAILURE_KINDS.has(failure.kind) ? failure.kind : 'unknown';
  const retryability = RETRYABILITY.has(failure.retryability) ? failure.retryability : 'unknown';
  const snapshot = record(input.taskSnapshot);
  const visualSummary = normalizeAgentVisualSummary(input.visualSummary);
  return {
    version: 1,
    taskId,
    runId,
    topicId,
    sourceUserMessageId,
    status: input.status === 'cancelled' ? 'cancelled' : 'failed',
    resumeRoute: ROUTES.has(input.resumeRoute) ? input.resumeRoute : null,
    intent: INTENTS.has(input.intent) ? input.intent : null,
    originalRequest,
    failure: {
      stage: bounded(failure.stage, 120) || 'unknown',
      kind: failureKind,
      message: sanitizeAgentFailureMessage(failure.message),
      retryability,
    },
    skillId: bounded(input.skillId, 160) || null,
    contextEntityIds: ids(input.contextEntityIds),
    visualReferenceIds: ids(input.visualReferenceIds),
    ...(visualSummary ? { visualSummary } : {}),
    ...(snapshot ? { taskSnapshot: structuredClone(snapshot) } : {}),
    completedAssetCount: Math.min(100, Math.max(0, Math.floor(Number(input.completedAssetCount) || 0))),
    createdAt: Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : Date.now(),
  };
}

export function createAgentRecoveryRecord(input = {}) {
  const classified = classifyAgentFailure({
    stage: input.failureStage,
    reason: input.failureReason,
    message: input.failureMessage,
    aborted: input.status === 'cancelled',
  });
  return normalizeAgentRecoveryRecord({
    version: 1,
    taskId: input.taskId || input.runId,
    runId: input.runId || input.taskId,
    topicId: input.topicId,
    sourceUserMessageId: input.sourceUserMessageId,
    status: input.status === 'cancelled' ? 'cancelled' : 'failed',
    resumeRoute: input.resumeRoute || null,
    intent: input.intent || null,
    originalRequest: input.originalRequest,
    failure: {
      stage: input.failureStage || 'unknown',
      kind: input.failureKind || classified.kind,
      message: input.failureMessage,
      retryability: input.retryability || classified.retryability,
    },
    skillId: input.skillId || null,
    contextEntityIds: input.contextEntityIds || [],
    visualReferenceIds: input.visualReferenceIds || [],
    visualSummary: input.visualSummary,
    taskSnapshot: input.taskSnapshot,
    completedAssetCount: input.completedAssetCount,
    createdAt: input.createdAt || Date.now(),
  });
}
