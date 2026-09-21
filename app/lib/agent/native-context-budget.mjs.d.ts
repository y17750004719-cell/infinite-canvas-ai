export interface NativeContextLedger {
  version: 1;
  generation: number;
  nativeThreadId: string;
  turnCount: number;
  estimatedInputTokens: number;
  serializedInputBytes: number;
  imageOccurrences: number;
  uniqueImageHashes: string[];
  residentAssetIds: string[];
  residentImages?: Array<{ contentHash: string; assetId?: string; referenceId?: string }>;
  summaryVersion: number;
  rotationReason?: string;
  model?: string;
  scopeId?: string;
  providerFingerprint?: string;
  lastTurnStatus?: string;
  forcedRotationReason?: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export const NATIVE_CONTEXT_LEDGER_VERSION: 1;
export const NATIVE_CONTEXT_DEFAULTS: Readonly<{
  contextWindow: number;
  outputReserve: number;
  threshold: number;
  keepRecent: number;
  maxVisualReferences: number;
  maxCapsuleBytes: number;
  maxRecentImageTasks: number;
  maxImageTaskRequestBytes: number;
}>;
export interface RecentImageTaskFact {
  taskId?: string;
  status: string;
  originalRequest: string;
  skill: { id?: string; hash?: string } | 'unknown';
  referenceIds: string[];
  outputAssetIds: string[];
  options: Record<string, unknown> | 'unknown';
}
export function buildRecentImageTaskFacts(input?: Record<string, any>): RecentImageTaskFact[];
export function hashNativeImage(value: unknown): string;
export function normalizeNativeContextLedger(value: unknown): NativeContextLedger | null;
export function buildNativeContinuationCapsule(input?: Record<string, any>): string;
export function prepareBoundedNativeContext(input?: Record<string, any>): Record<string, any>;
export function completeNativeContextLedger(ledger: NativeContextLedger, input?: Record<string, any>): NativeContextLedger;
