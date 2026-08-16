const STAGES = ['routing', 'execution'];
const STATUSES = new Set(['pending', 'in_progress', 'completed', 'awaiting_input', 'failed', 'skipped']);
const MODES = new Set(['single', 'series', 'variants', 'composite']);

const text = (value) => typeof value === 'string' ? value.trim() : '';
const object = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strings = (value, max = 32) => Array.isArray(value) ? value.slice(0, max).map(text).filter(Boolean) : [];
const clone = (value) => structuredClone(value);
const required = (value, label) => {
  const result = text(value);
  if (!result) throw new Error(`${label} is required`);
  return result;
};
const unique = (values, label) => {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
  return values;
};

function stages(currentStage, saved) {
  return Object.fromEntries(STAGES.map((stage) => [stage, {
    status: STATUSES.has(saved?.[stage]?.status) ? saved[stage].status : stage === currentStage ? 'in_progress' : 'pending',
    repairCount: Math.max(0, Math.floor(Number(saved?.[stage]?.repairCount) || 0)),
    ...(Number.isFinite(Number(saved?.[stage]?.completedAt)) ? { completedAt: Number(saved[stage].completedAt) } : {}),
  }]));
}

function hasExecutionContract(snapshot) {
  return snapshot?.currentStage === 'execution'
    && snapshot?.stages?.execution?.status === 'completed'
    && object(snapshot.executionPlan);
}

export function createImagePlanningSnapshot({ taskId, runId, sourceUserMessageId, originalRequest, resolvedRequirement = null, referenceIds = [], outputCount = 1, aspectRatio, promptFormat = 'text', deliveryMode = null, panelCount = null, skill = null, imagegenContext = null, currentStage = 'routing' } = {}) {
  if (!STAGES.includes(currentStage)) throw new Error('currentStage is invalid');
  return {
    version: 4,
    taskId: required(taskId, 'taskId'),
    runId: required(runId, 'runId'),
    sourceUserMessageId: required(sourceUserMessageId, 'sourceUserMessageId'),
    originalRequest: required(originalRequest, 'originalRequest'),
    resolvedRequirement: text(resolvedRequirement) || null,
    revision: 1,
    currentStage,
    stages: stages(currentStage),
    decision: null,
    operation: null,
    targetReferenceId: null,
    referenceIds: unique(strings(referenceIds, 20), 'referenceIds'),
    contextEntityIds: [],
    outputCount: Math.max(1, Math.floor(Number(outputCount) || 1)),
    aspectRatio: required(aspectRatio, 'aspectRatio'),
    promptFormat: promptFormat === 'json-text' ? 'json-text' : 'text',
    deliveryMode: MODES.has(deliveryMode) ? deliveryMode : null,
    panelCount: deliveryMode === 'composite' ? Math.max(2, Math.floor(Number(panelCount) || 2)) : null,
    skill: object(skill) ? clone(skill) : null,
    imagegenContext: object(imagegenContext) ? clone(imagegenContext) : null,
    executionPlan: null,
    failure: null,
    abandonedAt: null,
  };
}

function migrateLegacy(value, defaults) {
  const completed = value?.stages?.local_finalization?.status === 'completed' && object(value.executionPlan);
  const snapshot = createImagePlanningSnapshot({
    ...defaults,
    ...value,
    currentStage: completed ? 'execution' : 'routing',
  });
  snapshot.revision = Math.max(1, Math.floor(Number(value?.revision) || 1));
  snapshot.decision = ['chat', 'generate', 'edit'].includes(value?.decision) ? value.decision : null;
  snapshot.operation = ['generate', 'edit'].includes(value?.operation) ? value.operation : null;
  snapshot.targetReferenceId = snapshot.operation === 'edit' ? text(value?.targetReferenceId) || null : null;
  snapshot.failure = completed ? null : object(value?.failure) ? clone(value.failure) : null;
  snapshot.abandonedAt = Number.isFinite(Number(value?.abandonedAt)) ? Number(value.abandonedAt) : null;
  if (completed) {
    snapshot.executionPlan = clone(value.executionPlan);
    snapshot.stages = stages('execution', {
      routing: { status: 'completed' },
      execution: { status: 'completed', completedAt: value?.stages?.local_finalization?.completedAt },
    });
  }
  return snapshot;
}

