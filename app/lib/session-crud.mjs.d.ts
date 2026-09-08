import type { ProjectSession } from './db';

export function createEmptySession(options?: {
  existingCount?: number;
  now?: number;
  name?: string;
}): ProjectSession;

export function renameSessionInList(
  sessions: ProjectSession[],
  sessionId: string,
  nextName: string,
  now?: number,
): ProjectSession[];

export function upsertSessionInList(
  sessions: ProjectSession[],
  nextSession: ProjectSession,
): ProjectSession[];

export function deleteSessionFromList(options: {
  sessions: ProjectSession[];
  sessionId: string;
  currentSessionId?: string | null;
  now?: number;
}): {
  sessions: ProjectSession[];
  nextCurrentSessionId: string;
};
