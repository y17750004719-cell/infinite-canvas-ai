export const CURRENT_CONTRACT_VERSION = 'native-image-v1';
export const MIGRATION_REQUIRED_CODE = 'migration_required';

export class MigrationRequiredError extends Error {
  constructor({ sourceType, sourceVersion = 'legacy', requiredVersion = CURRENT_CONTRACT_VERSION, message } = {}) {
    super(message || `Migration required for ${sourceType || 'request'}`);
    this.name = 'MigrationRequiredError';
    this.statusCode = 409;
    this.code = MIGRATION_REQUIRED_CODE;
    this.failureStage = 'compatibility_gate';
    this.sourceType = sourceType || 'unknown';
    this.sourceVersion = sourceVersion;
    this.requiredVersion = requiredVersion;
    this.retryable = false;
    this.outcomeUnknown = false;
  }
}

export function migrationErrorMeta(error) {
  if (!(error instanceof MigrationRequiredError)) return null;
  return {
    code: error.code,
    failureStage: error.failureStage,
    sourceType: error.sourceType,
    sourceVersion: error.sourceVersion,
    requiredVersion: error.requiredVersion,
    retryable: false,
    outcomeUnknown: false,
  };
}

export function assertCurrentContract(value, { sourceType, versionKey = 'contractVersion' } = {}) {
  const version = value && typeof value === 'object' ? value[versionKey] : undefined;
  if (version !== CURRENT_CONTRACT_VERSION) {
    throw new MigrationRequiredError({ sourceType, sourceVersion: version || 'legacy' });
  }
  return value;
}
