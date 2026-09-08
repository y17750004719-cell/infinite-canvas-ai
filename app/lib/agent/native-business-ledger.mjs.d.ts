export interface NativeBusinessOperationInput {
  sessionId: string;
  taskId: string;
  operationId: string;
  runId: string;
  contract: unknown;
  signal?: AbortSignal;
  root?: string;
}

export interface NativeBusinessOperationRecord {
  version: 1;
  kind: 'operation';
  sessionId: string;
  taskId?: string;
  operationId: string;
  runId?: string;
  contractHash?: string;
  contract?: unknown;
  status: 'running' | 'completed' | 'failed';
  attempt?: number;
  retryable: boolean;
  outcomeUnknown: boolean;
  result?: { assets: unknown[]; [key: string]: unknown };
  failure?: { code: string; message: string };
  createdAt: number | null;
  startedAt?: number;
  updatedAt: number | null;
  completedAt?: number;
  failedAt?: number;
  lockOnly?: boolean;
  persistenceRecovered?: boolean;
}

export interface NativeConfirmationInput {
  sessionId: string;
  confirmationId: string;
  taskId: string;
  operationId: string;
  runId: string;
  contract: unknown;
  parameters: unknown;
  expiresAt?: number;
  root?: string;
}

export interface NativeConfirmationRecord {
  version: 1;
  kind: 'confirmation';
  sessionId: string;
  confirmationId: string;
  taskId: string;
  operationId: string;
  runId: string;
  contractHash: string;
  contract: unknown;
  parametersHash: string;
  parameters: unknown;
  status: 'pending' | 'claimed';
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  claimedRunId?: string;
  claimedAt?: number;
}

export class NativeBusinessLedgerError extends Error {
  code: string;
  outcomeUnknown: boolean;
  retryable: boolean;
  record: unknown;
  result?: { assets: unknown[]; [key: string]: unknown };
}

export function hashNativeBusinessContract(contract: unknown): string;
export function readNativeBusinessOperation(input: Pick<NativeBusinessOperationInput, 'sessionId' | 'operationId' | 'root'>): Promise<NativeBusinessOperationRecord | null>;
export function executeNativeBusinessOperation<T extends { assets: unknown[] }>(
  input: NativeBusinessOperationInput,
  execute: (context: { signal?: AbortSignal; contractHash: string; attempt: number }) => Promise<T>,
): Promise<T>;
export function saveNativeConfirmation(input: NativeConfirmationInput): Promise<NativeConfirmationRecord>;
export function loadNativeConfirmation(input: Pick<NativeConfirmationInput, 'sessionId' | 'confirmationId' | 'root'>): Promise<NativeConfirmationRecord | null>;
export function claimNativeConfirmation(input: {
  sessionId: string;
  confirmationId: string;
  runId: string;
  contract?: unknown;
  contractHash?: string;
  root?: string;
}): Promise<NativeConfirmationRecord>;
