import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  NativeBusinessLedgerError,
  claimNativeConfirmation,
  executeNativeBusinessOperation,
  hashNativeBusinessContract,
  loadNativeConfirmation,
  readNativeBusinessOperation,
  saveNativeConfirmation,
} from './native-business-ledger.mjs';

async function fixtureRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'native-business-ledger-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function operationInput(root, overrides = {}) {
  return {
    root,
    sessionId: 'session-1',
    taskId: 'task-1',
    operationId: 'operation-1',
    runId: 'run-1',
    contract: { operation: 'generate', count: 1 },
    ...overrides,
  };
}

test('executes one in-process side effect and returns the durable completed result to duplicates', async (t) => {
  const root = await fixtureRoot(t);
  let executions = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const execute = async () => {
    executions += 1;
    await gate;
    return { assets: [{ id: 'asset-1' }], privateProviderId: 'provider-call-1' };
  };
  const first = executeNativeBusinessOperation(operationInput(root), execute);
  const duplicate = executeNativeBusinessOperation(operationInput(root), execute);
  release();
  assert.deepEqual(await first, await duplicate);
  assert.equal(executions, 1);

  const replay = await executeNativeBusinessOperation(operationInput(root, { runId: 'run-2' }), async () => {
    throw new Error('must not execute');
  });
  assert.equal(replay.assets[0].id, 'asset-1');
  const record = await readNativeBusinessOperation(operationInput(root));
  assert.equal(record.status, 'completed');
  assert.equal(record.contractHash, hashNativeBusinessContract(operationInput(root).contract));
  assert.equal(record.result.privateProviderId, 'provider-call-1');
});

test('rejects a different contract for the same operation', async (t) => {
  const root = await fixtureRoot(t);
  await executeNativeBusinessOperation(operationInput(root), async () => ({ assets: [] }));
  await assert.rejects(
    executeNativeBusinessOperation(operationInput(root, { contract: { operation: 'edit' } }), async () => ({ assets: [] })),
    { code: 'operation_contract_conflict' },
  );
});

test('allows only a retryable failure with a new run id to execute again', async (t) => {
  const root = await fixtureRoot(t);
  await assert.rejects(executeNativeBusinessOperation(operationInput(root), async () => {
    throw Object.assign(new Error('temporary rejection'), { code: 'provider_http', retryable: true });
  }));
  await assert.rejects(
    executeNativeBusinessOperation(operationInput(root), async () => ({ assets: [] })),
    { code: 'retry_run_conflict' },
  );
  let executions = 0;
  const result = await executeNativeBusinessOperation(operationInput(root, { runId: 'run-2' }), async () => {
    executions += 1;
    return { assets: [{ id: 'asset-2' }] };
  });
  assert.equal(executions, 1);
  assert.equal(result.assets[0].id, 'asset-2');
});

test('unknown provider outcome is durable and can never be retried automatically', async (t) => {
  const root = await fixtureRoot(t);
  await assert.rejects(executeNativeBusinessOperation(operationInput(root), async () => {
    throw Object.assign(new Error('socket closed after POST'), {
      code: 'provider_result_unknown',
      retryable: true,
      outcomeUnknown: true,
    });
  }));
  const record = await readNativeBusinessOperation(operationInput(root));
  assert.equal(record.outcomeUnknown, true);
  assert.equal(record.retryable, false);
  await assert.rejects(
    executeNativeBusinessOperation(operationInput(root, { runId: 'run-2' }), async () => ({ assets: [] })),
    (error) => error instanceof NativeBusinessLedgerError && error.code === 'operation_result_unknown' && error.outcomeUnknown,
  );
});

