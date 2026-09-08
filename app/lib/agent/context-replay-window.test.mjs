import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReplayMessages, replayContext } from './context-replay.mjs';
import { compactContext, estimateContextTokens } from './context-window.mjs';

test('context replay adapter preserves text and durable image references', () => {
  const replay = buildReplayMessages({
    sessionId: 'session-1',
    events: [
      { type: 'user_text', sequence: 1, content: 'Use this image' },
      { type: 'image_input', sequence: 2, assetId: 'asset-1' },
    ],
    visualAssets: [{ id: 'asset-1', durableSrc: '/api/session-visual-assets/asset-1' }],
  });
  assert.deepEqual(replay, [{
    role: 'user',
    content: [
      { type: 'text', text: 'Use this image' },
      { type: 'image_url', image_url: { url: '/api/session-visual-assets/asset-1' } },
    ],
  }]);
  assert.deepEqual(replayContext([{ type: 'user_text', sequence: 1, content: 'hello' }]), [
    { role: 'user', content: 'hello' },
  ]);
});

test('context window adapter compacts oversized history and records state', () => {
  const replay = compactContext({
    sessionId: 'session-1',
    events: Array.from({ length: 6 }, (_, index) => ({
      type: 'user_text', sequence: index + 1, content: 'x'.repeat(500),
    })),
  }, { contextWindow: 1024, reserveTokens: 0, threshold: 0.5, keepRecent: 2 });
  assert.equal(replay.activeWindow.compactCount, 1);
  assert.equal(replay.events.at(-1).sequence, 6);
  assert.ok(estimateContextTokens(replay.events) < 6 * 130);
});
