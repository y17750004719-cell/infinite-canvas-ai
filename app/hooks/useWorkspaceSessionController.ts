'use client';

import { Dispatch, MouseEvent, SetStateAction, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  createEmptySession,
  deleteSessionFromList,
  loadSessions,
  ProjectSession,
  removeSession,
  renameSessionInList,
  upsertSession,
} from '../lib/db';
import { shouldFlushScheduledSessionSave } from '../lib/session-persistence.mjs';
import { mergeCurrentSessionSnapshotIntoSessions } from '../lib/session-transition-state.mjs';
import { resolveStateUpdate } from '../lib/state-update.mjs';

export type WorkspaceViewMode = 'gallery' | 'editor';
export type SessionMutationType = 'create' | 'delete';

export interface PendingSessionActionState {
  type: SessionMutationType;
  sessionId?: string;
}

interface WorkspaceUiSnapshot {
  sessions: ProjectSession[];
  currentSessionId: string;
  viewMode: WorkspaceViewMode;
  activeSession: ProjectSession | null;
}

interface PendingSessionSaveState {
  sessionId: string;
  epoch: number;
}

interface UseWorkspaceSessionControllerArgs<TResolvedSessionState> {
  resolveSessionPresentationState: (session: ProjectSession) => TResolvedSessionState;
  applyResolvedSessionState: (state: TResolvedSessionState) => void;
  buildCurrentSessionSnapshot: (session: ProjectSession) => ProjectSession;
  viewMode: WorkspaceViewMode;
  setViewMode: Dispatch<SetStateAction<WorkspaceViewMode>>;
  isHighFrequencyInteractionActive: boolean;
  sessionSaveSignal: unknown;
}

