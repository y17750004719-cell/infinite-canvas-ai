import type { AgentActiveTaskVersion } from './execution-planner.types';

export function requireOriginalAsset(input?: {
  targetReferenceId?: string | null;
  pinnedVersionId?: string | null;
  editBaseAsset?: AgentActiveTaskVersion | null;
  activeVersions?: AgentActiveTaskVersion[];
  references?: Array<{ id: string; src: string; label?: string; source?: 'upload' | 'history' | 'canvas' }>;
}): AgentActiveTaskVersion | { id: string; src: string; label?: string; source?: 'upload' | 'history' | 'canvas' };

export function invokeWithOriginalAsset<T>(input: Parameters<typeof requireOriginalAsset>[0], invoke: (asset: ReturnType<typeof requireOriginalAsset>) => T | Promise<T>): Promise<T>;
