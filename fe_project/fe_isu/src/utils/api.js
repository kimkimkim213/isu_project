// API 호출 관련 유틸리티 함수

// Guard `process` access so this file won't throw in browsers where `process` is undefined
export const API_BASE = (typeof process !== 'undefined' && process && process.env && process.env.VUE_APP_API_BASE)
  ? process.env.VUE_APP_API_BASE
  : '';

export function apiUrl(path) {
  if (!path) return API_BASE;
  if (API_BASE) return API_BASE.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path.replace(/^\/+/, ''));
  return path;
}

export async function postJSON(path, body, opts = {}) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
    ...opts,
  });
  return res;
}

// API 호출시 시간이 너무 지나면 요청 취소
export const DEFAULT_TIMEOUT = 20000; // 20초

export async function fetchTimeout(url, opts = {}, timeout = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}
