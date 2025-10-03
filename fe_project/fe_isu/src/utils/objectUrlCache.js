// object URL 캐시 (Blob -> object URL)
const cache = new Map();

export function getObjectUrl(id, blob) {
  if (!id || !blob) return null;
  if (cache.has(id)) return cache.get(id);
  try {
    const url = URL.createObjectURL(blob);
    cache.set(id, url);
    return url;
  } catch (e) {
    console.warn('getObjectUrl failed', id, e);
    return null;
  }
}

export function revokeObjectUrl(id) {
  const url = cache.get(id);
  if (url) {
    
    try { URL.revokeObjectURL(url); } catch (err) { /* ignore revoke errors */ }
    cache.delete(id);
  }
}

export function revokeAll() { Array.from(cache.keys()).forEach(revokeObjectUrl); }
