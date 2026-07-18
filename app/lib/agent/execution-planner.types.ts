export interface AgentExecutionPlan {
  version: 1;
  intent: 'chat' | 'image' | 'skill_action' | 'analysis';
  skillId: string | null;
  confidence: 'high' | 'medium' | 'low';
  needsClarification: boolean;
  clarification: {
    dimension: string;
    question: string;
    reason?: string;
    options: Array<{ id: string; label: string; answer: string; description?: string }>;
  } | null;
  contextReferences: string[];
  brief: {
    deliverable: string;
    subject: string;
    style: string[];
    literalCopy: string[];
    constraints: string[];
  };
  delivery: {
    mode: 'single' | 'series' | 'variants' | 'composite';
    outputCount: number;
    panelCount: number | null;
    variationAxes: string[];
    sharedInvariants: string[];
    distinctPerItem: string[];
    items: Array<{
      index: number;
      label: string;
      subject: string;
      variation: string;
    }>;
  };
  execution: {
    kind: 'image_pipeline' | 'skill_job' | 'agent_loop' | 'none';
    requiresConfirmation: boolean;
    tool: string | null;
  };
}

export interface PlanValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type AgentPlannerSourceDetail =
  | 'tool_call'
  | 'repaired_tool_call'
  | 'text_json'
  | 'hard_literal'
  | 'planner_failed';

export interface AgentPlannerAttemptDiagnostic {
  attempt: number;
  responseMode: string;
  toolCallPresent: boolean;
  validationErrors: PlanValidationIssue[];
  normalizedFields: string[];
}

export interface AgentPlannerResolution {
  plan: AgentExecutionPlan | null;
  source: 'model' | 'fallback';
  sourceDetail: AgentPlannerSourceDetail;
  error?: string;
  attempts: number;
  validationErrors: PlanValidationIssue[];
  normalizedFields: string[];
  repairAttempted: boolean;
  diagnostics: AgentPlannerAttemptDiagnostic[];
  usage?: unknown;
}
