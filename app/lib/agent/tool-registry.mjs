const SKILL_JOB_TYPES = new Set(['logo', 'brand']);

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
  getConversationMemory,
  listProjectContext,
  readContextEntity,
  loadVisualReference,
  updateConversationMemory,
  resolveFailedTaskRecovery,
  handoffToImagePlanner,
  requestContextSelection,
} = {}) {
  const registry = new Map([
    ['generate_image', {
      name: 'generate_image',
      requiresConfirmation: false,
      readOnly: false,
      description: 'Generate one image from the current request.',
      parameters: { type: 'object', properties: {}, additionalProperties: true },
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
        parameters: tool.parameters,
      },
      readOnly: tool.readOnly === true,
      terminal: tool.terminal === true,
      countAgainstToolBudget: tool.countAgainstToolBudget !== false,
    }));
}

export async function executeAgentTool(registry, toolName, args, context = {}) {
  const tool = registry?.get(toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  if (!Array.isArray(context.allowedTools) || !context.allowedTools.includes(toolName)) {
    throw new Error(`Tool is not allowed: ${toolName}`);
  }
  validateAgentToolArguments(tool.parameters, args || {}, toolName);
  if (tool.requiresConfirmation && context.confirmed !== true) {
    return {
      confirmationRequired: true,
      toolName,
      message: `确认后执行 ${toolName}`,
    };
  }
  return tool.execute(args || {}, context);
}
