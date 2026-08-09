export function decryptXiaomiCode(privateKeyDer: Buffer, encryptedBase64: string): { apiKey: string; accountId: string; baseUrl: string };
export function beginXiaomiLogin(options?: { runtimeDir?: string; now?: number }): Promise<{ state: string; expiresAt: string; authorizeUrl: string; manualAuthorizeUrl: string }>;
export function completeXiaomiLogin(options: { state: string; code: string; runtimeDir?: string; now?: number }): Promise<{ accountId: string; selectedModel: string; modelProbeError: string }>;
export function getXiaomiLoginStatus(options: { state: string; runtimeDir?: string; now?: number }): Promise<{ status: string; accountId?: string; selectedModel?: string; modelProbeError?: string; error?: string; expiresAt?: string }>;
export function clearXiaomiLogin(runtimeDir?: string): Promise<void>;
