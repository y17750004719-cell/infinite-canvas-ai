import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionService, validateVisualSkillSelection, validateConfirmation, resolveClarification, validateClarificationResponse, resolveContextSelection, resolveRecoveryContinuation, selectSkillFromInput } from './agent-interaction-service.mjs';

test('visual Skill selection requires high confidence and image pipeline skill', () => {
  const skill = { id: 'poster', name: 'Poster', executionMode: 'image_pipeline' };
  assert.deepEqual(validateVisualSkillSelection({ args: { skillId: 'poster', confidence: 'medium' }, skills: [skill] }), { locked: false, reason: 'confidence_below_high' });
  assert.equal(validateVisualSkillSelection({ args: { skillId: 'poster', confidence: 'high' }, skills: [skill] }).locked, true);
  assert.equal(validateVisualSkillSelection({ args: { skillId: 'missing', confidence: 'high' }, skills: [skill] }).failureCode, 'unknown_visual_skill');
});

test('confirmation and clarification helpers are deterministic', () => {
  const approved = { toolName: 'generate_image', toolArgs: { prompt: 'x', count: 1 } };
  assert.equal(validateConfirmation({ approved, toolName: 'generate_image', args: { count: 1, prompt: 'x' } }).ok, true);
  assert.equal(validateConfirmation({ approved, toolName: 'generate_image', args: { prompt: 'y' } }).ok, false);
  assert.deepEqual(resolveClarification({ state: { question: 'q' }, response: { customText: 'answer', proceedWithCurrent: true } }), { question: 'q', workingBrief: 'answer', proceedWithCurrent: true });
});

test('interaction service loads and emits selected Skill through injected dependencies', async () => {
  const events = [];
  const service = createInteractionService({ loadSkillContent: async () => 'rules', emitEvent: (event) => events.push(event) });
  const result = await service.selectVisualSkill({ args: { skillId: 'poster', confidence: 'high' }, skills: [{ id: 'poster', name: 'Poster', executionMode: 'image_pipeline' }] });
  assert.equal(result.skill.id, 'poster');
  assert.equal(result.modelResult.content, 'rules');
  assert.equal(events[0].type, 'skill_selected');
});

test('interaction boundaries reject stale or out-of-contract responses', () => {
  assert.equal(validateClarificationResponse({ request: { options: [{ id: 'a' }] }, response: { selectedOptionId: 'b' } }).ok, false);
  assert.equal(resolveContextSelection({ candidates: [{ id: 'a' }], selectedId: 'b' }).ok, false);
  assert.equal(resolveRecoveryContinuation({ record: { taskId: 't' }, decision: 'resume', mode: 'bad' }).ok, false);
  assert.equal(selectSkillFromInput({ clarificationRequest: { dimension: 'skill_selection', options: [{ id: 'no_skill' }] }, clarificationResponse: { selectedOptionId: 'other' } }).error.code, 'skill_selection_invalid');
});

test('interaction persistence hooks are injectable', async () => {
  const calls = [];
  const service = createInteractionService({ persistState: async (...args) => calls.push(['save', ...args]), loadState: async (key) => ({ key }), persistConfirmation: async (record) => ({ ...record, saved: true }) });
  await service.saveState('k', { value: 1 });
  assert.deepEqual(await service.loadState('k'), { key: 'k' });
  assert.deepEqual(await service.saveConfirmation({ id: 'c' }), { id: 'c', saved: true });
  assert.equal(calls.length, 1);
});
