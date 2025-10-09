// Blob 및 Base64 변환 관련 유틸리티 함수

export async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function blobToB64(blob) {
  const dataUrl = await blobToDataURL(blob);
  return (typeof dataUrl === 'string' && dataUrl.includes(',')) ? dataUrl.split(',')[1] : dataUrl;
}

export function base64ToBlob(base64OrDataUrl, fallbackMime) {
  if (typeof base64OrDataUrl !== 'string') return null;

  if (base64OrDataUrl.includes(';base64,')) {
    const parts = base64OrDataUrl.split(';base64,');
    const mime = (parts[0].split(':')[1]) || fallbackMime || 'application/octet-stream';
    const bin = atob(parts[1]);
    const len = bin.length;
    const arr = new Uint8Array(len);
    
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  try {
    const bin = atob(base64OrDataUrl);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: fallbackMime || 'application/octet-stream' });
  } catch (e) {
    console.warn('base64ToBlob failed', e);
    return null;
  }
}