test('a persisted running record is unknown after restart and is never executed', async (t) => {
  const root = await fixtureRoot(t);
  const input = operationInput(root);
  const directory = path.join(root, createHashForTest(input.sessionId), 'operations');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${createHashForTest(input.operationId)}.json`), JSON.stringify({
    version: 1,
    kind: 'operation',
    sessionId: input.sessionId,
    taskId: input.taskId,
    operationId: input.operationId,
    runId: input.runId,
    contractHash: hashNativeBusinessContract(input.contract),
    contract: input.contract,
    status: 'running',
    attempt: 1,
    createdAt: Date.now(),
    startedAt: Date.now(),
    updatedAt: Date.now(),
  }), { mode: 0o600 });
  const record = await readNativeBusinessOperation(input);
  assert.equal(record.status, 'running');
  assert.equal(record.outcomeUnknown, true);
  let executions = 0;
  await assert.rejects(executeNativeBusinessOperation(operationInput(root, { runId: 'run-2' }), async () => {
    executions += 1;
    return { assets: [] };
  }), {
    code: 'operation_result_unknown',
  });
  assert.equal(executions, 0);
});

test('a stale lock without a record is still visible as an unknown running operation', async (t) => {
  const root = await fixtureRoot(t);
  const input = operationInput(root);
  const directory = path.join(root, createHashForTest(input.sessionId), 'operations');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${createHashForTest(input.operationId)}.lock`), JSON.stringify({
    version: 1,
    createdAt: 123,
  }), { mode: 0o600 });
  const record = await readNativeBusinessOperation(input);
  assert.equal(record.status, 'running');
  assert.equal(record.lockOnly, true);
  assert.equal(record.outcomeUnknown, true);
});

test('requires successful results to contain assets and keeps files private', async (t) => {
  const root = await fixtureRoot(t);
  await assert.rejects(
    executeNativeBusinessOperation(operationInput(root), async () => ({ accepted: true })),
    { code: 'invalid_operation_result' },
  );
  const record = await readNativeBusinessOperation(operationInput(root));
  assert.equal(record.status, 'failed');
  const files = [];
  async function walk(directory) {
    for (const entry of await (await import('node:fs/promises')).readdir(directory, { withFileTypes: true })) {
      const item = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(item);
      else files.push(item);
    }
  }
  await walk(root);
  for (const file of files.filter((item) => item.endsWith('.json'))) {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
});

test('saves complete confirmation parameters and atomically permits one claim', async (t) => {
  const root = await fixtureRoot(t);
  const input = {
    root,
    sessionId: 'session-1',
    confirmationId: 'confirmation-1',
    taskId: 'task-1',
    operationId: 'operation-1',
    runId: 'run-1',
    contract: { operation: 'generate', promptHash: 'abc' },
    parameters: { referenceIds: ['reference-1'], count: 2 },
  };
  const saved = await saveNativeConfirmation(input);
  assert.deepEqual(saved.parameters, input.parameters);
  assert.equal(saved.contractHash, hashNativeBusinessContract(input.contract));
  assert.equal(saved.parametersHash, hashNativeBusinessContract(input.parameters));
  const claims = await Promise.allSettled([
    claimNativeConfirmation({ ...input, runId: 'run-2' }),
    claimNativeConfirmation({ ...input, runId: 'run-3' }),
  ]);
  assert.equal(claims.filter((claim) => claim.status === 'fulfilled').length, 1);
  assert.equal(claims.filter((claim) => claim.status === 'rejected').length, 1);
  const loaded = await loadNativeConfirmation(input);
  assert.equal(loaded.status, 'claimed');
});

test('does not reuse a confirmation id after parameters change', async (t) => {
  const root = await fixtureRoot(t);
  const input = {
    root,
    sessionId: 'session-1',
    confirmationId: 'confirmation-parameters',
    taskId: 'task-1',
    operationId: 'operation-1',
    runId: 'run-1',
    contract: { operation: 'generate' },
    parameters: { count: 1 },
  };
  await saveNativeConfirmation(input);
  await assert.rejects(saveNativeConfirmation({ ...input, parameters: { count: 2 } }), {
    code: 'confirmation_identity_conflict',
  });
});

test('rejects old confirmation schemas instead of executing a migration', async (t) => {
  const root = await fixtureRoot(t);
  const input = {
    root,
    sessionId: 'session-old',
    confirmationId: 'confirmation-old',
  };
  const sessionHash = createHashForTest(input.sessionId);
  const confirmationHash = createHashForTest(input.confirmationId);
  const directory = path.join(root, sessionHash, 'confirmations');
  await mkdir(directory, { recursive: true });
  const recordPath = path.join(directory, `${confirmationHash}.json`);
  await writeFile(recordPath, JSON.stringify({ version: 0, kind: 'confirmation' }), { mode: 0o600 });
  await chmod(recordPath, 0o600);
  await assert.rejects(loadNativeConfirmation(input), { code: 'unsupported_ledger_schema' });
});

function createHashForTest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
