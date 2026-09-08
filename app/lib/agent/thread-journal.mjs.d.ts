export type JournalEvent = Record<string, unknown> & {
  type: string;
  threadId?: string;
  turnId?: string;
  taskId?: string;
  operationId?: string;
  runId?: string;
  sequence?: number;
  timestampMs?: number;
};

export type ThreadJournalOptions = { rootDir?: string };
export type JournalQuery = {
  afterSequence?: number;
  beforeSequence?: number;
  limit?: number;
};

export function loadThread(threadId: string): Promise<{ state: Record<string, unknown>; events: JournalEvent[] }>;
export function appendThreadEvent(threadId: string, event: JournalEvent): Promise<JournalEvent>;
export function sanitizeJournalValue(value: unknown): { value: unknown; redactions: number };
export function sanitizeJournalEvent(event: JournalEvent): { event: JournalEvent; serialized: string };
export function updateThreadState(threadId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
export function queueThreadInput(threadId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
export function consumeThreadInputs(threadId: string, identity: Record<string, unknown>, delivery: 'steer' | 'follow_up', limit?: number): Promise<Record<string, unknown>[]>;
export function queryThread(threadId: string, options?: JournalQuery): Promise<{ state: Record<string, unknown>; events: JournalEvent[]; hasOlder: boolean; hasNewer: boolean; latestSequence: number }>;
export function listThreads(): Promise<Record<string, unknown>[]>;
export function forkThread(threadId: string): Promise<Record<string, unknown>>;
export function safeId(threadId: string): string;
