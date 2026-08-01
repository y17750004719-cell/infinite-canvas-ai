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
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
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
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => validateAgentToolArguments(schema.items, entry, toolName, `${path}[${index}]`));
  }
  return value;
}

export function createAgentToolRegistry({ createSkillJob, getSkillJob, generateImage } = {}) {
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
