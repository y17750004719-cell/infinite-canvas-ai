import type { AgentContextEntity, ExecutionBrief } from './context-reference.types';
import type {
  AgentExecutionPlan,
  AgentExecutionPlannerInput,
  AgentExecutionPlanValidationOptions,
  AgentTaskContract,
  AgentActiveTaskContext,
  AgentPlannerResolution,
  AgentPlannerFailureReason,
  PlanValidationIssue,
} from './execution-planner.types';
export type {
  AgentExecutionPlan,
  AgentExecutionPlannerInput,
  AgentExecutionPlanValidationOptions,
  AgentTaskRelation,
  AgentTaskContract,
  AgentActiveTaskVersion,
  AgentActiveTaskContext,
  AgentImageTask,
  AgentGenerationContract,
  AgentPlanPresentation,
  AgentVisualContext,
  AgentVisualReferenceRole,
  AgentPlannerComposerSegment,
  AgentPlannerReference,
  AgentPlannerReferenceContext,
  AgentRegionSelection,
  AgentPlannerResolution,
  AgentPlannerFailureReason,
  PlanValidationIssue,
} from './execution-planner.types';

export const AGENT_EXECUTION_PLAN_SCHEMA: Record<string, unknown>;
export const AGENT_EXECUTION_PLAN_TOOL: Record<string, unknown>;
export function compactCanvasContext(value: unknown): Record<string, unknown> | null;
export function buildAgentExecutionPlanTool(input?: AgentExecutionPlannerInput): Record<string, unknown>;
export function buildAgentExecutionPlannerMessages(input?: AgentExecutionPlannerInput): Array<{
  role: string;
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
}>;
export function parseAgentExecutionPlan(raw: string, options?: AgentExecutionPlanValidationOptions): AgentExecutionPlan | null;
export function validateAgentExecutionPlan(value: unknown, options?: AgentExecutionPlanValidationOptions): { plan: AgentExecutionPlan | null; validationErrors: PlanValidationIssue[]; normalizedFields: string[] };
export function buildAgentTaskContract(plan: AgentExecutionPlan | AgentTaskContract, activeTaskContext?: AgentActiveTaskContext | null): AgentTaskContract;
export function areAgentTaskContractsEqual(left: AgentExecutionPlan | AgentTaskContract, right: AgentExecutionPlan | AgentTaskContract, activeTaskContext?: AgentActiveTaskContext | null): boolean;
export function buildFallbackAgentExecutionPlan(input?: AgentExecutionPlannerInput): AgentExecutionPlan | null;
export function planAgentExecutionRequest(input?: AgentExecutionPlannerInput): Promise<AgentPlannerResolution>;
export function executionPlanToImageDeliveryPlan(plan: AgentExecutionPlan): Record<string, unknown>;
export function executionPlanToBrief(plan: AgentExecutionPlan, userMessage: string, contextEntities?: AgentContextEntity[]): ExecutionBrief;
