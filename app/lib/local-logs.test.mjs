import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';

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

test('appendLogEntry writes entries into the current startup file and readLogEntries filters newest-first results', async () => {
  const { appendLogEntry, getCurrentStartupSession, readLogEntries } = await loadLocalLogsModule();

  await withTempLogsDir(async (logsDir) => {
    const startupSession = getCurrentStartupSession();
    await appendLogEntry(
      {
        timestamp: `${startupSession.date}T08:00:00.000Z`,
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
        timestamp: `${startupSession.date}T09:00:00.000Z`,
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
    assert.equal(entries[0].startupId, startupSession.startupId);

    const raw = await readFile(
      path.join(logsDir, startupSession.date, `${startupSession.startupId}.app.log`),
      'utf8'
    );
    const stored = JSON.parse(raw.trim().split('\n')[0]);

    assert.equal(stored.startupId, startupSession.startupId);
  });
});

test('appendLogEntry redacts sensitive values and truncates oversized text', async () => {
  const { appendLogEntry, getCurrentStartupSession } = await loadLocalLogsModule();

  await withTempLogsDir(async (logsDir) => {
    const startupSession = getCurrentStartupSession();
    await appendLogEntry(
      {
        timestamp: `${startupSession.date}T10:00:00.000Z`,
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

    const raw = await readFile(
      path.join(logsDir, startupSession.date, `${startupSession.startupId}.app.log`),
      'utf8'
    );
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

test('a fresh module instance gets a new startup file while the current reader stays scoped to its own startup', async () => {
  const moduleA = await loadLocalLogsModule();
  const moduleB = await loadLocalLogsModule();

  await withTempLogsDir(async (logsDir) => {
    const startupA = moduleA.getCurrentStartupSession();
    const startupB = moduleB.getCurrentStartupSession();

    assert.notEqual(startupA.startupId, startupB.startupId);

    await moduleA.appendLogEntry(
      {
        timestamp: `${startupA.date}T08:00:00.000Z`,
        level: 'info',
        source: 'server',
        scope: 'api.startup',
        event: 'server.boot',
        message: 'startup a',
        details: null,
      },
      { logsDir }
    );

    await moduleB.appendLogEntry(
      {
        timestamp: `${startupB.date}T08:05:00.000Z`,
        level: 'info',
        source: 'server',
        scope: 'api.startup',
        event: 'server.boot',
        message: 'startup b',
        details: null,
      },
      { logsDir }
    );

    const currentEntries = await moduleB.readLogEntries({ limit: 10 }, { logsDir });
    assert.equal(currentEntries.length, 1);
    assert.equal(currentEntries[0].message, 'startup b');
    assert.equal(currentEntries[0].startupId, startupB.startupId);

    const previousEntries = await moduleB.readLogEntries(
      {
        date: startupA.date,
        startupId: startupA.startupId,
        limit: 10,
      },
      { logsDir }
    );
    assert.equal(previousEntries.length, 1);
    assert.equal(previousEntries[0].message, 'startup a');
    assert.equal(previousEntries[0].startupId, startupA.startupId);

    const files = await readdir(path.join(logsDir, startupA.date));
    assert.equal(files.includes(`${startupA.startupId}.app.log`), true);
    assert.equal(files.includes(`${startupB.startupId}.app.log`), true);
  });
});

test('readLogEntries skips invalid JSON lines and keeps valid entries from the current startup file', async () => {
  const { getCurrentStartupSession, readLogEntries } = await loadLocalLogsModule();

  await withTempLogsDir(async (logsDir) => {
    const startupSession = getCurrentStartupSession();
    const logFilePath = path.join(logsDir, startupSession.date, `${startupSession.startupId}.app.log`);
    await mkdir(path.dirname(logFilePath), { recursive: true });
    await writeFile(
      logFilePath,
      [
        '{"timestamp":"2026-04-01T08:00:00.000Z","level":"error"',
        'not-json-at-all',
        JSON.stringify({
          timestamp: `${startupSession.date}T11:00:00.000Z`,
          level: 'warn',
          source: 'server',
          scope: 'api.upload',
          event: 'request.warn',
          message: 'usable line',
          details: null,
          startupId: startupSession.startupId,
        }),
      ].join('\n'),
      'utf8'
    );

    const entries = await readLogEntries(
      {
        limit: 20,
      },
      { logsDir }
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, 'usable line');
    assert.equal(entries[0].level, 'warn');
    assert.equal(entries[0].startupId, startupSession.startupId);
  });
});

test('readLogEntries skips invalid JSON lines and keeps valid entries when targeting an explicit startup file', async () => {
  const { readLogEntries } = await loadLocalLogsModule();

  await withTempLogsDir(async (logsDir) => {
    const startupDate = '2026-04-01';
    const startupId = '09-30-12-legacy123';
    const startupDir = path.join(logsDir, startupDate);
    await mkdir(startupDir, { recursive: true });
    await writeFile(
      path.join(startupDir, `${startupId}.app.log`),
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
          startupId,
        }),
      ].join('\n'),
      'utf8'
    );

    const entries = await readLogEntries(
      {
        date: startupDate,
        startupId,
        limit: 20,
      },
      { logsDir }
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, 'usable line');
    assert.equal(entries[0].level, 'warn');
    assert.equal(entries[0].startupId, startupId);
  });
});
