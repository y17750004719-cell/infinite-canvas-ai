import test from 'node:test';
import assert from 'node:assert/strict';

const stateUpdateModule = await import('./state-update.mjs').catch(() => ({}));

const { resolveStateUpdate } = stateUpdateModule;

test('resolveStateUpdate is exposed for ref-synchronized state mirroring', () => {
  assert.equal(typeof resolveStateUpdate, 'function');
});

test('resolveStateUpdate returns direct values as-is', () => {
  assert.equal(typeof resolveStateUpdate, 'function');
  if (typeof resolveStateUpdate !== 'function') {
    return;
  }

  assert.deepEqual(resolveStateUpdate({ next: true }, { next: false }), { next: true });
  assert.equal(resolveStateUpdate(3, 2), 3);
});

test('resolveStateUpdate applies functional updates against the latest ref value', () => {
  assert.equal(typeof resolveStateUpdate, 'function');
  if (typeof resolveStateUpdate !== 'function') {
    return;
  }

  const initial = ['conn-1'];
  const afterFirstUpdate = resolveStateUpdate((prev) => [...prev, 'conn-2'], initial);
  const afterSecondUpdate = resolveStateUpdate((prev) => [...prev, 'conn-3'], afterFirstUpdate);

  assert.deepEqual(afterFirstUpdate, ['conn-1', 'conn-2']);
  assert.deepEqual(afterSecondUpdate, ['conn-1', 'conn-2', 'conn-3']);
});