export function useWorkspaceSessionController<TResolvedSessionState>({
  resolveSessionPresentationState,
  applyResolvedSessionState,
  buildCurrentSessionSnapshot,
  viewMode,
  setViewMode,
  isHighFrequencyInteractionActive,
  sessionSaveSignal,
}: UseWorkspaceSessionControllerArgs<TResolvedSessionState>) {
  const [sessions, setSessionsState] = useState<ProjectSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [pendingSessionAction, setPendingSessionAction] = useState<PendingSessionActionState | null>(null);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);

  const sessionsRef = useRef<ProjectSession[]>([]);
  const currentSessionIdRef = useRef('');
  const pendingSessionActionRef = useRef<PendingSessionActionState | null>(null);
  const pendingSessionSaveRef = useRef<PendingSessionSaveState | null>(null);
  const pendingSessionSaveFrameRef = useRef<number | null>(null);
  const sessionPersistenceEpochRef = useRef(0);
  const sessionPersistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const skipNextSessionAutoSaveRef = useRef(false);
  const initializedRef = useRef(false);

  useLayoutEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const setSessions = useCallback((value: SetStateAction<ProjectSession[]>) => {
    const nextSessions = resolveStateUpdate(value, sessionsRef.current);
    sessionsRef.current = nextSessions;
    setSessionsState(nextSessions);
  }, []);

  useLayoutEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useLayoutEffect(() => {
    pendingSessionActionRef.current = pendingSessionAction;
  }, [pendingSessionAction]);

  useEffect(() => {
    if (!sessionActionError) return;

    const timeoutId = window.setTimeout(() => {
      setSessionActionError(null);
    }, 3200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [sessionActionError]);

  const enqueueSessionPersistenceTask = useCallback((task: () => Promise<void>) => {
    const runTask = sessionPersistenceQueueRef.current.catch(() => {}).then(task);
    sessionPersistenceQueueRef.current = runTask.catch(() => {});
    return runTask;
  }, []);

  const cancelPendingSessionSave = useCallback(() => {
    if (pendingSessionSaveFrameRef.current !== null) {
      cancelAnimationFrame(pendingSessionSaveFrameRef.current);
      pendingSessionSaveFrameRef.current = null;
    }
    pendingSessionSaveRef.current = null;
  }, []);

  const interruptSessionPersistence = useCallback(() => {
    cancelPendingSessionSave();
    sessionPersistenceEpochRef.current += 1;
  }, [cancelPendingSessionSave]);

  const syncWorkspaceUrl = useCallback((sessionId?: string | null) => {
    if (typeof window === 'undefined') return;
    if (sessionId) {
      window.history.pushState({}, '', `/?workspace=${sessionId}`);
      return;
    }
    window.history.pushState({}, '', '/');
  }, []);

  const applySessionState = useCallback((session: ProjectSession) => {
    const resolved = resolveSessionPresentationState(session);
    applyResolvedSessionState(resolved);
    setCurrentSessionId(session.id);
  }, [applyResolvedSessionState, resolveSessionPresentationState]);

  const applyLoadedSessionState = useCallback((
    session: ProjectSession,
    options: { interruptPersistence?: boolean } = {}
  ) => {
    if (options.interruptPersistence !== false) {
      interruptSessionPersistence();
    }
    skipNextSessionAutoSaveRef.current = true;
    applySessionState(session);
  }, [applySessionState, interruptSessionPersistence]);

  const captureWorkspaceUiSnapshot = useCallback((): WorkspaceUiSnapshot => {
    const currentSession = sessionsRef.current.find((session) => session.id === currentSessionIdRef.current) || null;

    if (!currentSession) {
      return {
        sessions: sessionsRef.current,
        currentSessionId: currentSessionIdRef.current,
        viewMode,
        activeSession: null,
      };
    }

    const currentSessionSnapshot = buildCurrentSessionSnapshot(currentSession);

    return {
      sessions: sessionsRef.current.map((session) =>
        session.id === currentSession.id ? currentSessionSnapshot : session
      ),
      currentSessionId: currentSessionIdRef.current,
      viewMode,
      activeSession: currentSessionSnapshot,
    };
  }, [buildCurrentSessionSnapshot, viewMode]);

  const restoreWorkspaceUiSnapshot = useCallback((snapshot: WorkspaceUiSnapshot) => {
    interruptSessionPersistence();
    setSessions(snapshot.sessions);
    setViewMode(snapshot.viewMode);

    if (snapshot.activeSession) {
      applyLoadedSessionState(snapshot.activeSession, { interruptPersistence: false });
    } else {
      setCurrentSessionId(snapshot.currentSessionId);
    }

    syncWorkspaceUrl(
      snapshot.viewMode === 'editor'
        ? snapshot.activeSession?.id || snapshot.currentSessionId || null
        : null
    );
  }, [applyLoadedSessionState, interruptSessionPersistence, setViewMode, syncWorkspaceUrl]);

  const flushCurrentSessionSave = useCallback(() => {
    if (pendingSessionSaveFrameRef.current !== null) {
      cancelAnimationFrame(pendingSessionSaveFrameRef.current);
      pendingSessionSaveFrameRef.current = null;
    }

    const pendingSave = pendingSessionSaveRef.current;
    pendingSessionSaveRef.current = null;
    if (!pendingSave) return;

    const latestSessions = sessionsRef.current;
    const latestCurrentSessionId = currentSessionIdRef.current;
    const currentEpoch = sessionPersistenceEpochRef.current;
    const hasPendingMutation = pendingSessionActionRef.current !== null;

    if (
      !shouldFlushScheduledSessionSave({
        scheduledSessionId: pendingSave.sessionId,
        scheduledEpoch: pendingSave.epoch,
        currentSessionId: latestCurrentSessionId,
        currentEpoch,
        sessions: latestSessions,
        hasPendingMutation,
      })
    ) {
      return;
    }

    const currentSession = latestSessions.find((session) => session.id === pendingSave.sessionId);
    if (!currentSession) return;

    const updatedSession = buildCurrentSessionSnapshot(currentSession);

    setSessions((prev) =>
      prev.map((session) => (session.id === pendingSave.sessionId ? updatedSession : session))
    );

    void enqueueSessionPersistenceTask(async () => {
      await upsertSession(updatedSession);
    }).catch((error) => {
      console.error('Failed to save current session:', error);
    });
  }, [buildCurrentSessionSnapshot, enqueueSessionPersistenceTask]);

  const commitCurrentSessionSnapshotBeforeTransition = useCallback(() => {
    cancelPendingSessionSave();

    const result = mergeCurrentSessionSnapshotIntoSessions({
      sessions: sessionsRef.current,
      currentSessionId: currentSessionIdRef.current,
      buildCurrentSessionSnapshot,
    }) as {
      sessions: ProjectSession[];
      currentSessionSnapshot: ProjectSession | null;
    };

    if (!result.currentSessionSnapshot) {
      return result;
    }

    sessionsRef.current = result.sessions;
    setSessions(result.sessions);

    void enqueueSessionPersistenceTask(async () => {
      await upsertSession(result.currentSessionSnapshot as ProjectSession);
    }).catch((error) => {
      console.error('Failed to persist current session before transition:', error);
    });

    return result;
  }, [buildCurrentSessionSnapshot, cancelPendingSessionSave, enqueueSessionPersistenceTask]);

  const scheduleCurrentSessionSave = useCallback(() => {
    if (pendingSessionActionRef.current) return;

    const sessionId = currentSessionIdRef.current;
    if (!sessionId) return;

    pendingSessionSaveRef.current = {
      sessionId,
      epoch: sessionPersistenceEpochRef.current,
    };

    if (pendingSessionSaveFrameRef.current !== null) {
      cancelAnimationFrame(pendingSessionSaveFrameRef.current);
    }

    pendingSessionSaveFrameRef.current = requestAnimationFrame(() => {
      pendingSessionSaveFrameRef.current = null;
      flushCurrentSessionSave();
    });
  }, [flushCurrentSessionSave]);

  const loadSession = useCallback((sessionId: string) => {
    if (pendingSessionActionRef.current) return;
    const { sessions: nextSessions } = commitCurrentSessionSnapshotBeforeTransition();
    const session = nextSessions.find((entry) => entry.id === sessionId);
    if (!session) return;

    applyLoadedSessionState(session);
  }, [applyLoadedSessionState, commitCurrentSessionSnapshotBeforeTransition]);

  const createNewProject = useCallback(async () => {
    if (pendingSessionActionRef.current) return;

    commitCurrentSessionSnapshotBeforeTransition();
    const snapshot = captureWorkspaceUiSnapshot();
    const now = Date.now();
    const newSession = createEmptySession({ existingCount: snapshot.sessions.length, now });
    const nextSessions = [newSession, ...snapshot.sessions];

    setSessionActionError(null);
    setPendingSessionAction({ type: 'create', sessionId: newSession.id });
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    applyLoadedSessionState(newSession);
    setViewMode('editor');
    syncWorkspaceUrl(newSession.id);

    try {
      await enqueueSessionPersistenceTask(async () => {
        await upsertSession(newSession);
      });
    } catch (error) {
      console.error('Failed to create project:', error);
      restoreWorkspaceUiSnapshot(snapshot);
      setSessionActionError('新建画布失败，请重试。');
    } finally {
      setPendingSessionAction(null);
    }
  }, [
    applyLoadedSessionState,
    commitCurrentSessionSnapshotBeforeTransition,
    captureWorkspaceUiSnapshot,
    enqueueSessionPersistenceTask,
    restoreWorkspaceUiSnapshot,
    setViewMode,
    syncWorkspaceUrl,
  ]);

  const renameSession = useCallback(async (sessionId: string, newName: string) => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      return false;
    }

    const nextSessions = renameSessionInList(sessionsRef.current, sessionId, trimmedName, Date.now());
    const updatedSession = nextSessions.find((session) => session.id === sessionId);
    if (!updatedSession) return false;

    try {
      await enqueueSessionPersistenceTask(async () => {
        await upsertSession(updatedSession);
      });
    } catch (error) {
      console.error('Failed to rename project:', error);
      return false;
    }

    setSessions(nextSessions);
    return true;
  }, [enqueueSessionPersistenceTask]);

  const deleteSession = useCallback(async (sessionId: string, e: MouseEvent) => {
    e.stopPropagation();
    if (pendingSessionActionRef.current) return;
    if (!confirm('确定要删除这个画布吗？')) return;

    interruptSessionPersistence();
    const snapshot = captureWorkspaceUiSnapshot();
    const deletionResult = deleteSessionFromList({
      sessions: snapshot.sessions,
      sessionId,
      currentSessionId: currentSessionIdRef.current,
      now: Date.now(),
    });
    const nextSession = deletionResult.sessions.find(
      (session) => session.id === deletionResult.nextCurrentSessionId
    ) || null;
    const shouldPersistFallbackSession =
      !!nextSession && !snapshot.sessions.some((session) => session.id === nextSession.id);

    setSessionActionError(null);
    setPendingSessionAction({ type: 'delete', sessionId });
    sessionsRef.current = deletionResult.sessions;
    setSessions(deletionResult.sessions);

    if (sessionId === currentSessionIdRef.current && nextSession) {
      applyLoadedSessionState(nextSession);
      syncWorkspaceUrl(viewMode === 'editor' ? nextSession.id : null);
    }

    try {
      await enqueueSessionPersistenceTask(async () => {
        await removeSession(sessionId);
        if (shouldPersistFallbackSession && nextSession) {
          await upsertSession(nextSession);
        }
      });
    } catch (error) {
      console.error('Failed to delete project:', error);
      restoreWorkspaceUiSnapshot(snapshot);
      setSessionActionError('删除画布失败，请重试。');
    } finally {
      setPendingSessionAction(null);
    }
  }, [
    applyLoadedSessionState,
    captureWorkspaceUiSnapshot,
    enqueueSessionPersistenceTask,
    interruptSessionPersistence,
    restoreWorkspaceUiSnapshot,
    syncWorkspaceUrl,
    viewMode,
  ]);

  const leaveEditor = useCallback(() => {
    if (pendingSessionActionRef.current) return;

    commitCurrentSessionSnapshotBeforeTransition();
    interruptSessionPersistence();
    setViewMode('gallery');
    syncWorkspaceUrl(null);
  }, [commitCurrentSessionSnapshotBeforeTransition, interruptSessionPersistence, setViewMode, syncWorkspaceUrl]);

  const enterEditor = useCallback((sessionId: string) => {
    if (pendingSessionActionRef.current) return;
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (session) {
      applyLoadedSessionState(session);
      setViewMode('editor');
      syncWorkspaceUrl(sessionId);
    }
  }, [applyLoadedSessionState, setViewMode, syncWorkspaceUrl]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initProject = async () => {
      const savedSessions = await loadSessions();

      if (savedSessions && savedSessions.length > 0) {
        const normalizedSessions = savedSessions.map((session) => {
          const resolved = resolveSessionPresentationState(session) as {
            normalizedSession: ProjectSession;
            items: ProjectSession['items'];
          };

          return {
            ...resolved.normalizedSession,
            items: resolved.items,
          };
        });

        sessionsRef.current = normalizedSessions;
        setSessions(normalizedSessions);

        const urlParams = new URLSearchParams(window.location.search);
        const workspaceId = urlParams.get('workspace');

        if (!workspaceId) {
          setViewMode('gallery');
          return;
        }

        setViewMode('editor');
        const targetSession = normalizedSessions.find((session) => session.id === workspaceId) || normalizedSessions[0];
        applyLoadedSessionState(targetSession);
      } else {
        await createNewProject();
      }
    };

    void initProject();
  }, [applyLoadedSessionState, createNewProject, resolveSessionPresentationState, setViewMode]);

  useEffect(() => {
    if (currentSessionId && !isHighFrequencyInteractionActive) {
      if (skipNextSessionAutoSaveRef.current) {
        skipNextSessionAutoSaveRef.current = false;
        return;
      }
      scheduleCurrentSessionSave();
    }
  }, [
    currentSessionId,
    isHighFrequencyInteractionActive,
    scheduleCurrentSessionSave,
    sessionSaveSignal,
  ]);

  return {
    sessions,
    currentSessionId,
    pendingSessionAction,
    sessionActionError,
    setSessionActionError,
    setCurrentSessionId,
    setSessions,
    createNewProject,
    renameSession,
    deleteSession,
    loadSession,
    leaveEditor,
    enterEditor,
    scheduleCurrentSessionSave,
  };
}
