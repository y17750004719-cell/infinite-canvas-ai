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
