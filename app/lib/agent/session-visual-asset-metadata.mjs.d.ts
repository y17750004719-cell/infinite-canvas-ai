import type { SessionVisualAsset } from '../db';

export function normalizeSessionVisualAssets(
  entries: unknown,
  options?: { sessionId?: string; maxItems?: number },
): SessionVisualAsset[];
