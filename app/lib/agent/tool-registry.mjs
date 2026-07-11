const SKILL_JOB_TYPES = new Set(['logo', 'brand']);

export function createAgentToolRegistry({ createSkillJob, getSkillJob, generateImage } = {}) {
  return new Map([
    ['generate_image', {
      name: 'generate_image',
      requiresConfirmation: false,
      execute: async (args, context) => {
        if (typeof generateImage !== 'function') throw new Error('generate_image is unavailable');
        return generateImage(args, context);
      },
    }],
    ['get_canvas_context', {
      name: 'get_canvas_context',
      requiresConfirmation: false,
      execute: async (_args, context) => context.canvasContext || {},
    }],
    ['start_skill_job', {
      name: 'start_skill_job',
      requiresConfirmation: true,
      execute: async (args) => {
        if (!SKILL_JOB_TYPES.has(args?.skillType)) throw new Error('Unsupported skill job type');
        if (typeof createSkillJob !== 'function') throw new Error('start_skill_job is unavailable');
        return createSkillJob(args.skillType, args.payload || {});
      },
    }],
    ['get_skill_job', {
      name: 'get_skill_job',
      requiresConfirmation: false,
      execute: async (args) => {
        if (typeof args?.jobId !== 'string' || !args.jobId.trim()) throw new Error('jobId is required');
        if (typeof getSkillJob !== 'function') throw new Error('get_skill_job is unavailable');
        return getSkillJob(args.jobId.trim());
      },
    }],
  ]);
}

export async function executeAgentTool(registry, toolName, args, context = {}) {
  const tool = registry?.get(toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  if (!Array.isArray(context.allowedTools) || !context.allowedTools.includes(toolName)) {
    throw new Error(`Tool is not allowed: ${toolName}`);
  }
  if (tool.requiresConfirmation && context.confirmed !== true) {
    return {
      confirmationRequired: true,
      toolName,
      message: `确认后执行 ${toolName}`,
    };
  }
  return tool.execute(args || {}, context);
}
