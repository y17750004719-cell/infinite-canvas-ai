import type { AgentContextEntity, AgentProposal } from './agent/context-reference.types';
import type { AgentTaskContract } from './agent/context-reference.types';
import type { CanvasItem } from './canvas-types';
import type { RegionSelection } from './image-region-selection.types';
import type { AgentAnalysisSnapshot, AgentRecoveryRecord } from './agent/events';
import { normalizeProjectSession } from './session-persistence.mjs';

export type { CanvasItem } from './canvas-types';
export type { AgentTaskContract } from './agent/context-reference.types';

const DB_NAME = 'zo-design-db';
const DB_VERSION = 3;
const STORE_NAME = 'sessions';

export {
  createEmptySession,
  deleteSessionFromList,
  renameSessionInList,
  upsertSessionInList,
} from './session-crud.mjs';

let db: IDBDatabase | null = null;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'skill';
  content: string;
  reasoningContent?: string;
  agentRunProgress?: import('./agent/run-progress.types').AgentRunProgress;
  imageUrl?: string;
  assetId?: string;
  deliveryId?: string;
  providerReturnedAt?: number;
  locallyStoredAt?: number;
  deliveryEventAt?: number;
  chatCommittedAt?: number;
  skill?: { id: string; label: string; skillContentHash?: string };
  referenceImages?: string[];
  referenceContext?: {
    references: Array<{
      id: string;
      src: string;
      assetId?: string;
      originalSrc?: string;
      previewSrc?: string;
      label: string;
      source: 'upload' | 'history' | 'canvas';
      canvasItemId?: string;
      role: 'reference' | 'edit_target' | 'annotation_bundle' | 'region_target';
      annotationCount?: number;
      regionId?: string;
      candidateId?: string;
      confirmationStatus?: 'pending' | 'confirmed';
      aliases?: string[];
      description?: string;
      confidence?: 'high' | 'medium' | 'low';
      sourceTaskId?: string;
      sourceVersionId?: string;
      targetPoint?: { x: number; y: number };
      targetBox?: { x: number; y: number; width: number; height: number };
    }>;
    composerSegments: Array<
      | { type: 'text'; text: string }
      | { type: 'reference'; referenceId: string }
    >;
    evidenceImages?: Array<{
      id: string;
      referenceId: string;
      src: string;
      kind: 'annotation_composite' | 'region_crop';
    }>;
  };
  resultTitle?: string;
  resultSummary?: string;
  imageOperation?: 'generate' | 'edit';
  targetReferenceId?: string;
  imageProviderId?: string;
  sourceReferenceId?: string;
  sourceTaskId?: string;
  sourceVersionId?: string;
  promptTrace?: {
    sourcePrompt: string;
    finalPrompt: string;
    optimized: boolean;
    operation: 'generate' | 'edit';
    targetReferenceId: string | null;
    skillId: string | null;
    skillRead: boolean;
  };
  agentImagePrompts?: Array<{
    index: number;
    label: string;
    prompt: string;
  }>;
  agentProgressMode?: 'full' | 'compact';
  inlineContent?: Array<
    | { type: 'text'; text: string }
    | {
        type: 'reference';
        referenceId: string;
        id?: string;
        src?: string;
        label?: string;
        source?: 'upload' | 'history' | 'canvas';
        annotationCount?: number;
      }
  >;
  model?: string;
  imageName?: string;
  agentClarification?: {
    request: {
      id: string;
      taskId: string;
      operationId?: string;
      lastSequence?: number;
      question: string;
      dimension: string;
      options: Array<{ id: string; label: string; answer: string; description?: string }>;
      allowCustom: boolean;
      allowProceed: boolean;
      failed?: boolean;
    };
    state: {
      taskId: string;
      sourceUserMessageId?: string;
      operationId?: string;
      skillSource?: 'manual_ui' | 'explicit_text' | 'user_confirmation' | 'recovery' | 'manual' | 'auto' | null;
      skillRead?: boolean;
      lastSequence?: number;
      intent: 'chat' | 'image' | 'skill_action';
      skillId?: string;
      originalRequest: string;
      workingBrief: string;
      askedDimensions: string[];
      answers: Array<{ dimension: string; question: string; answer: string }>;
      referenceImages?: string[];
      referenceContext?: ChatMessage['referenceContext'];
      contextCandidates?: AgentContextEntity[];
      recoveryRecord?: AgentRecoveryRecord;
      recoveryMode?: 'fill_missing' | 'redo_all';
      agentAnalysis?: AgentAnalysisSnapshot;
      imageOperation?: 'generate' | 'edit';
      targetReferenceId?: string;
      mainAgentLoop?: AgentRecoveryRecord['mainAgentLoop'];
    };
  };
  agentClarificationResponsePayload?: {
    clarification: NonNullable<ChatMessage['agentClarification']>;
    response: {
      requestId: string;
      selectedOptionId?: string;
      customText?: string;
      proceedWithCurrent?: boolean;
      retry?: boolean;
      retryMode?: 'replan';
    };
  };
  agentClarificationDismissed?: boolean;
  agentClarificationResolved?: boolean;
  agentProposal?: AgentProposal;
  agentProposalDismissed?: boolean;
  agentProposalResolved?: boolean;
  resolvedContext?: {
    entityIds: string[];
    labels: string[];
    kind: string;
    confidence: 'high' | 'medium';
  };
  taskSnapshot?: TaskSnapshot;
  agentRecovery?: AgentRecoveryRecord;
}

