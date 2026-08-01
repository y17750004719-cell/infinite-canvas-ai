function appendCacheBust(src) {
  if (/^(?:data:|blob:)/i.test(src)) return src;
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}agent_retry=1`;
}

function createAbortError() {
  const error = new Error('Generated asset preload aborted');
  error.name = 'AbortError';
  return error;
}

function defaultLoadImage(src, signal) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    const cleanup = () => signal?.removeEventListener('abort', handleAbort);
    const handleAbort = () => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      cleanup();
      reject(createAbortError());
    };
    image.onload = () => {
      cleanup();
      resolve({
        naturalWidth: image.naturalWidth || image.width,
        naturalHeight: image.naturalHeight || image.height,
      });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`Failed to preload generated asset: ${src}`));
    };
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    signal?.addEventListener('abort', handleAbort, { once: true });
    image.src = src;
  });
}

function loadWithTimeout(loadImage, src, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', handleAbort);
        reject(new Error(`Generated asset preload timed out after ${timeoutMs}ms: ${src}`));
      },
      timeoutMs,
    );
    const handleAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
    Promise.resolve()
      .then(() => loadImage(src, signal))
      .then(
        (result) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', handleAbort);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', handleAbort);
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
  const signal = options.signal;
  let result;
  try {
    result = await loadWithTimeout(loadImage, asset.src, timeoutMs, signal);
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    result = await loadWithTimeout(loadImage, appendCacheBust(asset.src), timeoutMs, signal);
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
