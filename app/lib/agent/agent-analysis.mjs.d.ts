import type { AgentAnalysisSnapshot } from './events';

export const MAX_AGENT_ANALYSIS_CHECKPOINTS: number;
export function normalizeAgentAnalysisCheckpoint(args: unknown): Record<string, unknown>;
export function createAgentAnalysisSnapshot(input?: Record<string, unknown>): AgentAnalysisSnapshot;
export function restoreAgentAnalysisSnapshot(value: unknown, defaults?: Record<string, unknown>): AgentAnalysisSnapshot;
export function applyAgentAnalysisCheckpoint(snapshot: AgentAnalysisSnapshot, args: unknown): Record<string, unknown>;
export function recordAgentUserDecision(snapshot: AgentAnalysisSnapshot, dimension: string, answer: string): AgentAnalysisSnapshot;
