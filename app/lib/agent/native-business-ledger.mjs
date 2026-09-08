import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_VERSION = 1;
const activeOperations = new Map();

export class NativeBusinessLedgerError extends Error {
  constructor(message, { code, outcomeUnknown = false, retryable = false, record = null } = {}) {
    super(message);
    this.name = 'NativeBusinessLedgerError';
    this.code = code || 'native_business_ledger_error';
    this.outcomeUnknown = outcomeUnknown;
    this.retryable = retryable;
    this.record = record;
  }
}

function ledgerError(message, details) {
  return new NativeBusinessLedgerError(message, details);
}

function requiredId(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

function canonicalize(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('contract contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, seen));
  if (typeof value !== 'object' || value === null) throw new TypeError('contract must contain JSON values only');
  if (seen.has(value)) throw new TypeError('contract must not contain cycles');
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) output[key] = canonicalize(value[key], seen);
  }
  seen.delete(value);
  return output;
}

export function hashNativeBusinessContract(contract) {
  return createHash('sha256').update(JSON.stringify(canonicalize(contract)), 'utf8').digest('hex');
}

function idHash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function resolveRoot(root) {
  const resolved = root || path.join(process.cwd(), 'runtime', 'native-business-ledger');
  if (!path.isAbsolute(resolved)) throw new TypeError('root must be an absolute path');
  return resolved;
}

function sessionDirectory(root, sessionId) {
  return path.join(resolveRoot(root), idHash(sessionId));
}

function operationPaths(root, sessionId, operationId) {
  const directory = path.join(sessionDirectory(root, sessionId), 'operations');
  const stem = idHash(operationId);
  return { directory, recordPath: path.join(directory, `${stem}.json`), lockPath: path.join(directory, `${stem}.lock`) };
}

