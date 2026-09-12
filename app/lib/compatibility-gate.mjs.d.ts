export declare const CURRENT_CONTRACT_VERSION: string;
export declare const MIGRATION_REQUIRED_CODE: string;
export declare class MigrationRequiredError extends Error {
  statusCode: number;
  code: string;
  failureStage: string;
  sourceType: string;
  sourceVersion: string;
  requiredVersion: string;
  retryable: boolean;
  outcomeUnknown: boolean;
  constructor(options?: {
    sourceType?: string;
    sourceVersion?: string;
    requiredVersion?: string;
    message?: string;
  });
}
export declare function migrationErrorMeta(error: unknown): {
  code: string;
  failureStage: string;
  sourceType: string;
  sourceVersion: string;
  requiredVersion: string;
  retryable: false;
  outcomeUnknown: false;
} | null;
export declare function assertCurrentContract<T>(value: T, options?: { sourceType?: string; versionKey?: string }): T;