export interface SessionVisualAsset {
  id: string;
  sessionId: string;
  durableSrc: string;
  previewSrc?: string;
  originalSrc?: string;
  contentHash: string;
  mimeType: string;
  byteSize: number;
  naturalWidth?: number;
  naturalHeight?: number;
  source: 'upload' | 'canvas' | 'generated';
  sourceReferenceId?: string;
  taskId?: string;
  batchId?: string;
  versionId?: string;
  createdAt: number;
}

export interface AgentConversationMemory {
  version: 1;
  recentRawConversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  rollingSummary: string;
  facts: string[];
  preferences: string[];
  activeTask: {
    status: 'idle' | 'planning' | 'awaiting_confirmation' | 'executing' | 'completed' | 'failed';
    summary: string;
    taskId?: string;
  } | null;
  recentReferencedAssetIds: string[];
  updatedAt: number;
}

export type ContextEventType =
  | 'user_text'
  | 'assistant_text'
  | 'tool_call'
  | 'tool_result'
  | 'image_input'
  | 'image_output'
  | 'confirmation'
  | 'clarification'
  | 'recovery'
  | 'error'
  | 'compaction';

export interface ContextCompactionSummary {
  task: string;
  constraints: string[];
  decisions: string[];
  completedActions: string[];
  pendingActions: string[];
  toolFacts: string[];
  imageAssets: Array<{ assetId: string; role?: string; description?: string }>;
  confirmationState?: string | null;
  recoveryState?: string | null;
}

export interface ContextCompactionRecord {
  compactionId: string;
  sessionId: string;
  fromSequence: number;
  toSequence: number;
  summaryVersion: number;
  summary: ContextCompactionSummary;
  model: string;
  contextWindow: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: number;
}

export interface ContextTokenBudget {
  systemTokens: number;
  historyTokens: number;
  toolDefinitionTokens: number;
  visualTokens: number;
  outputReserve: number;
  fallbackReserve: number;
  effectiveInputBudget: number;
  fullContextLimit: number;
}

export interface ContextEvent {
  eventId: string;
  sessionId: string;
  sequence: number;
  turnId?: string;
  type: ContextEventType | string;
  source: string;
  timestampMs?: number;
  toolCallId?: string;
  parentEventId?: string;
  content?: string;
  assetId?: string;
  [key: string]: unknown;
}

export interface ContextHistory {
  schemaVersion: 3;
  auditEvents: ContextEvent[];
  modelEvents: ContextEvent[];
  compactionRecords: ContextCompactionRecord[];
  activeWindow: ContextWindowState;
  /** Monotonic revision of the complete session event history. */
  historyRevision?: number;
  /** Monotonic revision of user-authored turns. */
  userMessageRevision?: number;
  /** Revision of the currently materialized model window. */
  activeWindowRevision?: number;
}

export interface ContextWindowState {
  sessionId: string;
  startSequence: number;
  endSequence: number;
  compactCount: number;
  summaryVersion: number;
  estimatedTokens: number;
  model: string;
  contextWindow: number;
}

export interface GeneratedImageHistoryEntry {
  id: string;
  deliveryId?: string;
  src: string;
  assetId?: string;
  previewSrc?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  createdAt: number;
  source: 'chat' | 'image-card' | 'archive';
  sessionId?: string;
  sourceItemId?: string;
  messageId?: string;
  taskId?: string;
  contractVersion?: number;
  batchId?: string;
  slotId?: string;
  versionId?: string;
  parentVersionId?: string;
  operation?: 'generate' | 'edit';
  sourceReferenceId?: string;
  sourceTaskId?: string;
  sourceVersionId?: string;
  providerId?: string;
  model?: string;
  promptTrace?: ChatMessage['promptTrace'];
}

export interface TaskSnapshotActiveVersion {
  referenceId: string;
  batchId: string;
  slotId: string;
  versionId: string;
  assetUrl?: string;
  previewSrc?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  model?: string;
  itemId?: string;
  index?: number;
  label?: string;
  promptTrace?: ChatMessage['promptTrace'];
}

