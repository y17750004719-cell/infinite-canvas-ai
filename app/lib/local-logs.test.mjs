import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

async function loadLocalLogsModule() {
  return import(`./local-logs.ts?cacheBust=${Date.now()}-${Math.random()}`);
}

async function withTempLogsDir(run) {
  const logsDir = await mkdtemp(path.join(os.tmpdir(), 'zo-local-logs-'));
  try {
    await run(logsDir);
  } finally {
    await rm(logsDir, { recursive: true, force: true });
  }
}

test('appendLogEntry writes structured entries and readLogEntries filters newest-first results', async () => {
  const { appendLogEntry, readLogEntries } = await loadLocalLogsModule();

  await withTempLogsDir(async (logsDir) => {
    await appendLogEntry(
      {
        timestamp: '2026-04-01T08:00:00.000Z',
        level: 'info',
        source: 'server',
        scope: 'api.upload',
        event: 'request.start',
        message: 'Upload request started',
        details: { route: '/api/upload' },
        requestId: 'req-server',
      },
      { logsDir }
    );

    await appendLogEntry(
      {
        timestamp: '2026-04-01T09:00:00.000Z',
        level: 'error',
        source: 'client',
        scope: 'client.error',
        event: 'window.error',
        message: 'client crash happened',
        pageUrl: 'http://localhost:3000/?workspace=abc',
        details: { stackPreview: 'Error: boom' },
        requestId: 'req-client',
      },
      { logsDir }
    );

    const entries = await readLogEntries(
      {
        date: '2026-04-01',
        level: 'error',
        source: 'client',
        q: 'crash',
        limit: 10,
      },
      { logsDir }
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, 'client crash happened');
    assert.equal(entries[0].requestId, 'req-client');
    assert.equal(entries[0].pageUrl, 'http://localhost:3000/?workspace=abc');
  });
});

test('appendLogEntry redacts sensitive values and truncates oversized text', async () => {
  const { appendLogEntry } = await loadLocalLogsModule();

  await withTempLogsDir(async (logsDir) => {
    await appendLogEntry(
      {
        timestamp: '2026-04-01T10:00:00.000Z',
        level: 'error',
        source: 'server',
        scope: 'api.generate',
        event: 'request.error',
        message: 'Supplier request failed',
        details: {
          authorization: 'Bearer secret-token-value',
          token: 'super-secret',
          nested: {
            cookie: 'session=abc',
            imageData: `data:image/png;base64,${'A'.repeat(256)}`,
          },
          prompt: 'x'.repeat(2400),
        },
      },
      { logsDir }
    );

    const raw = await readFile(path.join(logsDir, '2026-04-01.app.log'), 'utf8');
    const stored = JSON.parse(raw.trim());

    assert.equal(stored.details.authorization, '[REDACTED]');
    assert.equal(stored.details.token, '[REDACTED]');
    assert.equal(stored.details.nested.cookie, '[REDACTED]');
    assert.equal(stored.details.nested.imageData, '[BASE64_IMAGE_REDACTED]');
    assert.equal(typeof stored.details.prompt, 'string');
    assert.equal(stored.details.prompt.includes('x'.repeat(2400)), false);
    assert.equal(stored.details.prompt.includes('[TRUNCATED '), true);
  });
});

test('readLogEntries skips invalid JSON lines and keeps valid entries', async () => {
  const { readLogEntries } = await loadLocalLogsModule();

  await withTempLogsDir(async (logsDir) => {
    const logFilePath = path.join(logsDir, '2026-04-01.app.log');
    await writeFile(
      logFilePath,
      [
        '{"timestamp":"2026-04-01T08:00:00.000Z","level":"error"',
        'not-json-at-all',
        JSON.stringify({
          timestamp: '2026-04-01T11:00:00.000Z',
          level: 'warn',
          source: 'server',
          scope: 'api.upload',
          event: 'request.warn',
          message: 'usable line',
          details: null,
        }),
      ].join('\n'),
      'utf8'
    );

    const entries = await readLogEntries(
      {
        date: '2026-04-01',
        limit: 20,
      },
      { logsDir }
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, 'usable line');
    assert.equal(entries[0].level, 'warn');
  });
});
