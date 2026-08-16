const DOMAINS = new Set(['chat', 'image', 'skill_action', 'other']);
const RESOLVERS = new Set(['analysis', 'context', 'user']);
const STATUSES = new Set(['analyzing', 'awaiting_input', 'ready', 'failed', 'abandoned']);
const MAX_CHECKPOINTS = 3;

const text = (value) => typeof value === 'string' ? value.trim() : '';
const object = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strings = (value, max = 32) => Array.isArray(value)
  ? value.slice(0, max).map(text).filter(Boolean)
  : [];

function requiredText(value, label) {
  const result = text(value);
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function normalizeUnderstanding(value) {
  if (!object(value)) throw new Error('currentUnderstanding is required');
  const domain = text(value.domain);
  if (!DOMAINS.has(domain)) throw new Error('currentUnderstanding.domain is invalid');
  return {
    goal: requiredText(value.goal, 'currentUnderstanding.goal'),
    expectedResult: requiredText(value.expectedResult, 'currentUnderstanding.expectedResult'),
    domain,
  };
}

export function normalizeAgentAnalysisCheckpoint(args) {
  const evidence = (Array.isArray(args?.evidence) ? args.evidence : []).slice(0, 24).map((entry, index) => ({
    sourceId: requiredText(entry?.sourceId, `evidence[${index}].sourceId`),
    conclusion: requiredText(entry?.conclusion, `evidence[${index}].conclusion`),
  }));
  const workingAssumptions = (Array.isArray(args?.workingAssumptions) ? args.workingAssumptions : []).slice(0, 24).map((entry, index) => {
    const confidence = text(entry?.confidence);
    if (!['high', 'medium', 'low'].includes(confidence)) throw new Error(`workingAssumptions[${index}].confidence is invalid`);
    return {
      id: requiredText(entry?.id, `workingAssumptions[${index}].id`),
      statement: requiredText(entry?.statement, `workingAssumptions[${index}].statement`),
      confidence,
    };
  });
  const unresolvedQuestions = (Array.isArray(args?.unresolvedQuestions) ? args.unresolvedQuestions : []).slice(0, 16).map((entry, index) => {
    const resolvableBy = text(entry?.resolvableBy);
    if (!RESOLVERS.has(resolvableBy)) throw new Error(`unresolvedQuestions[${index}].resolvableBy is invalid`);
    return {
      dimension: requiredText(entry?.dimension, `unresolvedQuestions[${index}].dimension`),
      reason: requiredText(entry?.reason, `unresolvedQuestions[${index}].reason`),
      resolvableBy,
    };
  });
  return {
    objective: requiredText(args?.objective, 'objective'),
    currentUnderstanding: normalizeUnderstanding(args?.currentUnderstanding),
    evidence,
    workingAssumptions,
    constraints: strings(args?.constraints, 32),
    unresolvedQuestions,
    nextFocus: requiredText(args?.nextFocus, 'nextFocus'),
  };
}

export function createAgentAnalysisSnapshot({
  taskId,
  runId,
  originalRequest,
  uiMode = 'agent',
  selectedSkillId = null,
  explicitReferenceIds = [],
  operation,
} = {}) {
  return {
    version: 1,
    taskId: requiredText(taskId, 'taskId'),
    runId: requiredText(runId, 'runId'),
    originalRequest: requiredText(originalRequest, 'originalRequest'),
    status: 'analyzing',
    checkpointCount: 0,
    currentObjective: null,
    lockedFacts: {
      uiMode: ['agent', 'image', 'chat'].includes(uiMode) ? uiMode : 'agent',
      selectedSkillId: text(selectedSkillId) || null,
      explicitReferenceIds: [...new Set(strings(explicitReferenceIds, 20))],
      userDecisions: [],
      ...(operation === 'generate' || operation === 'edit' ? { operation } : {}),
    },
    workingState: {
      currentUnderstanding: null,
      evidence: [],
      assumptions: [],
      constraints: [],
      unresolvedQuestions: [],
      nextFocus: null,
    },
    checkpoints: [],
    repairCount: 0,
  };
}

export function restoreAgentAnalysisSnapshot(value, defaults = {}) {
  if (!object(value) || value.version !== 1 || !STATUSES.has(value.status)) {
    return createAgentAnalysisSnapshot(defaults);
  }
  const snapshot = structuredClone(value);
  snapshot.taskId = text(snapshot.taskId) || requiredText(defaults.taskId, 'taskId');
  snapshot.runId = text(defaults.runId) || text(snapshot.runId) || requiredText(defaults.runId, 'runId');
  snapshot.originalRequest = text(snapshot.originalRequest) || requiredText(defaults.originalRequest, 'originalRequest');
  snapshot.checkpointCount = Math.min(MAX_CHECKPOINTS, Math.max(0, Math.floor(Number(snapshot.checkpointCount) || 0)));
  snapshot.currentObjective = text(snapshot.currentObjective) || null;
  snapshot.repairCount = Math.max(0, Math.floor(Number(snapshot.repairCount) || 0));
  snapshot.lockedFacts = {
    ...createAgentAnalysisSnapshot(defaults).lockedFacts,
    ...(object(snapshot.lockedFacts) ? snapshot.lockedFacts : {}),
    userDecisions: Array.isArray(snapshot.lockedFacts?.userDecisions) ? snapshot.lockedFacts.userDecisions : [],
  };
  snapshot.workingState = object(snapshot.workingState) ? snapshot.workingState : createAgentAnalysisSnapshot(defaults).workingState;
  snapshot.checkpoints = Array.isArray(snapshot.checkpoints) ? snapshot.checkpoints.slice(-MAX_CHECKPOINTS) : [];
  return snapshot;
}

export function applyAgentAnalysisCheckpoint(snapshot, args) {
  if (snapshot.checkpointCount >= MAX_CHECKPOINTS) throw new Error('active analysis checkpoint limit reached');
  const checkpoint = normalizeAgentAnalysisCheckpoint(args);
  snapshot.status = 'analyzing';
  snapshot.checkpointCount += 1;
  snapshot.currentObjective = checkpoint.objective;
  snapshot.workingState = {
    currentUnderstanding: checkpoint.currentUnderstanding,
    evidence: checkpoint.evidence,
    assumptions: checkpoint.workingAssumptions,
    constraints: checkpoint.constraints,
    unresolvedQuestions: checkpoint.unresolvedQuestions,
    nextFocus: checkpoint.nextFocus,
  };
  snapshot.checkpoints.push({ index: snapshot.checkpointCount, ...structuredClone(checkpoint) });
  return checkpoint;
}

export function recordAgentUserDecision(snapshot, dimension, answer) {
  const normalizedDimension = requiredText(dimension, 'dimension');
  const normalizedAnswer = requiredText(answer, 'answer');
  snapshot.status = 'analyzing';
  snapshot.lockedFacts.userDecisions = [
    ...snapshot.lockedFacts.userDecisions.filter((entry) => entry.dimension !== normalizedDimension),
    { dimension: normalizedDimension, answer: normalizedAnswer },
  ];
  return snapshot;
}

export const MAX_AGENT_ANALYSIS_CHECKPOINTS = MAX_CHECKPOINTS;
