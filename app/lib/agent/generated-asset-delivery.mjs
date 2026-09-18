import { adaptCanonicalEvent } from './canonical-event-adapter.mjs';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function identityPart(value) {
  return text(value).replace(/[^a-zA-Z0-9._:-]+/g, '_').slice(0, 240);
}

/**
 * Build one replay-stable identity for a generated asset delivery. Prefer the
 * durable business identities and only fall back to the source URL for legacy
 * events that predate task/version metadata.
 * @param {{runId?: string, taskId?: string, batchId?: string, asset?: {deliveryId?: string, versionId?: string, assetId?: string, slotId?: string, itemId?: string, src?: string}, index?: number}} [options]
 */
export function buildGeneratedAssetDeliveryId(options = {}) {
  const { runId, taskId, batchId, asset, index = 0 } = options;
  if (text(asset?.deliveryId)) return text(asset.deliveryId);
  const durableIdentity = text(asset?.versionId) || text(asset?.assetId) || text(asset?.slotId);
  if (durableIdentity) return `generated-delivery:${identityPart(durableIdentity)}`;
  const candidate = text(asset?.itemId) || text(asset?.src) || `index-${index}`;
  const scope = text(taskId) || text(batchId) || text(runId) || 'generated-asset';
  return `generated-delivery:${identityPart(scope)}:${identityPart(candidate)}`;
}

/**
 * Add delivery identity and timestamps without changing the public action shape.
 * @param {any} action
 * @param {{now?: () => number}} [options]
 */
export function enrichGeneratedAssetDeliveryAction(action, { now = Date.now } = {}) {
  if (!action || action.type !== 'add_generated_assets' || !Array.isArray(action.assets)) return action;
  const deliveryEventAt = Number.isFinite(action.deliveryEventAt) ? action.deliveryEventAt : now();
  return {
    ...action,
    deliveryEventAt,
    assets: action.assets.map((asset, index) => ({
      ...asset,
      deliveryId: buildGeneratedAssetDeliveryId({
        runId: action.runId,
        taskId: action.taskId,
        batchId: action.batchId,
        asset,
        index,
      }),
      deliveryEventAt: Number.isFinite(asset?.deliveryEventAt) ? asset.deliveryEventAt : deliveryEventAt,
    })),
  };
}

function matchesGeneratedAsset(asset, entry) {
  return Boolean(
    (asset.deliveryId && entry?.deliveryId === asset.deliveryId)
    || (asset.assetId && entry?.assetId === asset.assetId)
    || (asset.versionId && entry?.versionId === asset.versionId)
    || (asset.src && (entry?.src === asset.src || entry?.imageUrl === asset.src)),
  );
}

export function getGeneratedAssetDeliveryPresence(asset, chatMessages = [], items = []) {
  return {
    chat: chatMessages.some((entry) => matchesGeneratedAsset(asset, entry)),
    canvas: items.some((entry) => matchesGeneratedAsset(asset, entry)),
  };
}

/** Recover only durable image task outputs whose local delivery has not settled. */
export function collectPendingGeneratedAssetDeliveries(session, events = []) {
  const sessionId = text(session?.id);
  if (!sessionId) return [];
  const snapshots = (session.messages || []).flatMap((message) => [message.taskSnapshot, message.agentRecovery?.taskSnapshot]);
  const registered = [...(session.visualAssets || [])];
  const candidates = [];
  for (const rawEvent of events) {
    if (rawEvent?.threadId && rawEvent.threadId !== sessionId) continue;
    const event = adaptCanonicalEvent(rawEvent) || rawEvent;
    if (event?.taskSnapshot) snapshots.push(event.taskSnapshot);
    if (event?.recoveryRecord?.taskSnapshot) snapshots.push(event.recoveryRecord.taskSnapshot);
    const action = event?.action;
    if (action?.sessionId && action.sessionId !== sessionId) continue;
    if (action?.type === 'register_session_visual_assets') registered.push(...(action.assets || []));
    if (action?.type === 'add_generated_assets') candidates.push(...(action.assets || []).map((asset) => ({ ...asset, taskId: action.taskId || event.taskId })));
  }
  for (const snapshot of snapshots) {
    if (!snapshot || (snapshot.sessionId && snapshot.sessionId !== sessionId)) continue;
    for (const version of snapshot.activeVersions || []) {
      candidates.push({ ...version, src: version.assetUrl, taskId: snapshot.taskId });
    }
  }
  for (const asset of registered) {
    if (asset.source !== 'generated' || asset.sessionId !== sessionId || !asset.taskId) continue;
    candidates.push({ ...asset, assetId: asset.id, src: asset.durableSrc });
  }
  const bySource = new Map();
  for (const candidate of candidates) {
    const src = text(candidate.src);
    if (!/^(?:\/(?!\/)|https?:\/\/)/i.test(src)) continue;
    const defined = Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined));
    const asset = { ...bySource.get(src), ...defined, src };
    asset.deliveryId = buildGeneratedAssetDeliveryId({ taskId: asset.taskId, asset });
    bySource.set(src, asset);
  }
  // History is written in the same synchronous commit as both presentation
  // surfaces. It survives intentional UI deletions and acts as their receipt.
  const settled = (session.generatedImageHistory || []).filter((entry) => entry.source === 'chat' && entry.messageId);
  return [...bySource.values()].filter((asset) => !settled.some((entry) => matchesGeneratedAsset(asset, entry)));
}
