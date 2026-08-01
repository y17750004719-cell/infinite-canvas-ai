/**
 * @param {{
 *   targetReferenceId?: string | null,
 *   pinnedVersionId?: string | null,
 *   editBaseAsset?: any,
 *   activeVersions?: any[],
 *   references?: any[],
 * }} input
 */
export function requireOriginalAsset({ targetReferenceId, pinnedVersionId, editBaseAsset, activeVersions = [], references = [] } = {}) {
  const taskAsset = pinnedVersionId
    ? editBaseAsset?.versionId === pinnedVersionId ? editBaseAsset : null
    : activeVersions.find((version) => version?.referenceId === targetReferenceId || version?.versionId === targetReferenceId);
  const runtimeAsset = pinnedVersionId ? null : references.find((reference) => reference?.id === targetReferenceId);
  const asset = taskAsset || runtimeAsset;
  if (!asset?.src) throw new Error('missing_original_asset');
  return asset;
}

export async function invokeWithOriginalAsset(input, invoke) {
  return invoke(requireOriginalAsset(input));
}