export function restoreImagePlanningSnapshot(value, defaults = {}) {
  if (!object(value)) return createImagePlanningSnapshot(defaults);
  if (value.version !== 4 || !STAGES.includes(value.currentStage)) return migrateLegacy(value, defaults);
  const snapshot = clone(value);
  snapshot.taskId = text(snapshot.taskId) || required(defaults.taskId, 'taskId');
  snapshot.runId = text(snapshot.runId) || required(defaults.runId, 'runId');
  snapshot.sourceUserMessageId = text(snapshot.sourceUserMessageId) || required(defaults.sourceUserMessageId, 'sourceUserMessageId');
  snapshot.originalRequest = text(snapshot.originalRequest) || required(defaults.originalRequest, 'originalRequest');
  snapshot.resolvedRequirement = text(snapshot.resolvedRequirement) || null;
  snapshot.referenceIds = unique(strings(snapshot.referenceIds, 20), 'referenceIds');
  snapshot.contextEntityIds = unique(strings(snapshot.contextEntityIds, 20), 'contextEntityIds');
  snapshot.outputCount = Math.max(1, Math.floor(Number(snapshot.outputCount) || Number(defaults.outputCount) || 1));
  snapshot.aspectRatio = text(snapshot.aspectRatio) || required(defaults.aspectRatio, 'aspectRatio');
  snapshot.promptFormat = snapshot.promptFormat === 'json-text' ? 'json-text' : 'text';
  snapshot.deliveryMode = MODES.has(snapshot.deliveryMode) ? snapshot.deliveryMode : null;
  snapshot.panelCount = snapshot.deliveryMode === 'composite' ? Math.max(2, Math.floor(Number(snapshot.panelCount) || 2)) : null;
  snapshot.decision = ['chat', 'generate', 'edit'].includes(snapshot.decision) ? snapshot.decision : null;
  snapshot.operation = ['generate', 'edit'].includes(snapshot.operation) ? snapshot.operation : null;
  snapshot.targetReferenceId = snapshot.operation === 'edit' ? text(snapshot.targetReferenceId) || null : null;
  snapshot.skill = object(snapshot.skill) ? clone(snapshot.skill) : null;
  snapshot.imagegenContext = object(snapshot.imagegenContext) ? clone(snapshot.imagegenContext) : null;
  snapshot.executionPlan = object(snapshot.executionPlan) ? clone(snapshot.executionPlan) : null;
  snapshot.revision = Math.max(1, Math.floor(Number(snapshot.revision) || 1));
  snapshot.failure = object(snapshot.failure) ? clone(snapshot.failure) : null;
  snapshot.abandonedAt = Number.isFinite(Number(snapshot.abandonedAt)) ? Number(snapshot.abandonedAt) : null;
  snapshot.stages = stages(snapshot.currentStage, snapshot.stages);
  if (!hasExecutionContract(snapshot) && snapshot.currentStage === 'execution') {
    snapshot.executionPlan = null;
    snapshot.failure = null;
    snapshot.revision += 1;
    snapshot.currentStage = 'routing';
    snapshot.stages = stages('routing');
  }
  return snapshot;
}

export function setImagePlanningStage(snapshot, stage, status = 'in_progress') {
  if (!STAGES.includes(stage)) throw new Error('stage is invalid');
  snapshot.currentStage = stage;
  snapshot.stages[stage] = { ...snapshot.stages[stage], status, ...(status === 'completed' || status === 'skipped' ? { completedAt: Date.now() } : {}) };
  if (status !== 'failed') snapshot.failure = null;
  return snapshot;
}

export function completeImagePlanningStage(snapshot, stage, nextStage) {
  setImagePlanningStage(snapshot, stage, 'completed');
  if (nextStage) setImagePlanningStage(snapshot, nextStage);
  return snapshot;
}

export function failImagePlanningStage(snapshot, stage, message, kind = 'validation') {
  setImagePlanningStage(snapshot, stage, 'failed');
  snapshot.failure = { stage, kind, message: required(message, 'failure message'), failedAt: Date.now() };
  return snapshot;
}

export function rewindImagePlanning(snapshot, stage, runId) {
  if (!STAGES.includes(stage)) throw new Error('stage is invalid');
  snapshot.runId = required(runId, 'runId');
  snapshot.revision = Math.max(1, Number(snapshot.revision) || 1) + 1;
  snapshot.currentStage = stage;
  snapshot.failure = null;
  snapshot.abandonedAt = null;
  for (const downstream of STAGES.slice(STAGES.indexOf(stage))) snapshot.stages[downstream] = { status: downstream === stage ? 'in_progress' : 'pending', repairCount: 0 };
  if (stage === 'routing') {
    snapshot.decision = null;
    snapshot.operation = null;
    snapshot.targetReferenceId = null;
  }
  if (stage !== 'execution') snapshot.executionPlan = null;
  return snapshot;
}

export function abandonImagePlanning(snapshot) {
  snapshot.abandonedAt = Date.now();
  return snapshot;
}

export const IMAGE_PLANNING_STAGES = STAGES;
