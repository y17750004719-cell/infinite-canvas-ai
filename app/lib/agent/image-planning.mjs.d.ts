import type { AgentImagePlanningSnapshot } from './events';

export const IMAGE_PLANNING_STAGES: readonly ['routing', 'execution'];
export function createImagePlanningSnapshot(input?: Record<string, unknown>): AgentImagePlanningSnapshot;
export function restoreImagePlanningSnapshot(value: unknown, defaults?: Record<string, unknown>): AgentImagePlanningSnapshot;
export function setImagePlanningStage(snapshot: AgentImagePlanningSnapshot, stage: string, status?: string): AgentImagePlanningSnapshot;
export function completeImagePlanningStage(snapshot: AgentImagePlanningSnapshot, stage: string, nextStage?: string): AgentImagePlanningSnapshot;
export function failImagePlanningStage(snapshot: AgentImagePlanningSnapshot, stage: string, message: string, kind?: string): AgentImagePlanningSnapshot;
export function rewindImagePlanning(snapshot: AgentImagePlanningSnapshot, stage: string, runId: string): AgentImagePlanningSnapshot;
export function abandonImagePlanning(snapshot: AgentImagePlanningSnapshot): AgentImagePlanningSnapshot;
