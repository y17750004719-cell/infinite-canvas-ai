import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { adaptCanonicalEvent } from './canonical-event-adapter.mjs';
import { projectNativeEvent } from './native-event-projector.mjs';

const source = ts.createSourceFile('agent-request-execution-state.mjs', readFileSync(new URL('./agent-request-execution-state.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
function declaration(name) {
  let found;
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(source) === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, name);
  return `${ts.isVariableDeclaration(found) ? 'const ' : ''}${found.getText(source)};`;
}
function evaluate(code) {
  return new Function(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText)();
}

test('server and client preserve tool identity, failure, and public progress descriptions end to end', () => {
  const convert = projectNativeEvent;
  const identity = { threadId: 'thread', turnId: 'turn', taskId: 'task', operationId: 'op', runId: 'run', itemId: 'run:tool:call', toolCallId: 'call', executionId: 'exec', parentItemId: 'commentary', timestampMs: 1000 };
  for (const event of [
    { type: 'tool_start', toolName: 'get_canvas_context' },
    { type: 'tool_result', toolName: 'get_canvas_context', isError: true, result: { summary: 'Unavailable' } },
    { type: 'progress_update', stepId: 'canvas_context', label: 'Read', detail: 'Public detail', completionSummary: 'Public summary' },
  ]) {
    const wire = convert({ ...identity, ...event }, identity)[0];
    const adapted = adaptCanonicalEvent({ ...wire, sequence: 1 });
    for (const key of ['itemId', 'toolCallId', 'executionId', 'parentItemId']) assert.equal(adapted[key], identity[key]);
    if (event.type === 'tool_result') assert.equal(adapted.isError, true);
    if (event.type === 'progress_update') {
      assert.equal(adapted.detail, event.detail);
      assert.equal(adapted.completionSummary, event.completionSummary);
    }
  }
});

test('tool settlement clears heartbeat ownership and independent phases receive child identities', () => {
  const harness = evaluate(`
    const runId = 'run';
    let lastCommentaryItemId = 'commentary';
    const events = [];
    const tracker = { update: value => events.push(value), stamp: () => ({}), completeItem: () => {} };
    const stamp = () => tracker.stamp();
    const writeLifecycleEvent = value => events.push(value);
    ${['toolItemId', 'toolExecutionId', 'settledToolCalls', 'toolEventMetadata'].map(declaration).join('\n')}
    let activeAgentStageLabel = 'Initial';
    let activeAgentStage = { label: activeAgentStageLabel, phase: 'analyzing', action: 'analyze_request' };
    ${declaration('writeProgress')}
    ${declaration('writeToolResultEvent')}
    return { writeProgress, writeToolResultEvent, events, stage: () => activeAgentStage };
  `);
  harness.writeProgress({ stepId: 'tool', status: 'active', phase: 'reading', label: 'Read', toolCallId: 'call', toolName: 'get_canvas_context' });
  harness.writeToolResultEvent('call', 'get_canvas_context', { success: true });
  assert.equal(harness.stage().toolCallId, undefined);
  assert.equal(harness.stage().action, 'await_model_response');
  harness.writeProgress({ stepId: 'tool', status: 'active', phase: 'reading', label: 'Late heartbeat', toolCallId: 'call' });
  assert.equal(harness.stage().toolCallId, undefined);
  harness.writeProgress({ stepId: 'image_prompt', status: 'completed', toolCallId: 'image', label: 'Prepared' });
  assert.equal(harness.events.at(-1).itemId, 'run:image_prompt:image');
  assert.equal(harness.events.at(-1).parentItemId, 'run:tool:image');
});