function confirmationPaths(root, sessionId, confirmationId) {
  const directory = path.join(sessionDirectory(root, sessionId), 'confirmations');
  const stem = idHash(confirmationId);
  return { directory, recordPath: path.join(directory, `${stem}.json`), lockPath: path.join(directory, `${stem}.lock`) };
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

async function readJson(recordPath) {
  try {
    return JSON.parse(await readFile(recordPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw ledgerError('Ledger record is invalid', { code: 'invalid_ledger_record' });
    throw error;
  }
}

async function writePrivateJson(recordPath, value) {
  const temporaryPath = `${recordPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, recordPath);
    await chmod(recordPath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function acquireLock(lockPath) {
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ version: SCHEMA_VERSION, pid: process.pid, createdAt: Date.now() }));
    await handle.close();
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

async function releaseLock(lockPath) {
  await rm(lockPath, { force: true });
}

function assertCurrentRecord(record, kind) {
  if (!record || record.version !== SCHEMA_VERSION || record.kind !== kind) {
    throw ledgerError('Ledger schema is not supported', { code: 'unsupported_ledger_schema' });
  }
  return record;
}

function operationUnknown(record) {
  throw ledgerError('Business operation result is unknown; explicit reconciliation is required', {
    code: 'operation_result_unknown',
    outcomeUnknown: true,
    retryable: false,
    record,
  });
}

export async function readNativeBusinessOperation({ sessionId, operationId, root } = {}) {
  sessionId = requiredId(sessionId, 'sessionId');
  operationId = requiredId(operationId, 'operationId');
  const { recordPath, lockPath } = operationPaths(root, sessionId, operationId);
  const record = await readJson(recordPath);
  if (!record) {
    const lock = await readJson(lockPath);
    if (!lock) return null;
    return {
      version: SCHEMA_VERSION,
      kind: 'operation',
      sessionId,
      operationId,
      status: 'running',
      retryable: false,
      outcomeUnknown: true,
      lockOnly: true,
      createdAt: Number.isFinite(lock.createdAt) ? lock.createdAt : null,
      updatedAt: Number.isFinite(lock.createdAt) ? lock.createdAt : null,
    };
  }
  const current = assertCurrentRecord(record, 'operation');
  if (current.sessionId !== sessionId || current.operationId !== operationId) {
    throw ledgerError('Ledger identity does not match its storage key', { code: 'invalid_ledger_identity' });
  }
  return current.status === 'running' ? { ...current, outcomeUnknown: true, retryable: false } : current;
}

export function executeNativeBusinessOperation(input, execute) {
  if (typeof execute !== 'function') return Promise.reject(new TypeError('execute must be a function'));
  const sessionId = requiredId(input?.sessionId, 'sessionId');
  const taskId = requiredId(input?.taskId, 'taskId');
  const operationId = requiredId(input?.operationId, 'operationId');
  const runId = requiredId(input?.runId, 'runId');
  const root = resolveRoot(input?.root);
  const contract = canonicalize(input?.contract);
  const contractHash = hashNativeBusinessContract(contract);
  const key = `${root}\0${sessionId}\0${operationId}`;

  const active = activeOperations.get(key);
  if (active) {
    if (active.taskId !== taskId) {
      return Promise.reject(ledgerError('Operation task identity does not match', { code: 'operation_identity_conflict' }));
    }
    if (active.contractHash !== contractHash) {
      return Promise.reject(ledgerError('Operation contract does not match the active operation', { code: 'operation_contract_conflict' }));
    }
    return active.promise;
  }

  const promise = executeOperation({ sessionId, taskId, operationId, runId, root, contract, contractHash, signal: input?.signal }, execute)
    .finally(() => activeOperations.delete(key));
  activeOperations.set(key, { taskId, contractHash, promise });
  return promise;
}

async function executeOperation(input, execute) {
  const { directory, recordPath, lockPath } = operationPaths(input.root, input.sessionId, input.operationId);
  await ensurePrivateDirectory(directory);
  let existing = await readJson(recordPath);
  if (existing) {
    existing = assertCurrentRecord(existing, 'operation');
    if (existing.sessionId !== input.sessionId || existing.operationId !== input.operationId || existing.taskId !== input.taskId) {
      throw ledgerError('Operation identity does not match', { code: 'operation_identity_conflict', record: existing });
    }
    if (existing.contractHash !== input.contractHash) {
      throw ledgerError('Operation contract does not match the stored operation', { code: 'operation_contract_conflict', record: existing });
    }
    if (existing.status === 'completed') return existing.result;
    if (existing.status === 'running' || existing.outcomeUnknown) operationUnknown(existing);
    if (existing.status !== 'failed' || existing.retryable !== true) {
      throw ledgerError('Business operation cannot be retried', { code: 'operation_not_retryable', record: existing });
    }
    if (existing.runId === input.runId) {
      throw ledgerError('Retry requires a new runId', { code: 'retry_run_conflict', retryable: true, record: existing });
    }
  }

  if (!(await acquireLock(lockPath))) {
    operationUnknown((await readJson(recordPath)) || { operationId: input.operationId, status: 'running' });
  }

  const now = Date.now();
  const attempt = Number(existing?.attempt || 0) + 1;
  const running = {
    version: SCHEMA_VERSION,
    kind: 'operation',
    sessionId: input.sessionId,
    taskId: input.taskId,
    operationId: input.operationId,
    runId: input.runId,
    contractHash: input.contractHash,
    contract: input.contract,
    status: 'running',
    attempt,
    retryable: false,
    outcomeUnknown: false,
    createdAt: existing?.createdAt || now,
    startedAt: now,
    updatedAt: now,
  };

  let completedResult = null;
  try {
    await writePrivateJson(recordPath, running);
    if (input.signal?.aborted) {
      throw Object.assign(new Error('Operation cancelled'), { code: 'operation_cancelled', retryable: false });
    }
    const result = await execute({ signal: input.signal, contractHash: input.contractHash, attempt });
    if (!result || typeof result !== 'object' || !Array.isArray(result.assets)) {
      throw Object.assign(new Error('Successful operation result must include assets'), {
        code: 'invalid_operation_result',
        retryable: false,
      });
    }
    completedResult = result;
    const completedAt = Date.now();
    await writePrivateJson(recordPath, {
      ...running,
      status: 'completed',
      result,
      completedAt,
      updatedAt: completedAt,
    });
    return result;
  } catch (error) {
    if (completedResult) {
      const completedAt = Date.now();
      try {
        await writePrivateJson(recordPath, {
          ...running,
          status: 'completed',
          result: completedResult,
          completedAt,
          updatedAt: completedAt,
          persistenceRecovered: true,
        });
        return completedResult;
      } catch {
        const persistenceError = ledgerError('Completed business result could not be persisted', {
          code: 'operation_completion_persistence_failed',
          outcomeUnknown: true,
          retryable: false,
          record: { ...running, result: completedResult },
        });
        persistenceError.result = completedResult;
        throw persistenceError;
      }
    }
    const failedAt = Date.now();
    const outcomeUnknown = error?.outcomeUnknown === true;
    const retryable = !outcomeUnknown && (error?.retryable === true || error?.isRetryable === true);
    await writePrivateJson(recordPath, {
      ...running,
      status: 'failed',
      retryable,
      outcomeUnknown,
      failure: {
        code: typeof error?.code === 'string' ? error.code : 'business_operation_failed',
        message: error instanceof Error ? error.message : 'Business operation failed',
      },
      failedAt,
      updatedAt: failedAt,
    });
    throw error;
  } finally {
    await releaseLock(lockPath);
  }
}

export async function saveNativeConfirmation(input = {}) {
  const sessionId = requiredId(input.sessionId, 'sessionId');
  const confirmationId = requiredId(input.confirmationId, 'confirmationId');
  const taskId = requiredId(input.taskId, 'taskId');
  const operationId = requiredId(input.operationId, 'operationId');
  const runId = requiredId(input.runId, 'runId');
  const contract = canonicalize(input.contract);
  const parameters = canonicalize(input.parameters);
  const contractHash = hashNativeBusinessContract(contract);
  const parametersHash = hashNativeBusinessContract(parameters);
  const { directory, recordPath, lockPath } = confirmationPaths(input.root, sessionId, confirmationId);
  await ensurePrivateDirectory(directory);
  if (!(await acquireLock(lockPath))) {
    throw ledgerError('Confirmation is being updated', { code: 'confirmation_busy' });
  }
  try {
    const existing = await readJson(recordPath);
    if (existing) {
      const current = assertCurrentRecord(existing, 'confirmation');
      if (current.contractHash !== contractHash) {
        throw ledgerError('Confirmation contract does not match', { code: 'confirmation_contract_conflict' });
      }
      if (
        current.sessionId !== sessionId ||
        current.confirmationId !== confirmationId ||
        current.taskId !== taskId ||
        current.operationId !== operationId ||
        current.parametersHash !== parametersHash
      ) {
        throw ledgerError('Confirmation identity or parameters do not match', { code: 'confirmation_identity_conflict' });
      }
      return current;
    }
    const now = Date.now();
    const record = {
      version: SCHEMA_VERSION,
      kind: 'confirmation',
      sessionId,
      confirmationId,
      taskId,
      operationId,
      runId,
      contractHash,
      contract,
      parametersHash,
      parameters,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...(Number.isFinite(input.expiresAt) ? { expiresAt: input.expiresAt } : {}),
    };
    await writePrivateJson(recordPath, record);
    return record;
  } finally {
    await releaseLock(lockPath);
  }
}

export async function loadNativeConfirmation({ sessionId, confirmationId, root } = {}) {
  sessionId = requiredId(sessionId, 'sessionId');
  confirmationId = requiredId(confirmationId, 'confirmationId');
  const { recordPath } = confirmationPaths(root, sessionId, confirmationId);
  const record = await readJson(recordPath);
  if (!record) return null;
  const current = assertCurrentRecord(record, 'confirmation');
  if (current.sessionId !== sessionId || current.confirmationId !== confirmationId) {
    throw ledgerError('Confirmation identity does not match its storage key', { code: 'invalid_ledger_identity' });
  }
  return current;
}

export async function claimNativeConfirmation(input = {}) {
  const sessionId = requiredId(input.sessionId, 'sessionId');
  const confirmationId = requiredId(input.confirmationId, 'confirmationId');
  const runId = requiredId(input.runId, 'runId');
  const expectedHash = typeof input.contractHash === 'string' && input.contractHash
    ? input.contractHash
    : hashNativeBusinessContract(input.contract);
  const { directory, recordPath, lockPath } = confirmationPaths(input.root, sessionId, confirmationId);
  await ensurePrivateDirectory(directory);
  if (!(await acquireLock(lockPath))) {
    throw ledgerError('Confirmation is already being claimed', { code: 'confirmation_already_claimed' });
  }
  try {
    const record = await readJson(recordPath);
    if (!record) throw ledgerError('Confirmation does not exist', { code: 'confirmation_not_found' });
    const current = assertCurrentRecord(record, 'confirmation');
    if (current.contractHash !== expectedHash) {
      throw ledgerError('Confirmation contract does not match', { code: 'confirmation_contract_conflict' });
    }
    if (current.status !== 'pending') {
      throw ledgerError('Confirmation has already been claimed', { code: 'confirmation_already_claimed', record: current });
    }
    if (Number.isFinite(current.expiresAt) && current.expiresAt <= Date.now()) {
      throw ledgerError('Confirmation has expired', { code: 'confirmation_expired', record: current });
    }
    const claimedAt = Date.now();
    const claimed = { ...current, status: 'claimed', claimedRunId: runId, claimedAt, updatedAt: claimedAt };
    await writePrivateJson(recordPath, claimed);
    return claimed;
  } finally {
    await releaseLock(lockPath);
  }
}
