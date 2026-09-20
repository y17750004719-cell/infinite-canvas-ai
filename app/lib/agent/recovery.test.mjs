import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAgentFailure,
  createAgentRecoveryRecord,
  enrichAgentRecoverySkillMetadata,
  normalizeAgentRecoveryRecord,
  sanitizeAgentFailureMessage,
} from './recovery.mjs';

const recoveryWithoutSkill = () => createAgentRecoveryRecord({
  taskId: 'task-1', runId: 'run-1', operationId: 'operation-1', sessionId: 'topic-1',
  sourceUserMessageId: 'user-1', status: 'failed', resumeRoute: 'main_agent', intent: 'image',
  originalRequest: '生成海报', failureStage: 'tool_dispatch', failureMessage: 'failed',
});

test('legacy recovery adopts a paired Skill lock from the same task progress', () => {
  const hash = 'a'.repeat(64);
  const result = enrichAgentRecoverySkillMetadata(recoveryWithoutSkill(), {
    messages: [
      { id: 'user-1', role: 'user', content: '生成海报' },
      {
        role: 'assistant', taskSnapshot: { taskId: 'task-1' },
        agentRunProgress: {
          operationId: 'operation-1',
          steps: [{ stepId: 'skill:poster', itemType: 'skill', skillContentHash: hash }],
        },
      },
    ],
  });
  assert.equal(result.skillId, 'poster');
  assert.equal(result.skillContentHash, hash);
});

test('legacy recovery rejects cross-task progress and unpaired Skill metadata', () => {
  const result = enrichAgentRecoverySkillMetadata(recoveryWithoutSkill(), {
    messages: [
      { id: 'user-1', role: 'user', content: '生成海报', skill: { id: 'source-only' } },
      {
        role: 'assistant', taskSnapshot: { taskId: 'other-task' },
        agentRunProgress: {
          operationId: 'operation-1',
          steps: [{ stepId: 'skill:other', itemType: 'skill', skillContentHash: 'b'.repeat(64) }],
        },
      },
    ],
  });
  assert.equal(result.skillId, null);
  assert.equal(result.skillContentHash, undefined);
});

test('matching journal Skill lock overrides changed client metadata', () => {
  const durableHash = 'c'.repeat(64);
  const result = enrichAgentRecoverySkillMetadata({
    ...recoveryWithoutSkill(), skillId: 'client-skill', skillContentHash: 'd'.repeat(64),
  }, {
    sessionId: 'topic-1',
    messages: [{
      id: 'user-1', role: 'user', content: '生成海报',
      skill: { id: 'client-skill', skillContentHash: 'd'.repeat(64) },
    }],
    journalEvents: [{
      type: 'item.updated', threadId: 'topic-1', taskId: 'task-1', operationId: 'operation-1', runId: 'run-1',
      item: { eventType: 'skill_selected', payload: { skillId: 'poster', skillContentHash: durableHash } },
    }],
  });
  assert.equal(result.skillId, 'poster');
  assert.equal(result.skillContentHash, durableHash);
});

test('matching journal failure recovery record is authoritative for its Skill lock', () => {
  const durableHash = 'e'.repeat(64);
  const result = enrichAgentRecoverySkillMetadata(recoveryWithoutSkill(), {
    sessionId: 'topic-1',
    messages: [{ id: 'user-1', role: 'user', content: '生成海报' }],
    journalEvents: [{
      type: 'agent_error', threadId: 'topic-1', taskId: 'task-1', operationId: 'operation-1', runId: 'run-2',
      recoveryRecord: { skillId: 'poster', skillContentHash: durableHash },
    }],
  });
  assert.equal(result.skillId, 'poster');
  assert.equal(result.skillContentHash, durableHash);
});

test('journal Skill lock cannot cross operation or session identity', () => {
  const result = enrichAgentRecoverySkillMetadata(recoveryWithoutSkill(), {
    sessionId: 'topic-1',
    messages: [{ id: 'user-1', role: 'user', content: '生成海报' }],
    journalEvents: [
      {
        type: 'item.updated', threadId: 'topic-2', taskId: 'task-1', operationId: 'operation-1', runId: 'run-1',
        item: { eventType: 'skill_selected', payload: { skillId: 'wrong-session', skillContentHash: 'e'.repeat(64) } },
      },
      {
        type: 'item.updated', threadId: 'topic-1', taskId: 'task-1', operationId: 'operation-2', runId: 'run-1',
        item: { eventType: 'skill_selected', payload: { skillId: 'wrong-operation', skillContentHash: 'f'.repeat(64) } },
      },
    ],
  });
  assert.equal(result.skillId, null);
  assert.equal(result.skillContentHash, undefined);
});

