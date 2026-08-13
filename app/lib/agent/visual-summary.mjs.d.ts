export type AgentVisualSummary = {
  version: 1;
  references: Array<{
    referenceId: string;
    description: string;
    salientSubjects: string[];
    visibleText: string[];
  }>;
};

export function normalizeAgentVisualSummary(
  value: unknown,
  expectedReferenceIds?: string[],
): AgentVisualSummary | null;
