export interface AgentToolContext {
  allowedTools: string[];
  confirmed?: boolean;
  canvasContext?: Record<string, unknown>;
}
export type AgentToolRegistry = Map<string, any>;
export function createAgentToolRegistry(dependencies?: Record<string, unknown>): AgentToolRegistry;
export function getAgentModelTools(registry: AgentToolRegistry, allowedTools: string[]): Array<{
  type: 'function';
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}>;
export function executeAgentTool(
  registry: Map<string, any>,
  toolName: string,
  args: Record<string, unknown>,
  context: AgentToolContext,
): Promise<unknown>;
