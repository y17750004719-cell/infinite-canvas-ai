import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { PRODUCTION_TIMEOUT_MS } from '../production-timeouts.mjs';

export const NATIVE_CODEX_ALLOWED_METHODS = Object.freeze([
  'initialize',
  'thread/start',
  'thread/resume',
  'thread/read',
  'thread/turns/list',
  'thread/items/list',
  'turn/start',
  'turn/steer',
  'turn/interrupt',
  'skills/list',
  'skills/extraRoots/set',
]);

const ALLOWED_METHODS = new Set(NATIVE_CODEX_ALLOWED_METHODS);
const DEFAULT_REQUEST_TIMEOUT_MS = PRODUCTION_TIMEOUT_MS;
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_LINE_BYTES = 4 * 1024 * 1024;

export class NativeCodexStdioError extends Error {
  constructor(message, { code, method, outcomeUnknown = false, retrySafe = false } = {}) {
    super(message);
    this.name = 'NativeCodexStdioError';
    this.code = code || 'native_codex_stdio_error';
    this.method = method;
    this.outcomeUnknown = outcomeUnknown;
    this.retrySafe = retrySafe;
  }
}

function clientError(message, details) {
  return new NativeCodexStdioError(message, details);
}

function assertAbsolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`);
  }
}

function normalizeEnv(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('env must be an explicit object');
  }
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => {
      if (typeof value !== 'string') throw new TypeError(`env.${key} must be a string`);
      return [key, value];
    }),
  );
}

function positiveInteger(value, fallback, label) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return resolved;
}

function isRpcResponse(message) {
  return message && typeof message === 'object' && Object.hasOwn(message, 'id') && !message.method;
}

function isRpcRequest(message) {
  return message && typeof message === 'object' && Object.hasOwn(message, 'id') && typeof message.method === 'string';
}

function isRpcNotification(message) {
  return message && typeof message === 'object' && !Object.hasOwn(message, 'id') && typeof message.method === 'string';
}

export class NativeCodexStdioClient {
  constructor({
    binaryPath,
    args = [],
    cwd,
    env,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
    maxLineBytes = DEFAULT_MAX_LINE_BYTES,
    onNotification,
    onServerRequest,
    spawnImpl = nodeSpawn,
  }) {
    assertAbsolute(binaryPath, 'binaryPath');
    assertAbsolute(cwd, 'cwd');
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw new TypeError('args must be an array of strings');
    }
    if (typeof spawnImpl !== 'function') throw new TypeError('spawnImpl must be a function');
    if (onNotification != null && typeof onNotification !== 'function') {
      throw new TypeError('onNotification must be a function');
    }
    if (onServerRequest != null && typeof onServerRequest !== 'function') {
      throw new TypeError('onServerRequest must be a function');
    }

    this.binaryPath = binaryPath;
    this.args = [...args];
    this.cwd = cwd;
    this.env = normalizeEnv(env);
    this.requestTimeoutMs = positiveInteger(requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs');
    this.closeTimeoutMs = positiveInteger(closeTimeoutMs, DEFAULT_CLOSE_TIMEOUT_MS, 'closeTimeoutMs');
    this.maxLineBytes = positiveInteger(maxLineBytes, DEFAULT_MAX_LINE_BYTES, 'maxLineBytes');
    this.onNotification = onNotification || (() => {});
    this.onServerRequest = onServerRequest || null;
    this.spawnImpl = spawnImpl;

    this.child = null;
    this.started = false;
    this.initialized = false;
    this.closing = false;
    this.closed = false;
    this.terminalError = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = Buffer.alloc(0);
    this.orderedDispatch = Promise.resolve();
    this.exitPromise = null;
    this.resolveExit = null;
  }

  async start(initializeParams) {
    if (this.started) throw clientError('Native Codex client already started', { code: 'already_started' });
    this.started = true;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });

    try {
      this.child = this.spawnImpl(this.binaryPath, this.args, {
        cwd: this.cwd,
        env: this.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.#bindProcess();
      const result = await this.#request('initialize', initializeParams, this.requestTimeoutMs, true);
      this.#writeMessage({ method: 'initialized' });
      this.initialized = true;
      return result;
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    }
  }

  request(method, params, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (!ALLOWED_METHODS.has(method) || method === 'initialize') {
      return Promise.reject(clientError('RPC method is not allowed', { code: 'rpc_method_not_allowed', method }));
    }
    if (!this.initialized) {
      return Promise.reject(this.terminalError || clientError('Native Codex client is not initialized', { code: 'not_initialized', method }));
    }
    return this.#request(method, params, positiveInteger(timeoutMs, this.requestTimeoutMs, 'timeoutMs'));
  }

  async close() {
    if (this.closed) return;
    this.closing = true;
    this.#rejectAll(clientError('Native Codex client closed', { code: 'client_closed' }));

    const child = this.child;
    if (!child) {
      this.closed = true;
      this.resolveExit?.();
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      await this.exitPromise;
      return;
    }

    child.kill('SIGTERM');
    let forceTimer;
    await Promise.race([
      this.exitPromise,
      new Promise((resolve) => {
        forceTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          resolve();
        }, this.closeTimeoutMs);
        forceTimer.unref?.();
      }),
    ]);
    if (forceTimer) clearTimeout(forceTimer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await this.exitPromise;
    }
  }

  #bindProcess() {
    const child = this.child;
    const settleProcess = () => {
      if (this.closed) return;
      this.closed = true;
      this.initialized = false;
      this.terminalError ||= clientError('Native Codex process exited', { code: 'process_exited' });
      this.#rejectAll(this.terminalError);
      this.resolveExit?.();
    };
    child.stdout.on('data', (chunk) => this.#consumeStdout(chunk));
    child.stdout.on('error', () => this.#failConnection('stdout_error'));
    child.stdin.on('error', () => this.#failConnection('stdin_error'));
    child.stderr.on('data', () => {});
    child.on('error', () => this.#failConnection('process_error'));
    child.on('exit', settleProcess);
    child.on('close', settleProcess);
  }

  #request(method, params, timeoutMs, allowBeforeInitialized = false) {
    if (this.closed || this.closing) {
      return Promise.reject(this.terminalError || clientError('Native Codex client is closed', { code: 'client_closed', method }));
    }
    if (!allowBeforeInitialized && !this.initialized) {
      return Promise.reject(clientError('Native Codex client is not initialized', { code: 'not_initialized', method }));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(clientError('Native Codex request timed out', {
          code: 'request_timeout',
          method,
          outcomeUnknown: true,
          retrySafe: false,
        }));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.#writeMessage({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  #writeMessage(message) {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      throw clientError('Native Codex transport is unavailable', { code: 'transport_unavailable' });
    }
    let encoded;
    try {
      encoded = `${JSON.stringify(message)}\n`;
    } catch {
      throw clientError('Native Codex message is not serializable', { code: 'message_not_serializable' });
    }
    stdin.write(encoded, (error) => {
      if (error) this.#failConnection('stdin_error');
    });
  }

  #consumeStdout(chunk) {
    if (this.closed) return;
    const next = Buffer.concat([this.stdoutBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    if (next.length > this.maxLineBytes && next.indexOf(0x0a) === -1) {
      this.#failConnection('line_too_large');
      return;
    }
    this.stdoutBuffer = next;
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf(0x0a);
      if (newlineIndex === -1) break;
      if (newlineIndex > this.maxLineBytes) {
        this.#failConnection('line_too_large');
        return;
      }
      const line = this.stdoutBuffer.subarray(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newlineIndex + 1);
      if (!line.toString('utf8').trim()) continue;
      let message;
      try {
        message = JSON.parse(line.toString('utf8'));
      } catch {
        this.#failConnection('malformed_json');
        return;
      }
      this.#dispatchMessage(message);
    }
  }

  #dispatchMessage(message) {
    if (isRpcResponse(message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (Object.hasOwn(message, 'error')) {
        pending.reject(clientError('Native Codex server rejected the request', {
          code: 'server_error',
          method: pending.method,
          outcomeUnknown: false,
          retrySafe: false,
        }));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (isRpcRequest(message)) {
      this.#enqueueOrdered(() => {
        void this.#handleServerRequest(message);
      });
      return;
    }

    if (isRpcNotification(message)) {
      this.#enqueueOrdered(() => this.onNotification({ method: message.method, params: message.params }));
      return;
    }

    this.#failConnection('invalid_message');
  }

  #enqueueOrdered(callback) {
    this.orderedDispatch = this.orderedDispatch.then(async () => {
      if (this.closed || this.closing) return;
      try {
        await callback();
      } catch {
        this.#failConnection('notification_handler_failed');
      }
    });
  }

  async #handleServerRequest(message) {
    if (message.method !== 'item/tool/call' || !this.onServerRequest) {
      this.#writeServerResponse({ id: message.id, error: { code: -32601, message: 'Method not found' } });
      return;
    }
    try {
      const result = await this.onServerRequest({ method: message.method, params: message.params });
      this.#writeServerResponse({ id: message.id, result });
    } catch {
      this.#writeServerResponse({ id: message.id, error: { code: -32000, message: 'Dynamic tool request failed' } });
    }
  }

  #writeServerResponse(message) {
    try {
      this.#writeMessage(message);
    } catch {
      this.#failConnection('server_response_write_failed');
    }
  }

  #failConnection(code) {
    if (this.closed) return;
    this.closing = true;
    this.initialized = false;
    this.terminalError ||= clientError('Native Codex transport failed', { code });
    this.#rejectAll(this.terminalError);
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }

  #rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
