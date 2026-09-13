const METHODS = Object.freeze({
  spawnAgent: 'collab/agent/start',
  sendInput: 'collab/agent/input',
  wait: 'collab/agent/wait',
  closeAgent: 'collab/agent/close',
  interruptAgent: 'collab/agent/interrupt',
  listAgents: 'collab/agent/list',
});

const failure = (code, message = code, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code, failureStage: 'native_collaboration', retryable: code === 'native_rpc_timeout' });

function requireClient(client) {
  if (!client || typeof client.request !== 'function') throw failure('subagents_unavailable', 'Native collaboration client is unavailable');
  return client;
}

export function createNativeCollaborationGateway({ client, methods = METHODS, timeoutMs = 120_000 } = {}) {
  const request = async (operation, params = {}) => {
    const activeClient = requireClient(client);
    let timeout;
    const timer = new Promise((_, reject) => { timeout = setTimeout(() => reject(failure('native_rpc_timeout', `${operation} timed out`)), timeoutMs); });
    try { return await Promise.race([activeClient.request(methods[operation] || operation, params), timer]); }
    catch (error) {
      if (error?.code === 'native_rpc_timeout') throw error;
      if (error?.code === 'method_not_found' || error?.code === 'unsupported') throw failure('subagents_unavailable', 'Native collaboration is not supported', error);
      throw failure('native_collaboration_failed', error?.message || 'Native collaboration request failed', error);
    } finally { clearTimeout(timeout); }
  };
  return {
    methods,
    spawnAgent: (input) => request('spawnAgent', { ...input, readonly: true }),
    sendInput: (input) => request('sendInput', input),
    wait: (input) => request('wait', input),
    closeAgent: (input) => request('closeAgent', input),
    interruptAgent: (input) => request('interruptAgent', input),
    listAgents: (input) => request('listAgents', input),
  };
}

export { METHODS };
