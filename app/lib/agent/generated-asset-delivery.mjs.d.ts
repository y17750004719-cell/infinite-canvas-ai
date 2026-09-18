export type GeneratedAssetDeliveryInput = {
  deliveryId?: string;
  assetId?: string;
  versionId?: string;
  slotId?: string;
  itemId?: string;
  src?: string;
};

export function buildGeneratedAssetDeliveryId(options?: {
  runId?: string;
  taskId?: string;
  batchId?: string;
  asset?: GeneratedAssetDeliveryInput;
  index?: number;
}): string;

export function enrichGeneratedAssetDeliveryAction<Action>(
  action: Action,
  options?: { now?: () => number },
): Action;

export function getGeneratedAssetDeliveryPresence(
  asset: GeneratedAssetDeliveryInput,
  chatMessages?: Array<{ deliveryId?: string; assetId?: string; versionId?: string; imageUrl?: string }>,
  items?: Array<{ deliveryId?: string; assetId?: string; versionId?: string; src?: string }>,
): { chat: boolean; canvas: boolean };

export function collectPendingGeneratedAssetDeliveries(
  session: { id: string; messages?: unknown[]; visualAssets?: unknown[]; generatedImageHistory?: unknown[] },
  events?: unknown[],
): Array<GeneratedAssetDeliveryInput & {
  src: string;
  deliveryId: string;
  taskId?: string;
  previewSrc?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  model?: string;
  label?: string;
  createdAt?: number;
  providerReturnedAt?: number;
  locallyStoredAt?: number;
  deliveryEventAt?: number;
}>;
