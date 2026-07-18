import type { AgentContextEntity, ExecutionBrief } from './context-reference.types';
import type { AgentExecutionPlan, AgentPlannerResolution, PlanValidationIssue } from './execution-planner.types';
export type { AgentExecutionPlan, AgentPlannerResolution, PlanValidationIssue } from './execution-planner.types';

export const AGENT_EXECUTION_PLAN_SCHEMA: Record<string, unknown>;
export const AGENT_EXECUTION_PLAN_TOOL: Record<string, unknown>;
export function buildAgentExecutionPlannerMessages(input?: Record<string, unknown>): Array<{ role: string; content: string }>;
export function parseAgentExecutionPlan(raw: string, options?: Record<string, unknown>): AgentExecutionPlan | null;
export function validateAgentExecutionPlan(value: unknown, options?: Record<string, unknown>): { plan: AgentExecutionPlan | null; validationErrors: PlanValidationIssue[]; normalizedFields: string[] };
export function buildFallbackAgentExecutionPlan(input?: Record<string, unknown>): AgentExecutionPlan | null;
export function planAgentExecutionRequest(input?: Record<string, unknown>): Promise<AgentPlannerResolution>;
export function executionPlanToImageDeliveryPlan(plan: AgentExecutionPlan): Record<string, unknown>;
export function executionPlanToBrief(plan: AgentExecutionPlan, userMessage: string, contextEntities?: AgentContextEntity[]): ExecutionBrief;
