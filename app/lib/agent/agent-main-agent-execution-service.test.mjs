import test from 'node:test';
import assert from 'node:assert/strict';
import { executeMainAgentTurn } from './agent-main-agent-execution-service.mjs';
import { runMainAgentFlow } from './agent-main-agent-flow.mjs';

for (const mode of ['no-skill', 'locked-skill', 'confirmed']) {
  test(`composed Native turn preserves tool policy and executes once: ${mode}`, async () => {
    const requests = [];
    let prepared = 0;
    const approvedConfirmation = mode === 'confirmed' ? { toolName: 'generate_image', toolArgs: {} } : null;
    const result = await executeMainAgentTurn({
      selectedSkill: mode === 'locked-skill' ? { id: 'poster', allowedTools: ['get_canvas_context'] } : null,
      approvedConfirmation,
      getAgentModelTools: (_registry, names) => names.map((name) => ({
        function: { name, parameters: { type: 'object' } },
        commentaryPolicy: name === 'generate_image' ? 'server_fallback' : 'required',
      })),
      prepareContext: async () => { prepared += 1; return { userText: 'Generate an image' }; },
      nativeTurnContext: { sources: [] },
      toolCallbackOptions: { execute: async () => ({}) },
      buildNativeRequest: () => ({ sessionId: 'session', identity: { runId: 'run' } }),
      runMainAgent: (input) => runMainAgentFlow({
        ...input,
        runTurn: async (request) => { requests.push(request); return { stopReason: 'completed' }; },
      }),
    });
    assert.equal(result.loopResult.stopReason, 'completed');
    assert.equal(prepared, 1);
    assert.equal(requests.length, 1);
    const tools = requests[0].tools;
    const image = tools.find((tool) => tool.name === 'generate_image');
    assert.equal(image.commentaryPolicy, 'server_fallback');
    assert.equal(image.requiresCommentary, true);
    assert.equal(tools.some((tool) => tool.name === 'select_visual_skill'), mode === 'no-skill');
    if (approvedConfirmation) assert.deepEqual(tools.map((tool) => tool.name), ['generate_image']);
    else assert.equal(tools.find((tool) => tool.name === 'get_canvas_context').commentaryPolicy, 'required');
  });
}

test('the main flow rejects incomplete wiring without starting a Native turn', async () => {
  await assert.rejects(runMainAgentFlow(), /requires prepareTurn/);
  await assert.rejects(runMainAgentFlow({ prepareTurn: async () => ({}) }), /requires buildRequest/);
  await assert.rejects(runMainAgentFlow({ prepareTurn: async () => ({}), buildRequest: () => ({}) }), /requires executeTool/);
});
