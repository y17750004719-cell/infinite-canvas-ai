'use client';

import { useEffect, useRef } from 'react';

const DEDUPE_WINDOW_MS = 15000;

type ClientLogPayload = {
  message: string;
  stack?: string;
  type: string;
  pageUrl: string;
  userAgent: string;
  workspaceId?: string;
  extra?: Record<string, unknown>;
};

function getWorkspaceId(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  const workspaceId = params.get('workspace');
  return workspaceId || undefined;
}

function trimStack(stack?: string): string | undefined {
  if (typeof stack !== 'string') return undefined;
  const trimmed = stack.trim();
  return trimmed ? trimmed : undefined;
}

function buildUnhandledRejectionPayload(reason: unknown): Pick<ClientLogPayload, 'message' | 'stack' | 'extra'> {
  if (reason instanceof Error) {
    return {
      message: reason.message || 'Unhandled promise rejection',
      stack: trimStack(reason.stack),
      extra: {
        reasonName: reason.name,
      },
    };
  }

  if (typeof reason === 'string') {
    return {
      message: reason,
      extra: {
        reasonType: 'string',
      },
    };
  }

  return {
    message: 'Unhandled promise rejection',
    extra: {
      reasonType: typeof reason,
      reasonPreview: typeof reason === 'undefined' ? 'undefined' : String(reason),
    },
  };
}

async function reportClientError(payload: ClientLogPayload) {
  try {
    await fetch('/api/debug/logs/client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Ignore reporting failures to avoid recursive client-side noise.
  }
}

export default function ClientErrorReporter() {
  const seenRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') {
      return undefined;
    }

    const shouldReport = (fingerprint: string) => {
      const now = Date.now();
      const seen = seenRef.current;

      for (const [key, timestamp] of seen.entries()) {
        if (now - timestamp > DEDUPE_WINDOW_MS) {
          seen.delete(key);
        }
      }

      const previous = seen.get(fingerprint);
      if (previous && now - previous < DEDUPE_WINDOW_MS) {
        return false;
      }

      seen.set(fingerprint, now);
      return true;
    };

    const handleError = (event: ErrorEvent) => {
      const message =
        typeof event.message === 'string' && event.message.trim()
          ? event.message.trim()
          : event.error instanceof Error && event.error.message
            ? event.error.message
            : 'Unhandled client error';
      const stack = event.error instanceof Error ? trimStack(event.error.stack) : undefined;
      const pageUrl = window.location.href;
      const fingerprint = ['window.error', message, stack || '', pageUrl].join('::');

      if (!shouldReport(fingerprint)) {
        return;
      }

      void reportClientError({
        message,
        stack,
        type: 'window.error',
        pageUrl,
        userAgent: navigator.userAgent,
        workspaceId: getWorkspaceId(),
        extra: {
          filename: event.filename || null,
          lineno: typeof event.lineno === 'number' ? event.lineno : null,
          colno: typeof event.colno === 'number' ? event.colno : null,
        },
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const pageUrl = window.location.href;
      const rejection = buildUnhandledRejectionPayload(event.reason);
      const fingerprint = ['unhandledrejection', rejection.message, rejection.stack || '', pageUrl].join('::');

      if (!shouldReport(fingerprint)) {
        return;
      }

      void reportClientError({
        message: rejection.message,
        stack: rejection.stack,
        type: 'unhandledrejection',
        pageUrl,
        userAgent: navigator.userAgent,
        workspaceId: getWorkspaceId(),
        extra: rejection.extra,
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}
