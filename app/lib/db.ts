const DB_NAME = 'zo-design-db';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

let db: IDBDatabase | null = null;

export interface CanvasItem {
  id: string;
  type: 'image' | 'frame' | 'shape' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  src?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  fill?: string;
  text?: string;
  visible: boolean;
  locked: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'skill';
  content: string;
  reasoningContent?: string;
  imageUrl?: string;
  skill?: { id: string; label: string };
  referenceImages?: string[];
  model?: string;
  imageName?: string;
}

export interface ChatTopic {
  id: string;
  title: string;
  messages: ChatMessage[];
  activeSkill?: { id: string; label: string } | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSession {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  items: CanvasItem[];
  messages: ChatMessage[]; // 保持兼容性
  topics?: ChatTopic[];    // 新增：对话项目列表
  activeTopicId?: string; // 新增：当前对话 ID
  viewport: { x: number; y: number; scale: number };
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

export async function saveSessions(sessions: ProjectSession[]): Promise<void> {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    store.clear();

    for (const session of sessions) {
      store.put(session);
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('Failed to save sessions:', error);
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

export async function deleteSessionFromDB(sessionId: string): Promise<void> {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(sessionId);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('Failed to delete session:', error);
    throw error;
  }
}

export async function clearAllSessions(): Promise<void> {
  try {
    const database = await openDB();
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('Failed to clear sessions:', error);
    throw error;
  }
}
