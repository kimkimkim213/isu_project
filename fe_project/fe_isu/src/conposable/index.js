// 오디오 미터·녹음 메타·유틸 통합 composable
import { ref, onMounted, onUnmounted } from 'vue';

// --------------------- 유틸 ---------------------
export async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// fetch 타임아웃 헬퍼
// 기본 타임아웃 상수
export const DEFAULT_FETCH_TIMEOUT = 20000;

export async function fetchWithTimeout(url, opts = {}, timeout = DEFAULT_FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export function base64ToBlob(base64, fallbackMime) {
  if (typeof base64 !== 'string') return null;
  const parts = base64.split(';base64,');
  if (parts.length < 2) return null;
  const mime = (parts[0].split(':')[1]) || fallbackMime || 'application/octet-stream';
  const bin = atob(parts[1]);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// --------------------- 볼륨 미터 ---------------------
const shared = { ctx: null, analyser: null, data: null, src: null, raf: null };
export function useAudioMeter() {
  const volume = ref(0);

  function start(stream) {
    if (!stream) return;
    try {
      if (!shared.ctx) shared.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (shared.src) try { shared.src.disconnect(); } catch (err) { /* ignore */ }
      shared.src = shared.ctx.createMediaStreamSource(stream);
      shared.analyser = shared.ctx.createAnalyser();
      shared.analyser.fftSize = 256;
      shared.data = new Uint8Array(shared.analyser.frequencyBinCount);
      shared.src.connect(shared.analyser);

      const loop = () => {
        try {
          shared.analyser.getByteFrequencyData(shared.data);
          let sum = 0;
          for (let i = 0; i < shared.data.length; i++) sum += shared.data[i];
          const avg = sum / shared.data.length;
          volume.value = Math.min(100, Math.round((avg / 255) * 100));
        } catch (e) {
          volume.value = 0;
        }
        shared.raf = requestAnimationFrame(loop);
      };

      loop();
    } catch (e) {
      console.error('useAudioMeter.start', e);
    }
  }

  function stop() {
    try {
      if (shared.raf) { cancelAnimationFrame(shared.raf); shared.raf = null; }
      if (shared.src) try { shared.src.disconnect(); } catch (err) { /* ignore */ } finally { shared.src = null; }
      volume.value = 0;
    } catch (e) {
      console.error('useAudioMeter.stop', e);
    }
  }

  return { volume, start, stop, getSampleRate: () => (shared.ctx ? shared.ctx.sampleRate : null) };
}

// --------------------- recordings ---------------------
export const RECORDINGS_STORAGE_KEY = 'meetingRecordings';

function gid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

export function useRecs() {
  const recordings = ref([]);
  // 저장 타이머 제거, 변경 시 즉시 저장
  onMounted(async () => {
    try {
      const meta = getMeta();
      for (const item of meta) recordings.value.push({ id: item.id || gid(), timestamp: item.timestamp, audioBlob: null, filename: item.filename, transcription: item.transcription || '' });
    } catch (e) {
      localStorage.removeItem(RECORDINGS_STORAGE_KEY);
    }
  });

  // watch+debounce 제거, 즉시 저장
  onUnmounted(() => {});

  // 메타를 localStorage에 저장
  function saveMeta(recs) {
    const meta = recs.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      filename: r.filename,
      transcription: r.transcription || ''
    }));
    localStorage.setItem(RECORDINGS_STORAGE_KEY, JSON.stringify(meta));
  }

  // localStorage에서 메타 안전히 읽음
  function getMeta() {
    try {
      return JSON.parse(localStorage.getItem(RECORDINGS_STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function addRecording({ audioBlob, filename, transcription }) {
    const id = gid();
    const timestamp = new Date().toISOString();
    recordings.value.push({
      id,
      audioBlob,
      timestamp,
      filename: filename || `recording-${timestamp}`,
      transcription
    });
    try { saveMeta(recordings.value); } catch (e) { console.error('ManageRecord: save failed', e); }
  }
  function deleteRecording(id) {
    recordings.value = recordings.value.filter(r => r.id !== id);
    try { saveMeta(recordings.value); } catch (e) { console.error('ManageRecord: save failed', e); }
  }
  function renameRecording({ id, newFilename }) { recordings.value = recordings.value.map(r => r.id === id ? { ...r, filename: newFilename } : r); try { saveMeta(recordings.value); } catch (e) { console.error('ManageRecord: save failed', e); } }
  // 하위호환별칭
  const updateRecordingFilename = renameRecording;
  return { recordings, addRecording, deleteRecording, renameRecording, updateRecordingFilename };
}

// 명명된 내보내기 사용, 기본 export 없음
// 통합 composable 파일
