export function classifyImagePostRetry({
  kind,
  status = undefined,
  failureCode = null,
  streamUnsupported = false,
  callerAborted = false,
  attempt = 1,
  maxAttempts = 1,
}) {
  if (failureCode === 'provider_permission_denied') {
    return { retry: false, retryWithoutStream: false, outcomeUnknown: false, failureCode };
  }
  if (callerAborted) {
    return { retry: false, retryWithoutStream: false, outcomeUnknown: false, failureCode: null };
  }

  if (kind === 'http') {
    if (status >= 400 && status < 500 && ![401, 403, 429].includes(status) && streamUnsupported) {
      return { retry: true, retryWithoutStream: true, outcomeUnknown: false, failureCode: null };
    }
    return {
      retry: (status === 502 || status === 503 || status === 504) && attempt < maxAttempts,
      retryWithoutStream: false,
      outcomeUnknown: false,
      failureCode: null,
    };
  }

  if (kind === 'transport' || kind === 'timeout' || kind === 'accepted_payload') {
    return {
      retry: false,
      retryWithoutStream: false,
      outcomeUnknown: true,
      failureCode: 'provider_result_unknown',
    };
  }

  return { retry: false, retryWithoutStream: false, outcomeUnknown: false, failureCode: null };
}
