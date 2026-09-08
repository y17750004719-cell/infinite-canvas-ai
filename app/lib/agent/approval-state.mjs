import { createHash } from 'node:crypto';

const IDENTITY_FIELDS = ['threadId', 'turnId', 'operationId', 'runId', 'itemId'];
const TERMINAL_STATUSES = new Set(['rejected', 'consumed']);

function conflict(message, code = 'stale_operation') {
  return Object.assign(new Error(message), { statusCode: 409, code });
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}

function normalizeJson(value, path = 'parameters') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry, index) => normalizeJson(entry, `${path}[${index}]`));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeJson(value[key], `${path}.${key}`)]));
  }
  throw new TypeError(`${path} must be JSON-serializable`);
}

export function hashApprovalParameters(parameters) {
  const canonical = JSON.stringify(normalizeJson(parameters ?? {}));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function normalizeIdentity(input) {
  const identity = Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, requireString(input?.[field], field)]));
  identity.toolName = requireString(input?.toolName, 'toolName');
  if (!Number.isSafeInteger(input?.expectedSequence) || input.expectedSequence < 0) {
    throw new TypeError('expectedSequence must be a non-negative safe integer');
  }
  identity.expectedSequence = input.expectedSequence;
  return identity;
}

function requestHash(input) {
  if (typeof input?.parametersHash === 'string' && input.parametersHash) return input.parametersHash;
  if (Object.prototype.hasOwnProperty.call(input || {}, 'parameters')) return hashApprovalParameters(input.parameters);
  throw new TypeError('parameters or parametersHash is required');
}

export function createApproval(input, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const identity = normalizeIdentity(input);
  const expiresAt = Number(input?.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new TypeError('expiresAt must be in the future');
  return {
    version: 1,
    ...identity,
    parametersHash: requestHash(input),
    status: 'pending',
    createdAt: now,
    expiresAt,
    decidedAt: null,
    consumedAt: null,
  };
}

export function assertApprovalMatches(approval, input, options = {}) {
  if (!approval || approval.version !== 1) throw conflict('Approval is missing or invalid');
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (!Number.isFinite(approval.expiresAt) || approval.expiresAt <= now) throw conflict('Approval has expired');
  const identity = normalizeIdentity(input);
  for (const field of [...IDENTITY_FIELDS, 'toolName']) {
    if (approval[field] !== identity[field]) throw conflict(`Approval ${field} does not match`);
  }
  if (approval.expectedSequence !== identity.expectedSequence) throw conflict('Approval sequence does not match', 'stale_sequence');
  if (approval.parametersHash !== requestHash(input)) throw conflict('Approval parameters do not match');
  return approval;
}

export function approveApproval(approval, input, options = {}) {
  assertApprovalMatches(approval, input, options);
  if (approval.status !== 'pending') throw conflict(`Approval is already ${approval.status}`);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  return { ...approval, status: 'approved', decidedAt: now };
}

export function rejectApproval(approval, input, options = {}) {
  assertApprovalMatches(approval, input, options);
  if (approval.status !== 'pending') throw conflict(`Approval is already ${approval.status}`);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  return { ...approval, status: 'rejected', decidedAt: now };
}

export function consumeApproval(approval, input, options = {}) {
  assertApprovalMatches(approval, input, options);
  if (approval.status !== 'approved') {
    const detail = TERMINAL_STATUSES.has(approval.status) ? `already ${approval.status}` : 'not approved';
    throw conflict(`Approval is ${detail}`);
  }
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  return { ...approval, status: 'consumed', consumedAt: now };
}

export const APPROVAL_IDENTITY_FIELDS = Object.freeze([...IDENTITY_FIELDS, 'toolName', 'expectedSequence']);
