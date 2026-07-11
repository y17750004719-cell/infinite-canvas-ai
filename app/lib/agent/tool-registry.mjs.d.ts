export interface AgentToolContext {
  allowedTools: string[];
  confirmed?: boolean;
  canvasContext?: Record<string, unknown>;
}
export function createAgentToolRegistry(dependencies?: Record<string, unknown>): Map<string, any>;
export function executeAgentTool(
  registry: Map<string, any>,
  toolName: string,
  args: Record<string, unknown>,
  context: AgentToolContext,
): Promise<unknown>;
