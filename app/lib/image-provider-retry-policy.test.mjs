import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyImagePostRetry } from './image-provider-retry-policy.mjs';

async function runFakeImagePost(fetchImpl, failures, { maxAttempts = 2 } = {}) {
  let stream = true;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl({ stream, attempt });
    const failure = failures(response, { attempt, maxAttempts, stream });
    if (!failure) return response;
    const decision = classifyImagePostRetry({ ...failure, attempt, maxAttempts });
    if (!decision.retry) throw Object.assign(new Error('image post failed'), decision);
    if (decision.retryWithoutStream) stream = false;
  }
  throw new Error('retry budget exhausted');
}

test('does not POST again after disconnect, timeout, or accepted empty payload', async () => {
  for (const kind of ['transport', 'timeout', 'accepted_payload']) {
    let postCount = 0;
    await assert.rejects(
      runFakeImagePost(async () => {
        postCount += 1;
        return { kind };
      }, (response) => ({ kind: response.kind })),
      (error) => error.failureCode === 'provider_result_unknown' && error.outcomeUnknown === true,
    );
    assert.equal(postCount, 1, `${kind} must not be posted twice`);
  }
});

test('retries one explicit pre-accept stream rejection without stream', async () => {
  const requests = [];
  const response = await runFakeImagePost(
    async (request) => {
      requests.push(request);
      return requests.length === 1 ? { status: 400, unsupported: true } : { status: 200 };
    },
    (nextResponse) => nextResponse.status === 200
      ? null
      : { kind: 'http', status: nextResponse.status, streamUnsupported: nextResponse.unsupported },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(requests.map(({ stream }) => stream), [true, false]);
});

test('retries explicit 502, 503, and 504 once but not other HTTP errors', async () => {
  for (const status of [502, 503, 504]) {
    let postCount = 0;
    await assert.rejects(runFakeImagePost(
      async () => {
        postCount += 1;
        return { status };
      },
      (response) => ({ kind: 'http', status: response.status }),
    ));
    assert.equal(postCount, 2, `${status} should use the finite retry budget`);
  }

  for (const status of [400, 401, 403, 404, 422, 500]) {
    let postCount = 0;
    await assert.rejects(runFakeImagePost(
      async () => {
        postCount += 1;
        return { status };
      },
      (response) => ({ kind: 'http', status: response.status }),
    ));
    assert.equal(postCount, 1, `${status} must not retry`);
  }
});

test('caller cancellation never retries', async () => {
  let postCount = 0;
  await assert.rejects(runFakeImagePost(
    async () => {
      postCount += 1;
      return { status: 503 };
    },
    (response) => ({ kind: 'http', status: response.status, callerAborted: true }),
  ));
  assert.equal(postCount, 1);
});

test('authentication, permission, and throttling failures never trigger stream fallback', () => {
  for (const status of [401, 403, 429]) {
    assert.deepEqual(classifyImagePostRetry({
      kind: 'http',
      status,
      streamUnsupported: true,
      attempt: 1,
      maxAttempts: 2,
    }), {
      retry: false,
      retryWithoutStream: false,
      outcomeUnknown: false,
      failureCode: null,
    });
  }
});
