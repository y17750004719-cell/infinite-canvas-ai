import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAgentFailure,
  createAgentRecoveryRecord,
  normalizeAgentRecoveryRecord,
  sanitizeAgentFailureMessage,
} from './recovery.mjs';

test('recovery records are bounded and keep stable task state', () => {
  const record = createAgentRecoveryRecord({
    taskId: 'task-1', runId: 'run-1', topicId: 'topic-1', sourceUserMessageId: 'user-1',
    status: 'failed', resumeRoute: 'image_planner', intent: 'image', originalRequest: '生成海报',
    failureStage: 'image_pipeline', failureMessage: '504 upstream timeout https://private.test/x',
    skillId: 'poster', contextEntityIds: ['a', 'a'], visualReferenceIds: ['v'],
    completedAssetCount: 2,
  });
  assert.equal(record.failure.kind, 'timeout');
  assert.equal(record.failure.retryability, 'retryable');
  assert.doesNotMatch(record.failure.message, /https?:/);
  assert.deepEqual(record.contextEntityIds, ['a']);
  assert.equal(record.completedAssetCount, 2);
});

test('terminal contract recovery retains the operation lock and resumable Main Agent transcript', () => {
  const record = createAgentRecoveryRecord({
    taskId: 'task-1', runId: 'run-2', topicId: 'topic-1', sourceUserMessageId: 'user-1',
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
    taskId: 'task-1', runId: 'run-1', topicId: 'topic-1', sourceUserMessageId: 'user-1',
    status: 'failed', resumeRoute: 'image_planner', intent: 'image', originalRequest: '继续修改图片',
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
    taskId: 'task-1', runId: 'run-1', topicId: 'topic-1', sourceUserMessageId: 'user-1',
    status: 'failed', resumeRoute: 'image_planner', intent: 'image', originalRequest: '继续修改图片',
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
    taskId: 'task-1', runId: 'run-1', topicId: 'topic-1', sourceUserMessageId: 'user-1',
    status: 'failed', resumeRoute: 'local_delivery', intent: 'image', originalRequest: '生成海报',
    failureStage: 'local_delivery', failureMessage: '素材交付失败',
    taskSnapshot: {
      topicId: 'topic-1',
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