export interface TaskSnapshot {
  sessionId: string;
  taskId: string;
  /** Added in the identity protocol; absent only on legacy persisted snapshots. */
  operationId?: string;
  lastSequence?: number;
  contractVersion: number;
  contract?: AgentTaskContract;
  agentAnalysis?: AgentAnalysisSnapshot;
  editBaseVersionId?: string | null;
  latestBatchId?: string | null;
  activeVersions: TaskSnapshotActiveVersion[];
}

export interface ProjectSession {
  schemaVersion?: 5;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  items: CanvasItem[];
  textCardPanelDrafts?: Record<string, string>;
  imageCardPanelDrafts?: Record<string, string>;
  imageCardProviderById?: Record<string, string>;
  imageCardModelById?: Record<string, string>;
  imageCardSizeById?: Record<string, string>;
  imageCardQualityById?: Record<string, string>;
  imageCardCountById?: Record<string, number>;
  imageCardAspectRatioById?: Record<string, string>;
  connections?: Array<{
    id: string;
    fromItemId: string;
    toItemId: string;
  }>;
  messages: ChatMessage[];
  threadId?: string;
  turns?: Array<{
    turnId: string;
    operationId: string;
    runId?: string;
    runIds?: string[];
    startSequence?: number;
    startedAt?: number;
    completedAt?: number | null;
    status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
    items: Array<Record<string, unknown>>;
    usage: { inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null; reasoningOutputTokens: number | null; totalTokens: number | null; durationMs: number | null } | null;
    error?: Record<string, unknown> | null;
    recovery?: Record<string, unknown> | null;
  }>;
  activeTurn?: string | null;
  archived?: boolean;
  pendingApproval?: Record<string, unknown> | null;
  todoItems?: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }>;
  commandState?: { lastCommand: string | null; lastResult: unknown };
  lastSequence?: number;
  transcriptStartSequence?: number;
  transcriptSummary?: string | null;
  threadStatus?: 'idle' | 'running' | 'waiting' | 'error' | 'archived';
  activeSkill?: { id: string; label: string } | null;
  activeSkillExplicit?: boolean;
  agentMemory?: AgentConversationMemory;
  contextEvents?: ContextEvent[];
  contextHistory?: ContextHistory;
  compactedWindows?: Array<Record<string, unknown>>;
  activeContextWindow?: ContextWindowState;
  visualAssets?: SessionVisualAsset[];
  chatProviderId?: string;
  chatModelId?: string;
  imageProviderId?: string;
  imageModelId?: string;
  generatedImageHistory?: GeneratedImageHistoryEntry[];
  activeAgentRun?: {
    taskId?: string;
    runId: string;
    turnId?: string;
    operationId?: string;
    lastSequence?: number;
    userMessageId: string;
    assistantMessageId: string;
    startedAt: number;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
  };
  viewport: { x: number; y: number; scale: number };
  regionSelections?: RegionSelection[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }

      const transaction = (event.target as IDBOpenDBRequest).transaction;
      if (!transaction) return;
      const store = transaction.objectStore(STORE_NAME);
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;

        cursor.update(normalizeProjectSession(cursor.value));
        cursor.continue();
      };
    };
  });
}

function awaitTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function upsertSession(session: ProjectSession): Promise<void> {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const nextSession = normalizeProjectSession(session);
    const currentSession = await awaitRequest(store.get(session.id));
    const currentRevision = Number(currentSession?.schemaVersion) === 5
      ? Number(currentSession?.contextHistory?.historyRevision)
      : Number.NaN;
    const nextRevision = Number(nextSession.contextHistory?.historyRevision);
    // Async compact/recovery saves can finish after a newer request. Never let
    // a snapshot with an older event revision overwrite the durable history.
    if (
      Number.isFinite(currentRevision) &&
      Number.isFinite(nextRevision) &&
      currentRevision > nextRevision
    ) {
      await awaitTransaction(transaction);
      return;
    }
    store.put(nextSession);
    await awaitTransaction(transaction);
  } catch (error) {
    console.error('Failed to upsert session:', error);
    throw error;
  }
}

export async function loadSessions(): Promise<ProjectSession[]> {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const sessions = request.result;
        sessions.sort((a: ProjectSession, b: ProjectSession) => b.updatedAt - a.updatedAt);
        resolve(sessions);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to load sessions:', error);
    return [];
  }
}

export async function removeSession(sessionId: string): Promise<void> {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(sessionId);

    await awaitTransaction(transaction);
  } catch (error) {
    console.error('Failed to delete session:', error);
    throw error;
  }
}
