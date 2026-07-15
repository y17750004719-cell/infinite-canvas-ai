function appendCacheBust(src) {
  if (/^(?:data:|blob:)/i.test(src)) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}agent_retry=1`;
}

function defaultLoadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve({
      naturalWidth: image.naturalWidth || image.width,
      naturalHeight: image.naturalHeight || image.height,
    });
    image.onerror = () => reject(new Error(`Failed to preload generated asset: ${src}`));
    image.src = src;
  });
}

function loadWithTimeout(loadImage, src, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Generated asset preload timed out after ${timeoutMs}ms: ${src}`)),
      timeoutMs,
    );
    Promise.resolve()
      .then(() => loadImage(src))
      .then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

export async function preloadGeneratedAsset(asset, options = {}) {
  const loadImage = options.loadImage || defaultLoadImage;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 15_000;
  let result;
  try {
    result = await loadWithTimeout(loadImage, asset.src, timeoutMs);
  } catch {
    result = await loadWithTimeout(loadImage, appendCacheBust(asset.src), timeoutMs);
  }
  return {
    asset,
    naturalWidth: asset.naturalWidth || result?.naturalWidth || 1,
    naturalHeight: asset.naturalHeight || result?.naturalHeight || 1,
  };
}

export async function preloadGeneratedAssets(assets, options = {}) {
  const settled = await Promise.allSettled(
    assets.map((asset) => preloadGeneratedAsset(asset, options)),
  );
  return settled.reduce((result, entry, index) => {
    if (entry.status === 'fulfilled') result.fulfilled.push(entry.value);
    else result.failed.push({ asset: assets[index], error: entry.reason });
    return result;
  }, { fulfilled: [], failed: [] });
}