test('recovery records are bounded and keep stable task state', () => {
  const record = createAgentRecoveryRecord({
    taskId: 'task-1', runId: 'run-1', operationId: 'operation-1', lastSequence: 0, sessionId: 'topic-1', sourceUserMessageId: 'user-1',
    status: 'failed', resumeRoute: 'main_agent', intent: 'image', originalRequest: '生成海报',
    failureStage: 'image_pipeline', failureMessage: '504 upstream timeout https://private.test/x',
    skillId: 'poster', skillContentHash: 'a'.repeat(64), contextEntityIds: ['a', 'a'], visualReferenceIds: ['v'],
    completedAssetCount: 2,
    referenceContext: {
      references: [{
        id: 'ref-1',
        src: '/image.png',
        assetId: 'topic-asset:topic-hash:content-hash',
        originalSrc: 'https://example.test/original.png',
        label: '参考图',
        source: 'history',
        role: 'reference',
        sourceTaskId: 'task-1',
        sourceVersionId: 'version-1',
      }],
      composerSegments: [{ type: 'reference', referenceId: 'ref-1' }],
    },
  });
  assert.equal(record.failure.kind, 'timeout');
  assert.equal(record.failure.retryability, 'retryable');
  assert.equal(record.operationId, 'operation-1');
  assert.equal(record.lastSequence, 0);
  assert.doesNotMatch(record.failure.message, /https?:/);
  assert.deepEqual(record.contextEntityIds, ['a']);
  assert.equal(record.completedAssetCount, 2);
  assert.equal(record.skillContentHash, 'a'.repeat(64));
  assert.equal(record.referenceContext.references[0].sourceVersionId, 'version-1');
  assert.equal(record.referenceContext.references[0].assetId, 'topic-asset:topic-hash:content-hash');
  assert.equal(record.referenceContext.references[0].originalSrc, 'https://example.test/original.png');
});

test('recovery records retain bounded executed tool call identity', () => {
  const record = createAgentRecoveryRecord({
    taskId: 'task-tools', runId: 'run-tools', sessionId: 'topic-1', sourceUserMessageId: 'user-1',
    status: 'failed', resumeRoute: 'main_agent', intent: 'image', originalRequest: '生成图片',
    failureStage: 'image_pipeline', failureMessage: '供应商失败',
    toolCalls: [
      { callId: 'call-1', attemptId: 'attempt-1', taskId: 'task-tools', toolName: 'generate_image', status: 'completed', startedAt: 1, completedAt: 2 },
      { callId: 'call-1', attemptId: 'attempt-1', taskId: 'task-tools', toolName: 'generate_image', status: 'completed', startedAt: 1, completedAt: 2 },
    ],
  });
  assert.equal(record.toolCalls.length, 2);
  assert.equal(record.toolCalls[0].status, 'completed');
  assert.equal(record.toolCalls[0].taskId, 'task-tools');
});

test('legacy recovery records without operation identity are rejected', () => {
  const record = normalizeAgentRecoveryRecord({
    version: 1,
    taskId: 'task-legacy',
    runId: 'run-legacy',
    sessionId: 'topic-1',
    sourceUserMessageId: 'user-1',
    status: 'failed',
    resumeRoute: 'main_agent',
    intent: 'chat',
    originalRequest: '继续任务',
    failure: { stage: 'unknown', kind: 'unknown', message: '失败', retryability: 'unknown' },
    skillId: null,
    contextEntityIds: [],
    visualReferenceIds: [],
    completedAssetCount: 0,
    createdAt: 1,
  });
  assert.equal(record, null);
});

test('terminal contract recovery retains the operation lock and resumable Main Agent transcript', () => {
  const record = createAgentRecoveryRecord({
    taskId: 'task-1', runId: 'run-2', sessionId: 'topic-1', sourceUserMessageId: 'user-1',
    status: 'failed', resumeRoute: 'main_agent', intent: 'image', originalRequest: '编辑海报',
    failureStage: 'terminal_contract', failureMessage: '图像合同未完成',
    imageOperation: 'edit', targetReferenceId: 'reference-1',
    mainAgentLoop: {
      transcript: [{ role: 'assistant', content: [{ type: 'text', text: '准备提交合同' }] }],
      budgets: { turnsUsed: 3, toolCallsUsed: 2, budgetedToolCallsUsed: 0, mutationToolCallsUsed: 0 },
      selectedSkillId: 'poster',
      skillRead: true,
      contextScopes: [],
    },
  });
  assert.equal(record.imageOperation, 'edit');
  assert.equal(record.targetReferenceId, 'reference-1');
  assert.equal(record.mainAgentLoop.skillRead, true);
  assert.equal(record.mainAgentLoop.transcript.length, 1);
});

