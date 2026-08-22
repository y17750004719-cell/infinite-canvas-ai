import { AGENT_IMAGE_ASPECT_RATIO_IDS } from './image-options.mjs';

const SKILL_JOB_TYPES = new Set(['logo', 'brand']);

const CONFIDENCE_SCHEMA = { type: 'string', enum: ['high', 'medium', 'low'] };
const VISUAL_REFERENCE_ROLE_SCHEMA = {
  type: 'string',
  enum: ['edit_target', 'style_reference', 'content_reference', 'layout_reference', 'unresolved'],
};
const VISUAL_SUMMARY_SCHEMA = {
  type: ['object', 'null'],
  properties: {
    version: { type: 'integer', enum: [1] },
    references: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          referenceId: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1, maxLength: 2000 },
          salientSubjects: { type: 'array', maxItems: 24, items: { type: 'string', maxLength: 500 } },
          visibleText: { type: 'array', maxItems: 24, items: { type: 'string', maxLength: 500 } },
        },
        required: ['referenceId', 'description', 'salientSubjects', 'visibleText'],
        additionalProperties: false,
      },
    },
  },
  required: ['version', 'references'],
  additionalProperties: false,
};
const CLARIFICATION_SCHEMA = {
  type: ['object', 'null'],
  properties: {
    dimension: { type: 'string', minLength: 1 },
    question: { type: 'string', minLength: 1 },
    reason: { type: 'string' },
    options: {
      type: 'array', minItems: 2, maxItems: 4,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          label: { type: 'string', minLength: 1 },
          answer: { type: 'string', minLength: 1 },
          description: { type: 'string' },
        },
        required: ['id', 'label', 'answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['dimension', 'question', 'options'],
  additionalProperties: false,
};

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
  createSkillJob,
  getSkillJob,
  generateImage,
  readImagegenContext,
  getConversationMemory,
  listProjectContext,
  readContextEntity,
  loadVisualReference,
  updateConversationMemory,
  handleFailedTask,
  readRelevantContext,
  submitAgentAnalysisCheckpoint,
  requestUserDecision,
  startImagePlanning,
  rewindAgentAnalysis,
  resolveFailedTaskRecovery,
  requestMainAgentContext,
  requestImageClarification,
  submitImageExecutionPlan,
  handoffToImagePlanner,
  requestContextSelection,
} = {}) {
  const registry = new Map([
    ['read_imagegen_context', {
      name: 'read_imagegen_context',
      requiresConfirmation: false,
      readOnly: true,
      countAgainstToolBudget: false,
      description: 'Read the internal ImageGen method and the visual Skill locked for this image task before writing the final prompt.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async (_args, context) => {
        if (typeof readImagegenContext !== 'function') throw new Error('read_imagegen_context is unavailable');
        return readImagegenContext(context);
      },
    }],
    ['generate_image', {
      name: 'generate_image',
      requiresConfirmation: false,
      readOnly: false,
      terminal: true,
      countAgainstToolBudget: false,
      description: 'Generate or edit images using the final prompt. For edits, targetReferenceId must identify the one image to edit and also appear in referenceIds.',
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
          outputCount: { type: 'integer', minimum: 1, maximum: 100 },
          aspectRatio: { type: 'string', enum: AGENT_IMAGE_ASPECT_RATIO_IDS },
          deliveryMode: { type: 'string', enum: ['single', 'variants', 'series', 'composite'] },
          panelCount: { type: ['integer', 'null'], minimum: 2, maximum: 100 },
          items: {
            type: 'array',
            maxItems: 100,
            items: {
              type: 'object',
              properties: {
                prompt: { type: 'string', minLength: 1 },
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
    ['start_image_planning', {
      name: 'start_image_planning',
      requiresConfirmation: false,
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
      description: 'Start staged image planning after deciding that the user explicitly wants image generation or editing.',
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['generate', 'edit'] },
          requestedParameters: {
            type: 'object',
            properties: {
              outputCount: { type: 'integer', minimum: 1, maximum: 100 },
              aspectRatio: { type: 'string', enum: AGENT_IMAGE_ASPECT_RATIO_IDS },
              deliveryMode: { type: 'string', enum: ['single', 'variants', 'series', 'composite'] },
              panelCount: { type: 'integer', minimum: 2, maximum: 100 },
            },
            additionalProperties: false,
          },
          readiness: {
            type: 'object',
            properties: {
              goal: { type: 'string', minLength: 1, maxLength: 2000 },
              targetIds: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200 } },
              constraints: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 1000 } },
              resolvedAmbiguities: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 1000 } },
              blockingUnknowns: { type: 'array', maxItems: 0, items: { type: 'string' } },
            },
            required: ['goal', 'targetIds', 'constraints', 'resolvedAmbiguities', 'blockingUnknowns'],
            additionalProperties: false,
          },
        },
        required: ['operation', 'requestedParameters', 'readiness'],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        if (typeof startImagePlanning !== 'function') throw new Error('start_image_planning is unavailable');
        return startImagePlanning(args, context);
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
    ['request_image_clarification', {
      name: 'request_image_clarification',
      requiresConfirmation: false,
      mayRequireConfirmation: true,
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
      description: 'Pause the current image planning stage with one structured user question.',
      parameters: {
        type: 'object',
        properties: {
          stage: { type: 'string', enum: ['routing', 'compilation'] },
          dimension: { type: 'string', minLength: 1 },
          question: { type: 'string', minLength: 1 },
          reason: { type: 'string', minLength: 1 },
          options: CLARIFICATION_SCHEMA.properties.options,
        },
        required: ['stage', 'dimension', 'question', 'reason', 'options'],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        if (typeof requestImageClarification !== 'function') throw new Error('request_image_clarification is unavailable');
        return requestImageClarification(args, context);
      },
    }],
    ['submit_image_execution_plan', {
      name: 'submit_image_execution_plan',
      requiresConfirmation: false,
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
      description: 'Submit the complete image execution draft. This ends semantic planning but does not execute an external image action.',
      parameters: {
        type: 'object',
        properties: {
          decision: { type: 'string', enum: ['execute', 'clarify'] },
          confidence: CONFIDENCE_SCHEMA,
          clarification: CLARIFICATION_SCHEMA,
          contextEntityIds: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1 } },
          visualReferenceIds: { type: 'array', maxItems: 4, items: { type: 'string', minLength: 1 } },
          visualSummary: VISUAL_SUMMARY_SCHEMA,
          referenceRoles: {
            type: 'array', maxItems: 4,
            items: {
              type: 'object',
              properties: {
                referenceId: { type: 'string', minLength: 1 },
                role: VISUAL_REFERENCE_ROLE_SCHEMA,
              },
              required: ['referenceId', 'role'],
              additionalProperties: false,
            },
          },
          targetSelectionReason: { type: ['string', 'null'] },
          targetSelectionConfidence: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] },
          imageTask: {
            type: ['object', 'null'],
            properties: {
              operation: { type: 'string', enum: ['generate', 'edit'] },
              targetReferenceId: { type: ['string', 'null'] },
              sourceReferenceId: { type: ['string', 'null'] },
              supportingReferenceIds: { type: 'array', maxItems: 4, items: { type: 'string', minLength: 1 } },
              targetRegionIds: { type: 'array', items: { type: 'string', minLength: 1 } },
              instruction: { type: 'string', minLength: 1 },
              mustChange: { type: 'array', items: { type: 'string', minLength: 1 } },
              mustPreserve: { type: 'array', items: { type: 'string', minLength: 1 } },
            },
            required: ['operation', 'targetReferenceId', 'supportingReferenceIds', 'instruction', 'mustChange', 'mustPreserve'],
            additionalProperties: false,
          },
          brief: {
            type: 'object',
            properties: {
              deliverable: { type: 'string', minLength: 1 },
              subject: { type: 'string', minLength: 1 },
              style: { type: 'array', items: { type: 'string', minLength: 1 } },
              literalCopy: { type: 'array', items: { type: 'string' } },
              constraints: { type: 'array', items: { type: 'string', minLength: 1 } },
            },
            required: ['deliverable', 'subject', 'style', 'literalCopy', 'constraints'],
            additionalProperties: false,
          },
          delivery: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['single', 'series', 'variants', 'composite'] },
              outputCount: { type: 'integer', minimum: 1, maximum: 100 },
              panelCount: { type: ['integer', 'null'], minimum: 2 },
              variationAxes: { type: 'array', items: { type: 'string', minLength: 1 } },
              sharedInvariants: { type: 'array', items: { type: 'string', minLength: 1 } },
              distinctPerItem: { type: 'array', items: { type: 'string', minLength: 1 } },
              items: {
                type: 'array', maxItems: 100,
                items: {
                  type: 'object',
                  properties: {
                    index: { type: 'integer', minimum: 1 },
                    label: { type: 'string', minLength: 1 },
                    subject: { type: 'string', minLength: 1 },
                    variation: { type: 'string' },
                  },
                  required: ['index', 'label', 'subject', 'variation'],
                  additionalProperties: false,
                },
              },
            },
            required: ['mode', 'outputCount', 'panelCount', 'variationAxes', 'sharedInvariants', 'distinctPerItem', 'items'],
            additionalProperties: false,
          },
          generation: {
            type: ['object', 'null'],
            properties: {
              aspectRatio: { type: 'string', enum: AGENT_IMAGE_ASPECT_RATIO_IDS },
              promptFormat: { type: 'string', enum: ['text', 'json-text'] },
              prompt: { type: 'string', minLength: 1 },
              items: {
                type: 'array', maxItems: 100,
                items: {
                  type: 'object',
                  properties: {
                    index: { type: 'integer', minimum: 1 },
                    label: { type: 'string', minLength: 1 },
                    prompt: { type: 'string', minLength: 1 },
                  },
                  required: ['index', 'label', 'prompt'],
                  additionalProperties: false,
                },
              },
            },
            required: ['aspectRatio', 'promptFormat', 'prompt', 'items'],
            additionalProperties: false,
          },
        },
        required: [
          'decision', 'confidence', 'clarification', 'contextEntityIds', 'visualReferenceIds',
          'visualSummary', 'referenceRoles', 'targetSelectionReason', 'targetSelectionConfidence',
          'imageTask', 'brief', 'delivery', 'generation',
        ],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        if (typeof submitImageExecutionPlan !== 'function') throw new Error('submit_image_execution_plan is unavailable');
        return submitImageExecutionPlan(args, context);
      },
    }],
    ['handoff_to_image_planner', {
      name: 'handoff_to_image_planner',
      requiresConfirmation: false,
      readOnly: true,
      terminal: true,
      countAgainstToolBudget: false,
      description: 'Hand off an image action using stable references and bounded visual evidence. Do not include a rewritten brief or final image prompt.',
      parameters: {
        type: 'object',
        properties: {
          skillId: { type: ['string', 'null'] },
          contextEntityIds: { type: 'array', items: { type: 'string', minLength: 1 } },
          visualReferenceIds: { type: 'array', maxItems: 4, items: { type: 'string', minLength: 1 } },
          visualSummary: {
            type: ['object', 'null'],
            properties: {
              version: { type: 'integer', enum: [1] },
              references: {
                type: 'array',
                maxItems: 4,
                items: {
                  type: 'object',
                  properties: {
                    referenceId: { type: 'string', minLength: 1 },
                    description: { type: 'string', minLength: 1, maxLength: 2000 },
                    salientSubjects: { type: 'array', maxItems: 24, items: { type: 'string', maxLength: 500 } },
                    visibleText: { type: 'array', maxItems: 24, items: { type: 'string', maxLength: 500 } },
                  },
                  required: ['referenceId', 'description', 'salientSubjects', 'visibleText'],
                  additionalProperties: false,
                },
              },
            },
            required: ['version', 'references'],
            additionalProperties: false,
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          resumeTaskId: { type: ['string', 'null'] },
        },
        required: ['skillId', 'contextEntityIds', 'visualReferenceIds', 'visualSummary', 'confidence'],
        additionalProperties: false,
      },
      execute: async (args) => {
        if (typeof handoffToImagePlanner !== 'function') throw new Error('handoff_to_image_planner is unavailable');
        return handoffToImagePlanner(args);
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
    ['start_skill_job', {
      name: 'start_skill_job',
      requiresConfirmation: true,
      readOnly: false,
      description: 'Start a confirmed batch Logo or Brand skill job.',
      parameters: {
        type: 'object',
        properties: {
          skillType: { type: 'string', enum: ['logo', 'brand'] },
          payload: { type: 'object' },
        },
        required: ['skillType'],
        additionalProperties: false,
      },
      execute: async (args) => {
        if (!SKILL_JOB_TYPES.has(args?.skillType)) throw new Error('Unsupported skill job type');
        if (typeof createSkillJob !== 'function') throw new Error('start_skill_job is unavailable');
        return createSkillJob(args.skillType, args.payload || {});
      },
    }],
    ['get_skill_job', {
      name: 'get_skill_job',
      requiresConfirmation: false,
      readOnly: true,
      description: 'Read the status of an existing skill job.',
      parameters: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
        additionalProperties: false,
      },
      execute: async (args) => {
        if (typeof args?.jobId !== 'string' || !args.jobId.trim()) throw new Error('jobId is required');
        if (typeof getSkillJob !== 'function') throw new Error('get_skill_job is unavailable');
        return getSkillJob(args.jobId.trim());
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
    }));
}

export async function executeAgentTool(registry, toolName, args, context = {}) {
  const tool = registry?.get(toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  if (!Array.isArray(context.allowedTools) || !context.allowedTools.includes(toolName)) {
    throw new Error(`Tool is not allowed: ${toolName}`);
  }
  const publicProgress = args?.publicProgress;
  const toolArgs = stripPublicProgress(args);
  validateAgentToolArguments(tool.parameters, toolArgs, toolName);
  if (tool.requiresConfirmation && context.confirmed !== true) {
    return {
      confirmationRequired: true,
      toolName,
      message: `确认后执行 ${toolName}`,
    };
  }
  return tool.execute(toolArgs, { ...context, publicProgress });
}
