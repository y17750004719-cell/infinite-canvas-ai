import type { SessionVisualAsset } from '../db';

export const SESSION_VISUAL_ASSET_MAX_BYTES: number;
export const SESSION_VISUAL_ASSET_DIRECTORY: string;
export const SESSION_VISUAL_ASSET_MAX_DIMENSION: number;
export const SESSION_VISUAL_ASSET_MAX_PIXELS: number;

export class SessionVisualAssetError extends Error {
  code: 'SESSION_ASSET_SNAPSHOT_FAILED' | 'SESSION_ASSET_UNAVAILABLE' | 'image_decode_failed' | 'image_dimension_invalid';
  isRetryable: boolean;
}

export function materializeSessionVisualAsset(options?: {
  sessionId?: string;
  source?: string | Record<string, unknown>;
  existingAsset?: SessionVisualAsset;
  runtimeDir?: string;
  publicDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<SessionVisualAsset>;

export function readSessionVisualAsset(asset: SessionVisualAsset, options?: { runtimeDir?: string; publicDir?: string }): Promise<Buffer | null>;
export function isSessionVisualAssetAvailable(asset: SessionVisualAsset, options?: { runtimeDir?: string; publicDir?: string }): Promise<boolean>;
export function removeSessionVisualAssets(sessionId: string, options?: { runtimeDir?: string }): Promise<string>;
