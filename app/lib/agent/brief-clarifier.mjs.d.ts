export interface BriefClarifierOption {
  id: string;
  label: string;
  answer: string;
  description?: string;
}

export interface BriefClarifierResult {
  version: 1;
  status: 'ready' | 'ask';
  workingBrief: string;
  ambiguity?: {
    dimension: string;
    critical: true;
    reason: string;
  };
  question?: string;
  options?: BriefClarifierOption[];
}

export interface AgentClarificationState {
  taskId: string;
  operationId?: string;
  skillSource?: 'manual' | 'auto' | null;
  lastSequence?: number;
  intent: 'image' | 'skill_action';
  skillId?: string;
  originalRequest: string;
  workingBrief: string;
  askedDimensions: string[];
  answers: Array<{ dimension: string; question: string; answer: string }>;
  referenceImages?: string[];
}

export function parseBriefClarifierResult(raw: string): BriefClarifierResult | null;
export function isPotentialDesignExecutionRequest(value: string): boolean;
export function shouldAskClarification(input: {
  result: BriefClarifierResult | null;
  userMessage: string;
  askedDimensions?: string[];
  referenceImageCount?: number;
  requireCreativeDirectionConfirmation?: boolean;
}): boolean;
export function buildBriefClarifierMessages(input?: Record<string, unknown>): Array<{ role: 'system' | 'user'; content: string }>;
export function resolveBriefClarification(input?: Record<string, unknown>): Promise<{
  result: BriefClarifierResult | null;
  failed: boolean;
  fallbackBrief: string;
  error?: string;
}>;
export function applyClarificationResponse(input?: Record<string, unknown>): {
  state: AgentClarificationState;
  answer: string;
  proceedWithCurrent: boolean;
  retry?: boolean;
} | null;
