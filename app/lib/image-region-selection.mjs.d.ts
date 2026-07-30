export interface NormalizedPoint { x: number; y: number }
export interface NormalizedBox { x: number; y: number; width: number; height: number }
export interface RegionCandidate {
  id: string;
  label: string;
  aliases: string[];
  confidence: 'high' | 'medium' | 'low';
  description?: string;
  box?: NormalizedBox;
}
export interface RegionSelection {
  id: string;
  imageItemId: string;
  imageSrc: string;
  mode: 'point' | 'box';
  point: NormalizedPoint;
  box?: NormalizedBox;
  candidates: RegionCandidate[];
  selectedCandidateId?: string;
  customLabel?: string;
  confirmationStatus?: 'pending' | 'confirmed';
  status: 'recognizing' | 'ready' | 'ambiguous' | 'failed';
  error?: string;
  recognitionRevision?: number;
}
export interface AgentRegionTargetReference {
  id?: string;
  label: string;
  role: string;
  canvasItemId?: string;
  regionId?: string;
  candidateId?: string;
  confirmationStatus?: 'pending' | 'confirmed';
  aliases?: string[];
  description?: string;
  confidence?: 'high' | 'medium' | 'low';
  targetPoint?: NormalizedPoint;
  targetBox?: NormalizedBox;
}
export interface AgentRegionSelectionSnapshot {
  regionId: string;
  imageItemId: string;
  point: NormalizedPoint;
  box?: NormalizedBox;
  label: string;
  candidateId?: string;
  aliases?: string[];
  description?: string;
  confidence?: 'high' | 'medium' | 'low';
}
export function clampNormalized(value: unknown): number;
export function normalizeRegionPoint(value: unknown): NormalizedPoint | null;
export function normalizeRegionBox(value: unknown): NormalizedBox | undefined;
export function buildRegionBox(start: unknown, end: unknown): NormalizedBox | undefined;
export function buildRegionEvidenceCrop(input: Record<string, unknown>): NormalizedBox | null;
export function canvasPointToImageNormalized(input: Record<string, unknown>): NormalizedPoint | null;
export function imageNormalizedToItemLocal(input: Record<string, unknown>): NormalizedPoint | null;
export function normalizeLocateCandidates(value: unknown): RegionCandidate[];
export function buildRegionRecognitionPrompt(input: {
  mode?: 'point' | 'box';
  point: unknown;
  box?: unknown;
  hasMarkedImage?: boolean;
  hasCropImage?: boolean;
}): string;
export function parseLocateModelResponse(response: unknown): { candidates: RegionCandidate[]; selectedCandidateId: string; lowConfidence: boolean };
export function selectedRegionLabel(region: Partial<RegionSelection> | null | undefined): string;
export function buildAgentRegionSelectionSnapshot(input?: {
  references?: AgentRegionTargetReference[];
  regions?: RegionSelection[];
}): { regionSelections: AgentRegionSelectionSnapshot[]; missingRegionIds: string[] };
