export type ImagePostFailureKind = 'http' | 'transport' | 'timeout' | 'accepted_payload' | 'unknown';

export interface ImagePostRetryDecision {
  retry: boolean;
  retryWithoutStream: boolean;
  outcomeUnknown: boolean;
  failureCode: 'provider_result_unknown' | null;
}

export function classifyImagePostRetry(input: {
  kind: ImagePostFailureKind;
  status?: number;
  streamUnsupported?: boolean;
  callerAborted?: boolean;
  attempt?: number;
  maxAttempts?: number;
}): ImagePostRetryDecision;
