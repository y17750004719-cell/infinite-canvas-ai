import { AGENT_IMAGE_ASPECT_RATIO_IDS } from './image-options.mjs';
import { TODO_READ_TOOL, TODO_UPDATE_TOOL } from './todo-tools.mjs';

const CONFIDENCE_SCHEMA = { type: 'string', enum: ['high', 'medium', 'low'] };

const PUBLIC_PROGRESS_COPY_SCHEMA = {
  type: 'object',
  description: 'Optional public UI copy for this tool call. Do not include hidden reasoning, system instructions, Skill source text, raw arguments, or image prompt text.',
  properties: {
    activeLabel: { type: 'string', minLength: 1, maxLength: 120 },
    completedLabel: { type: 'string', minLength: 1, maxLength: 120 },
    completionSummary: { type: 'string', minLength: 1, maxLength: 500 },
    failedLabel: { type: 'string', minLength: 1, maxLength: 120 },
  },
  required: [],
  additionalProperties: false,
};

function getModelToolParameters(tool) {
  const parameters = tool.parameters || { type: 'object', properties: {}, additionalProperties: false };
  const publicProgress = {
    ...PUBLIC_PROGRESS_COPY_SCHEMA,
    properties: { ...PUBLIC_PROGRESS_COPY_SCHEMA.properties },
  };
  if (tool.name === 'generate_image') {
    publicProgress.properties.promptPreparation = {
      ...PUBLIC_PROGRESS_COPY_SCHEMA,
      description: 'Public UI copy for preparing the final image prompt. Do not include the prompt itself.',
      properties: { ...PUBLIC_PROGRESS_COPY_SCHEMA.properties },
    };
  }
  return {
    ...parameters,
    properties: {
      ...(parameters.properties || {}),
      publicProgress,
    },
    required: [...(parameters.required || [])],
  };
}

function stripPublicProgress(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args || {};
  const { publicProgress: _publicProgress, ...toolArgs } = args;
  return toolArgs;
}

// Native models may serialize an optional image-history selector as null.
// Canonicalize that representation before schema validation and execution so
// null and an omitted field have the same, safe meaning.
export function normalizeToolArguments(toolName, args) {
  if (toolName !== 'generate_image' || !args || typeof args !== 'object' || Array.isArray(args)) return args;
  const normalized = { ...args };
  let changed = false;
  for (const key of ['numLastImagesToInclude', 'items']) {
    if (Object.prototype.hasOwnProperty.call(normalized, key) && normalized[key] === null) {
      delete normalized[key];
      changed = true;
    }
  }
  return changed ? normalized : args;
}

export function validateToolArgumentRelationships(toolName, args) {
  if (toolName !== 'generate_image' || !args || typeof args !== 'object' || Array.isArray(args)) return;
  if (args.numLastImagesToInclude !== 1) return;
  if (args.operation !== 'edit') throw new Error('Invalid arguments for generate_image: numLastImagesToInclude 仅可用于图片编辑');
  if ((Array.isArray(args.referenceIds) && args.referenceIds.length > 0) || (typeof args.targetReferenceId === 'string' && args.targetReferenceId.trim())) {
    throw new Error('Invalid arguments for generate_image: numLastImagesToInclude 不能与显式图片引用同时使用');
  }
}

function schemaTypeMatches(value, type) {
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return true;
}

