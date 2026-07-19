import type { AgentContextEntity, AgentProposal } from './agent/context-reference.types';
import type { CanvasItem } from './canvas-types';
import type { RegionSelection } from './image-region-selection.types';

export type { CanvasItem } from './canvas-types';

const DB_NAME = 'zo-design-db';
const DB_VERSION = 1;
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
  skill?: { id: string; label: string };
  referenceImages?: string[];
  referenceContext?: {
    references: Array<{
      id: string;
      src: string;
      label: string;
      source: 'upload' | 'history' | 'canvas';
      canvasItemId?: string;
      role: 'reference' | 'edit_target' | 'annotation_bundle' | 'region_target';
      annotationCount?: number;
      regionId?: string;
      candidateId?: string;
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
      kind: 'annotation_composite';
    }>;
  };
  resultTitle?: string;
  resultSummary?: string;
  imageOperation?: 'generate' | 'edit';
  imageProviderId?: string;
  sourceReferenceId?: string;
  promptTrace?: {
    sourcePrompt: string;
    finalPrompt: string;
    optimized: boolean;
    operation: 'generate' | 'edit';
    targetReferenceId: string | null;
  };
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
      question: string;
      dimension: string;
      options: Array<{ id: string; label: string; answer: string; description?: string }>;
      allowCustom: true;
      allowProceed: true;
      failed?: boolean;
    };
    state: {
      taskId: string;
      operationId?: string;
      skillSource?: 'manual' | 'auto' | null;
      lastSequence?: number;
      intent: 'image' | 'skill_action';
      skillId?: string;
      originalRequest: string;
      workingBrief: string;
      askedDimensions: string[];
      answers: Array<{ dimension: string; question: string; answer: string }>;
      referenceImages?: string[];
      referenceContext?: ChatMessage['referenceContext'];
      contextCandidates?: AgentContextEntity[];
      plannerFailure?: {
        reason: 'timeout' | 'transport' | 'invalid_reference' | 'invalid_context' | 'invalid_plan' | 'vision_unsupported' | 'vision_unavailable';
        retryMode: 'replan';
        failedAt: number;
      };
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
  executionBriefSummary?: string;
}

export interface ChatTopic {
  id: string;
  title: string;
  messages: ChatMessage[];
  activeSkill?: { id: string; label: string } | null;
  activeSkillExplicit?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GeneratedImageHistoryEntry {
  id: string;
  src: string;
  naturalWidth?: number;
  naturalHeight?: number;
  createdAt: number;
  source: 'chat' | 'image-card' | 'archive';
  sourceItemId?: string;
  topicId?: string;
  messageId?: string;
  operation?: 'generate' | 'edit';
  sourceReferenceId?: string;
  providerId?: string;
  model?: string;
  promptTrace?: ChatMessage['promptTrace'];
}

export interface ProjectSession {
  schemaVersion?: 2;
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
  messages: ChatMessage[]; // 保持兼容性
  topics?: ChatTopic[];    // 新增：对话项目列表
  activeTopicId?: string; // 新增：当前对话 ID
  chatProviderId?: string;
  chatModelId?: string;
  imageProviderId?: string;
  imageModelId?: string;
  generatedImageHistory?: GeneratedImageHistoryEntry[];
  activeAgentRun?: {
    runId: string;
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

export async function upsertSession(session: ProjectSession): Promise<void> {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    store.put(session);
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
