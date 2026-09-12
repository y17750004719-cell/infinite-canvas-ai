import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_CONTRACT_VERSION,
  MigrationRequiredError,
  migrationErrorMeta,
  assertCurrentContract,
} from './compatibility-gate.mjs';

test('current contract accepts the current version', () => {
  assert.equal(assertCurrentContract({ contractVersion: CURRENT_CONTRACT_VERSION }, { sourceType: 'wire_request' }).contractVersion, CURRENT_CONTRACT_VERSION);
});

test('old contracts produce a non-retryable migration error with the 409 metadata', () => {
  assert.throws(
    () => assertCurrentContract({ contractVersion: 'legacy-v0' }, { sourceType: 'session' }),
    (error) => {
      assert.ok(error instanceof MigrationRequiredError);
      assert.equal(error.statusCode, 409);
      assert.deepEqual(migrationErrorMeta(error), {
        code: 'migration_required',
        failureStage: 'compatibility_gate',
        sourceType: 'session',
        sourceVersion: 'legacy-v0',
        requiredVersion: CURRENT_CONTRACT_VERSION,
        retryable: false,
        outcomeUnknown: false,
      });
      return true;
    },
  );
});