test('recovery records strictly normalize and persist bounded visual summaries', () => {
  const record = createAgentRecoveryRecord({
    taskId: 'task-1', runId: 'run-1', sessionId: 'topic-1', sourceUserMessageId: 'user-1',
    status: 'failed', resumeRoute: 'main_agent', intent: 'image', originalRequest: '继续修改图片',
    failureStage: 'planning', failureMessage: '连接中断',
    visualSummary: {
      version: 1,
      ignored: 'drop me',
      references: [
        {
          referenceId: 'history-image:1',
          description: `  ${'A'.repeat(2100)}  `,
          salientSubjects: ['人物', '人物', ...Array.from({ length: 30 }, (_, index) => `主体 ${index}`)],
          visibleText: ['标题', '标题', ...Array.from({ length: 30 }, (_, index) => `文字 ${index}`)],
          assetUrl: 'https://private.test/image.png',
        },
      ],
    },
  });

  assert.deepEqual(Object.keys(record.visualSummary), ['version', 'references']);
  assert.equal(record.visualSummary.references.length, 1);
  assert.equal(record.visualSummary.references[0].referenceId, 'history-image:1');
  assert.equal(record.visualSummary.references[0].description.length, 2000);
  assert.equal(record.visualSummary.references[0].salientSubjects.length, 24);
  assert.equal(record.visualSummary.references[0].visibleText.length, 24);
  assert.equal(record.visualSummary.references[0].assetUrl, undefined);
});

test('recovery normalization drops invalid visual summaries', () => {
  const base = {
    version: 1,
    operationId: 'operation-1',
    taskId: 'task-1', runId: 'run-1', sessionId: 'topic-1', sourceUserMessageId: 'user-1',
    status: 'failed', resumeRoute: 'main_agent', intent: 'image', originalRequest: '继续修改图片',
    failure: { stage: 'planning', kind: 'transport', message: '连接中断', retryability: 'retryable' },
    skillId: null, contextEntityIds: [], visualReferenceIds: [], completedAssetCount: 0, createdAt: 1,
  };

  assert.equal(normalizeAgentRecoveryRecord({ ...base, visualSummary: { version: 2, references: [] } }).visualSummary, undefined);
  assert.deepEqual(normalizeAgentRecoveryRecord({ ...base, visualSummary: { version: 1, references: [] } }).visualSummary, {
    version: 1,
    references: [],
  });
  assert.equal(normalizeAgentRecoveryRecord({
    ...base,
    visualSummary: {
      version: 1,
      references: [
        { referenceId: 'history-image:1', description: 'first' },
        { referenceId: 'history-image:1', description: 'duplicate' },
      ],
    },
  }).visualSummary, undefined);
});

test('recovery snapshots retain saved assets for deterministic local delivery', () => {
  const record = createAgentRecoveryRecord({
    taskId: 'task-1', runId: 'run-1', sessionId: 'topic-1', sourceUserMessageId: 'user-1',
    status: 'failed', resumeRoute: 'local_delivery', intent: 'image', originalRequest: '生成海报',
    failureStage: 'local_delivery', failureMessage: '素材交付失败',
    taskSnapshot: {
      sessionId: 'topic-1',
      taskId: 'task-1',
      contractVersion: 1,
      contract: { intent: 'image' },
      activeVersions: [{
        referenceId: 'history-image:1',
        batchId: 'batch-1',
        slotId: 'slot-1',
        versionId: 'version-1',
        assetUrl: '/generated/image-1.png',
      }],
    },
  });
  assert.equal(record.taskSnapshot.activeVersions[0].assetUrl, '/generated/image-1.png');
});

test('deterministic failures require a change', () => {
  assert.deepEqual(classifyAgentFailure({ reason: 'locked_skill_conflict' }), {
    kind: 'validation', retryability: 'requires_change',
  });
  assert.deepEqual(classifyAgentFailure({ message: 'model does not support image input' }), {
    kind: 'capability', retryability: 'requires_change',
  });
});

test('recovery normalization rejects incomplete records and strips upstream html', () => {
  assert.equal(normalizeAgentRecoveryRecord({ version: 1 }), null);
  assert.equal(
    sanitizeAgentFailureMessage('<html><body>Cloudflare <b>504</b> https://proxy.test</body></html>'),
    'Cloudflare 504',
  );
});
