export const NATIVE_SOURCE_COMMIT: string;
export const NATIVE_DISABLED_FEATURES: readonly string[];
export function assertNativeCapabilitySnapshot(snapshot: Record<string, unknown>, input?: { providerProtocol?: string }): Record<string, unknown>;
export function nativeProviderFingerprint(provider: { id: string; model: string; baseUrl: string }): string;
export function nativeConfig(provider: { model: string; baseUrl: string }): string;
export function acquireNativeCodexHost(input: { provider: Record<string, any>; ownerId?: string; runtimeRoot?: string }): Promise<{
  client: any; cwd: string; scopeId: string; privateHome: string;
  registerThreadHandler(threadId: string, handler: { onNotification?: (event: any) => any; onToolCall?: (event: any) => any }): () => void;
}>;
export function prepareNativeTurnInput(host: any, input: { userText: string; images?: string[]; skills?: Array<{id: string; name?: string; content: string; hash?: string}> }): Promise<any[]>;
