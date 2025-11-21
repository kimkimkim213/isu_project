// Object URL 캐시 관련 유틸리티 함수

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
    try { URL.revokeObjectURL(url); }
    catch (err) { console.warn('', id, err); }
    cache.delete(id);
  }
}

export function revokeAll() { Array.from(cache.keys()).forEach(revokeObjectUrl); }
