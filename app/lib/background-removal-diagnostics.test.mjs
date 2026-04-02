import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectHeaderDiagnostics,
  createDownloadFailureDiagnostics,
  createSupplierProxyErrorMessage,
  createSupplierResponseDiagnostics,
  parseSupplierPayload,
} from './background-removal-diagnostics.mjs';

test('collectHeaderDiagnostics keeps only whitelisted response headers', () => {
  const headers = new Headers({
    'content-type': 'application/json',
    'content-length': '123',
    'x-request-id': 'req-1',
    authorization: 'secret',
    'set-cookie': 'should-not-log',
  });

  assert.deepEqual(collectHeaderDiagnostics(headers), {
    'content-type': 'application/json',
    'content-length': '123',
    'x-request-id': 'req-1',
  });
});

test('createSupplierResponseDiagnostics extracts body preview and trace ids from a json error payload', () => {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'content-length': '88',
    'x-request-id': 'req-header',
    'trace-id': 'trace-header',
  });
  const payload = {
    code: 'custom_router_error',
    message: 'unknown error',
    request_id: 'req-body',
  };

  assert.deepEqual(
    createSupplierResponseDiagnostics({
      response: {
        status: 502,
        statusText: 'Bad Gateway',
        headers,
      },
      bodyText: JSON.stringify(payload),
      payload,
    }),
    {
      status: 502,
      statusText: 'Bad Gateway',
      contentType: 'application/json; charset=utf-8',
      contentLength: 88,
      headerDiagnostics: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': '88',
        'x-request-id': 'req-header',
        'trace-id': 'trace-header',
      },
      bodyPreview: JSON.stringify(payload),
      traceIds: ['req-header', 'trace-header', 'req-body'],
    }
  );
});

test('parseSupplierPayload reports parse_error for non-json text and payload_invalid for json without image url', () => {
  assert.deepEqual(parseSupplierPayload('gateway timeout', 'text/plain'), {
    ok: false,
    errorStage: 'supplier.parse_error',
    payload: null,
  });

  assert.deepEqual(parseSupplierPayload('{"image":{}}', 'application/json'), {
    ok: false,
    errorStage: 'supplier.payload_invalid',
    payload: {
      image: {},
    },
  });
});

test('createDownloadFailureDiagnostics marks download_result failures with response snippets', () => {
  const headers = new Headers({
    'content-type': 'text/plain',
    'content-length': '12',
  });

  assert.deepEqual(
    createDownloadFailureDiagnostics({
      fileReference: 'https://cdn.example.com/output.png?signature=secret',
      response: {
        status: 403,
        statusText: 'Forbidden',
        headers,
      },
      bodyText: 'access denied',
    }),
    {
      failedStage: 'download_result',
      fileReferencePreview: 'https://cdn.example.com/output.png',
      host: 'cdn.example.com',
      status: 403,
      statusText: 'Forbidden',
      contentType: 'text/plain',
      contentLength: 12,
      bodyPreview: 'access denied',
    }
  );
});

test('createSupplierProxyErrorMessage exposes COMFLY stage, host, code and upstream message', () => {
  assert.equal(
    createSupplierProxyErrorMessage({
      host: 'ai.comfly.chat',
      failedStage: 'supplier.error',
      payload: {
        code: 'custom_router_error',
        message: 'unknown error',
      },
      fallbackMessage: 'Internal Server Error',
    }),
    'COMFLY 抠图代理错误（supplier.error @ ai.comfly.chat）：custom_router_error - unknown error'
  );
});