export function validateAgentToolArguments(schema, value, toolName = 'tool', path = 'arguments') {
  if (!schema || typeof schema !== 'object') return value;
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) {
    throw new Error(`Invalid arguments for ${toolName}: ${path} must match an allowed value`);
  }
  const allowedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (allowedTypes.length > 0 && !allowedTypes.some((type) => schemaTypeMatches(value, type))) {
    throw new Error(`Invalid arguments for ${toolName}: ${path} must be ${allowedTypes.join(' or ')}`);
  }
  if (typeof value === 'string' && Number.isInteger(schema.minLength) && value.length < schema.minLength) {
    throw new Error(`Invalid arguments for ${toolName}: ${path} is too short`);
  }
  if (typeof value === 'string' && Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
    throw new Error(`Invalid arguments for ${toolName}: ${path} is too long`);
  }
  if (typeof value === 'number' && Number.isFinite(schema.minimum) && value < schema.minimum) {
    throw new Error(`Invalid arguments for ${toolName}: ${path} is too small`);
  }
  if (typeof value === 'number' && Number.isFinite(schema.maximum) && value > schema.maximum) {
    throw new Error(`Invalid arguments for ${toolName}: ${path} is too large`);
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      throw new Error(`Invalid arguments for ${toolName}: ${path} has too few items`);
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      throw new Error(`Invalid arguments for ${toolName}: ${path} has too many items`);
    }
  }
  if (allowedTypes.includes('object') && value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) {
        throw new Error(`Invalid arguments for ${toolName}: ${path}.${required} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      const unexpected = Object.keys(value).find((key) => !Object.prototype.hasOwnProperty.call(properties, key));
      if (unexpected) throw new Error(`Invalid arguments for ${toolName}: ${path}.${unexpected} is not allowed`);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validateAgentToolArguments(childSchema, value[key], toolName, `${path}.${key}`);
      }
    }
  }
  if (allowedTypes.includes('array') && Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => validateAgentToolArguments(schema.items, entry, toolName, `${path}[${index}]`));
  }
  return value;
}

export function createAgentToolRegistry({
  generateImage,
  getConversationMemory,
  listProjectContext,
  readContextEntity,
  loadVisualReference,
  updateConversationMemory,
  handleFailedTask,
  readRelevantContext,
  submitAgentAnalysisCheckpoint,
  requestUserDecision,
  rewindAgentAnalysis,
  resolveFailedTaskRecovery,
  requestMainAgentContext,
  requestContextSelection,
  todoRead,
  todoUpdate,
} = {}) {
  const registry = new Map([
    ['generate_image', {
      name: 'generate_image',
      commentaryPolicy: 'server_fallback',
      requiresConfirmation: false,
      readOnly: false,
      terminal: true,
      countAgainstToolBudget: false,
      description: 'Generate or edit images. prompt is the complete final supplier Prompt produced by this Main Agent turn after applying the loaded ImageGen and locked visual Skill renderPrompt rules; do not submit a style-label summary or hand it to another model. For edits, targetReferenceId must identify the one image to edit and also appear in referenceIds. To continue editing the most recent image in this canvas session, set numLastImagesToInclude to 1; this is only valid for edit operations, is mutually exclusive with non-empty referenceIds and targetReferenceId, and is resolved by the runtime.',
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['generate', 'edit'] },
          prompt: { type: 'string', minLength: 1 },
          referenceIds: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          targetReferenceId: { type: ['string', 'null'], minLength: 1, maxLength: 200 },
          numLastImagesToInclude: {
            type: ['integer', 'null'],
            enum: [1, null],
            description: 'For edit operations only, explicitly continue from the most recent image in the current canvas session. Mutually exclusive with non-empty referenceIds and targetReferenceId; the runtime resolves the image.',
          },
          outputCount: { type: 'integer', minimum: 1, maximum: 100 },
          aspectRatio: { type: 'string', enum: AGENT_IMAGE_ASPECT_RATIO_IDS },
          deliveryMode: { type: 'string', enum: ['single', 'variants', 'series', 'composite'] },
          panelCount: { type: ['integer', 'null'], minimum: 2, maximum: 100 },
          items: {
            type: ['array', 'null'],
            maxItems: 100,
            items: {
              type: 'object',
              properties: {
                prompt: { type: 'string', minLength: 1 },
                // Models may include a stable display index for series items;
                // execution still derives ordering from the array position.
                index: { type: 'integer', minimum: 1, maximum: 100 },
                label: { type: 'string', minLength: 1, maxLength: 120 },
                subject: { type: 'string', minLength: 1, maxLength: 240 },
              },
              required: ['prompt'],
              additionalProperties: false,
            },
          },
        },
        required: ['operation', 'prompt', 'referenceIds', 'targetReferenceId', 'outputCount', 'aspectRatio', 'deliveryMode', 'panelCount'],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        if (typeof generateImage !== 'function') throw new Error('generate_image is unavailable');
        return generateImage(args, context);
      },
    }],
    ['get_canvas_context', {
      name: 'get_canvas_context',
      requiresConfirmation: false,
      readOnly: true,
      description: 'Read the bounded summary of the current canvas.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async (_args, context) => context.canvasContext || {},
    }],
    ['todo_read', {
      ...TODO_READ_TOOL,
      execute: async (args, context) => {
        if (typeof todoRead !== 'function') throw new Error('todo_read is unavailable');
        return todoRead(args, context);
      },
    }],
    ['todo_update', {
      ...TODO_UPDATE_TOOL,
      execute: async (args, context) => {
        if (typeof todoUpdate !== 'function') throw new Error('todo_update is unavailable');
        return todoUpdate(args, context);
      },
    }],
    ['get_conversation_memory', {
      name: 'get_conversation_memory',
      requiresConfirmation: false,
      readOnly: true,
      description: 'Read the bounded memory snapshot and recent dialogue for the current topic.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        if (typeof getConversationMemory !== 'function') throw new Error('get_conversation_memory is unavailable');
        return getConversationMemory();
      },
    }],
    ['list_project_context', {
      name: 'list_project_context',
      requiresConfirmation: false,
      readOnly: true,
      description: 'List the bounded current-topic image, canvas, and context-entity manifest using stable IDs.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        if (typeof listProjectContext !== 'function') throw new Error('list_project_context is unavailable');
        return listProjectContext();
      },
    }],
    ['read_context_entity', {
      name: 'read_context_entity',
      requiresConfirmation: false,
      readOnly: true,
      description: 'Read metadata for one stable context entity ID or up to eight stable IDs. Prefer one batch over repeated calls.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          ids: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: { type: 'string', minLength: 1 },
          },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        if (typeof readContextEntity !== 'function') throw new Error('read_context_entity is unavailable');
        const hasId = typeof args.id === 'string';
        const hasIds = Array.isArray(args.ids);
        if (hasId === hasIds) throw new Error('read_context_entity requires exactly one of id or ids');
        const ids = Array.from(new Set(
          (hasId ? [args.id] : args.ids).map((id) => id.trim()),
        ));
        if (ids.some((id) => !id)) throw new Error('read_context_entity requires non-empty stable IDs');
        if (ids.length === 0 || ids.length > 8) throw new Error('read_context_entity requires 1 to 8 stable IDs');
        if (hasId) return readContextEntity(ids[0]);
        const results = await Promise.all(ids.map((id) => readContextEntity(id)));
        return {
          modelResult: { entities: results.map((result) => result?.modelResult ?? result) },
          publicResult: { entities: results.map((result) => result?.publicResult ?? result) },
        };
      },
    }],
    ['load_visual_reference', {
      name: 'load_visual_reference',
      requiresConfirmation: false,
      readOnly: true,
      description: 'Load up to four validated visual context entities for the next reasoning turn.',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: { type: 'string', minLength: 1 },
          },
        },
        required: ['ids'],
        additionalProperties: false,
      },
      execute: async (args) => {
        if (typeof loadVisualReference !== 'function') throw new Error('load_visual_reference is unavailable');
        return loadVisualReference(args.ids.map((id) => id.trim()));
      },
    }],
    ['update_conversation_memory', {
      name: 'update_conversation_memory',
      requiresConfirmation: false,
      readOnly: true,
      countAgainstToolBudget: false,
      description: 'Stage a bounded semantic memory patch. This does not end the current turn or perform an external action.',
      parameters: {
        type: 'object',
        properties: {
          memoryPatch: {
            type: 'object',
            properties: {
              rollingSummary: { type: 'string' },
              facts: { type: 'array', maxItems: 24, items: { type: 'string', minLength: 1 } },
              preferences: { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1 } },
              activeTask: {
                type: ['object', 'null'],
                properties: {
                  status: { type: 'string', enum: ['idle', 'planning', 'awaiting_confirmation', 'executing', 'completed', 'failed'] },
                  summary: { type: 'string', minLength: 1 },
                  taskId: { type: 'string', minLength: 1 },
                },
                required: ['status', 'summary'],
                additionalProperties: false,
              },
              recentReferencedAssetIds: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1 } },
            },
            additionalProperties: false,
          },
        },
        required: ['memoryPatch'],
        additionalProperties: false,
      },
      execute: async (args) => {
        if (typeof updateConversationMemory !== 'function') throw new Error('update_conversation_memory is unavailable');
        return updateConversationMemory(args.memoryPatch);
      },
    }],
    ['handle_failed_task', {
      name: 'handle_failed_task',
      requiresConfirmation: false,
      readOnly: true,
      countAgainstToolBudget: false,
      description: 'Inspect or resume the supplied failed task, or explicitly continue with the current request instead.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['inspect', 'resume', 'continue_current_request'] },
          revision: { type: 'string', minLength: 1, maxLength: 4000 },
        },
        required: ['action'],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        if (typeof handleFailedTask !== 'function') throw new Error('handle_failed_task is unavailable');
        return handleFailedTask(args, context);
      },
    }],
    ['read_relevant_context', {
      name: 'read_relevant_context',
      requiresConfirmation: false,
      readOnly: true,
      countAgainstToolBudget: false,
      description: 'Read one bounded conversation, project, or canvas context summary only when the current request needs it.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['conversation', 'project', 'canvas'] },
          query: { type: 'string', minLength: 1, maxLength: 1000 },
          ids: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
        required: ['scope'],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        if (typeof readRelevantContext !== 'function') throw new Error('read_relevant_context is unavailable');
        return readRelevantContext(args, context);
      },
    }],
    ['submit_agent_analysis_checkpoint', {
      name: 'submit_agent_analysis_checkpoint',
      requiresConfirmation: false,
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
      description: 'Save bounded conclusions when the current request needs another analysis pass. This is not chain-of-thought.',
      parameters: {
        type: 'object',
        properties: {
          objective: { type: 'string', minLength: 1, maxLength: 1000 },
          currentUnderstanding: {
            type: 'object',
            properties: {
              goal: { type: 'string', minLength: 1, maxLength: 2000 },
              expectedResult: { type: 'string', minLength: 1, maxLength: 2000 },
              domain: { type: 'string', enum: ['chat', 'image', 'skill_action', 'other'] },
            },
            required: ['goal', 'expectedResult', 'domain'],
            additionalProperties: false,
          },
          evidence: {
            type: 'array', maxItems: 24,
            items: {
              type: 'object',
              properties: {
                sourceId: { type: 'string', minLength: 1, maxLength: 200 },
                conclusion: { type: 'string', minLength: 1, maxLength: 2000 },
              },
              required: ['sourceId', 'conclusion'],
              additionalProperties: false,
            },
          },
          workingAssumptions: {
            type: 'array', maxItems: 24,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', minLength: 1, maxLength: 200 },
                statement: { type: 'string', minLength: 1, maxLength: 2000 },
                confidence: CONFIDENCE_SCHEMA,
              },
              required: ['id', 'statement', 'confidence'],
              additionalProperties: false,
            },
          },
          constraints: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 1000 } },
          unresolvedQuestions: {
            type: 'array', maxItems: 16,
            items: {
              type: 'object',
              properties: {
                dimension: { type: 'string', minLength: 1, maxLength: 200 },
                reason: { type: 'string', minLength: 1, maxLength: 1000 },
                resolvableBy: { type: 'string', enum: ['analysis', 'context', 'user'] },
              },
              required: ['dimension', 'reason', 'resolvableBy'],
              additionalProperties: false,
            },
          },
          nextFocus: { type: 'string', minLength: 1, maxLength: 1000 },
        },
        required: ['objective', 'currentUnderstanding', 'evidence', 'workingAssumptions', 'constraints', 'unresolvedQuestions', 'nextFocus'],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        if (typeof submitAgentAnalysisCheckpoint !== 'function') throw new Error('submit_agent_analysis_checkpoint is unavailable');
        return submitAgentAnalysisCheckpoint(args, context);
      },
    }],
    ['request_user_decision', {
      name: 'request_user_decision',
      requiresConfirmation: false,
      mayRequireConfirmation: true,
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
      description: 'Pause for a blocking choice that only the user can decide.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['entry', 'analysis', 'operation', 'context', 'brief', 'prompt', 'general'] },
          dimension: { type: 'string', minLength: 1, maxLength: 200 },
          question: { type: 'string', minLength: 1, maxLength: 2000 },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
          recommendedOptionId: { type: 'string', minLength: 1, maxLength: 200 },
          options: {
            type: 'array', minItems: 2, maxItems: 4,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', minLength: 1, maxLength: 200 },
                label: { type: 'string', minLength: 1, maxLength: 200 },
                answer: { type: 'string', minLength: 1, maxLength: 2000 },
                description: { type: 'string', minLength: 1, maxLength: 1000 },
              },
              required: ['id', 'label', 'answer', 'description'],
              additionalProperties: false,
            },
          },
        },
        required: ['scope', 'dimension', 'question', 'reason', 'recommendedOptionId', 'options'],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        if (typeof requestUserDecision !== 'function') throw new Error('request_user_decision is unavailable');
        return requestUserDecision(args, context);
      },
    }],
    ['rewind_agent_analysis', {
      name: 'rewind_agent_analysis',
      requiresConfirmation: false,
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
      description: 'Rewind a resumed task from the affected structured stage while preserving locked user facts.',
      parameters: {
        type: 'object',
        properties: {
          stage: { type: 'string', enum: ['analysis', 'routing', 'compilation'] },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
          preservedFacts: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 1000 } },
          changedRequirements: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 1000 } },
        },
        required: ['stage', 'reason', 'preservedFacts', 'changedRequirements'],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        if (typeof rewindAgentAnalysis !== 'function') throw new Error('rewind_agent_analysis is unavailable');
        return rewindAgentAnalysis(args, context);
      },
    }],
    ['resolve_failed_task_recovery', {
      name: 'resolve_failed_task_recovery',
      requiresConfirmation: false,
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
      description: 'Resolve whether the current user message resumes the one supplied failed task.',
      parameters: {
        type: 'object',
        properties: {
          decision: { type: 'string', enum: ['resume', 'continue_current_request', 'cannot_resume'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['decision', 'confidence'],
        additionalProperties: false,
      },
      execute: async (args) => {
        if (typeof resolveFailedTaskRecovery !== 'function') throw new Error('resolve_failed_task_recovery is unavailable');
        return resolveFailedTaskRecovery(args);
      },
    }],
    ['request_main_agent_context', {
      name: 'request_main_agent_context',
      requiresConfirmation: false,
      readOnly: true,
      countAgainstToolBudget: false,
      description: 'Unlock bounded conversation or project context tools for this Main Agent loop. This may be called only once per loop.',
      parameters: {
        type: 'object',
        properties: {
          scopes: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            items: { type: 'string', enum: ['conversation', 'project'] },
          },
        },
        required: ['scopes'],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        if (typeof requestMainAgentContext !== 'function') throw new Error('request_main_agent_context is unavailable');
        return requestMainAgentContext(args, context);
      },
    }],
    ['request_context_selection', {
      name: 'request_context_selection',
      requiresConfirmation: false,
      mayRequireConfirmation: true,
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
      description: 'Request that the user select one stable context entity from explicit candidate IDs.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', minLength: 1 },
          candidates: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', minLength: 1 },
                label: { type: 'string', minLength: 1 },
                kind: { type: 'string', minLength: 1 },
              },
              required: ['id', 'label', 'kind'],
              additionalProperties: false,
            },
          },
        },
        required: ['question', 'candidates'],
        additionalProperties: false,
      },
      execute: async (args) => {
        if (typeof requestContextSelection !== 'function') throw new Error('request_context_selection is unavailable');
        return requestContextSelection(args);
      },
    }],
  ]);
  return registry;
}

export function getAgentModelTools(registry, allowedTools = []) {
  const allowed = new Set(Array.isArray(allowedTools) ? allowedTools : []);
  return [...(registry?.values?.() || [])]
    .filter((tool) => allowed.has(tool.name))
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: getModelToolParameters(tool),
        ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
      },
      readOnly: tool.readOnly === true,
      terminal: tool.terminal === true,
      countAgainstToolBudget: tool.countAgainstToolBudget !== false,
      mayRequireConfirmation: tool.mayRequireConfirmation === true,
      requiresConfirmation: tool.requiresConfirmation === true,
      ...(tool.commentaryPolicy ? { commentaryPolicy: tool.commentaryPolicy } : {}),
    }));
}

export async function executeAgentTool(registry, toolName, args, context = {}) {
  const tool = registry?.get(toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  if (!Array.isArray(context.allowedTools) || !context.allowedTools.includes(toolName)) {
    throw new Error(`Tool is not allowed: ${toolName}`);
  }
  const publicProgress = args?.publicProgress;
  const toolArgs = normalizeToolArguments(toolName, stripPublicProgress(args));
  try {
    validateAgentToolArguments(tool.parameters, toolArgs, toolName);
    validateToolArgumentRelationships(toolName, toolArgs);
  } catch (error) {
    // Keep the direct executor's established throw contract, but classify it
    // with the same bounded metadata used by Native and dispatcher callers.
    const message = error instanceof Error ? error.message : String(error);
    const fieldPath = message.match(/arguments(\.[\w]+|\[[^\]]+\])+/)?.[0] || undefined;
    if (error && typeof error === 'object') {
      error.code = 'tool_arguments_invalid';
      error.failureStage = 'tool_dispatch';
      error.toolName = toolName;
      if (context.toolCallId) error.toolCallId = context.toolCallId;
      if (fieldPath) error.fieldPath = fieldPath;
      error.providerRequestStarted = false;
      error.retryable = false;
    }
    throw error;
  }
  if (tool.requiresConfirmation && context.confirmed !== true) {
    return {
      confirmationRequired: true,
      toolName,
      message: `确认后执行 ${toolName}`,
    };
  }
  return tool.execute(toolArgs, { ...context, publicProgress });
}
