import { ref, watch, onMounted } from 'vue';

// 유틸리티 함수 (인라인)

// -- IndexedDB 관련 --
const DB_NAME = 'isu_recordings_db';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

let cachedDB = null;
let openPromise = null;
// 초기 로드 중에 발생하는 오류는 새로고침 시 불필요한 alert를 띄우지 않도록 제어합니다.
let isInitializing = true;

function openDB() {
  if (cachedDB) return Promise.resolve(cachedDB);
  if (openPromise) return openPromise;

  openPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    req.onsuccess = () => {
      cachedDB = req.result;
      cachedDB.onversionchange = () => {
        cachedDB.close();
        cachedDB = null;
        openPromise = null;
      };
      resolve(cachedDB);
    };
    req.onerror = () => {
      openPromise = null;
      reject(req.error);
    };
  });
  return openPromise; // Return the promise itself
}

async function getAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function put(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function del(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// -- Blob 관련 --
async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64OrDataUrl, fallbackMime) {
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
    // 실패를 조용히 무시하지 않고 프로젝트 로그 형식으로 기록한 뒤 에러를 상위로 전달합니다.
    console.error('프: useRecordings - base64ToBlob 실패:', e);
    throw e;
  }
}


// 새 ID 생성
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// 레거시 localStorage 마이그레이션
async function migrateFromLocalStorage(records) {
  const storedRecs = JSON.parse(localStorage.getItem('meetingRecordings') || '[]');
  if (!Array.isArray(storedRecs) || storedRecs.length === 0) return;

  console.log('프: useRecordings - localStorage 마이그레이션 시작. 항목 수:', storedRecs.length);

  for (const item of storedRecs) {
    if (!item.audioBase64 || !item.audioType) continue;
    const blob = base64ToBlob(item.audioBase64, item.audioType);
    if (!blob) continue;

    const rec = {
      id: item.id || newId(),
      timestamp: item.timestamp,
      audioBlob: blob,
      filename: item.filename,
      transcription: item.transcription || '',
      summary: item.summary || ''
    };
    records.value.push(rec);

    const dataUrl = await blobToDataURL(blob);
    await put({ ...rec, audioBlob: dataUrl, audioType: item.audioType });
  }

  localStorage.removeItem('meetingRecordings');
  console.log('프: useRecordings - 마이그레이션 완료');
}

// 서버에 오디오 업로드
async function uploadAudio(rec) {
  try {
    const form = new FormData();
    form.append('audio', rec.audioBlob, rec.filename || 'recording.webm');
    const resp = await fetch('/api/upload', { method: 'POST', body: form });

    if (!resp.ok) {
      let errMsg = '오디오 업로드에 실패했습니다.';
      try {
        const errJson = await resp.json();
        if (errJson && errJson.message) errMsg = errJson.message;
      } catch (e) {
        // ignore json parse errors
      }
      console.warn('프: useRecordings - upload failed:', resp.status, errMsg);
      if (!isInitializing) window.alert(errMsg + '\n\n잠시 후 다시 시도해 주세요.');
      return null;
    }

    const body = await resp.json();
    rec.audioUrl = body.url;
    rec.audioBlob = null; // Blob 대신 URL 사용
    console.log('프: useRecordings - 업로드 성공. URL:', body.url);
    return body.url;
  } catch (e) {
    console.error('프: useRecordings - uploadAudio 예외:', e);
    if (!isInitializing) window.alert('오디오 업로드 중 네트워크 오류가 발생했습니다. 인터넷 연결을 확인하세요.');
    return null;
  }
}

export function useRecordings({ uploadToServer = true } = {}) {
  const records = ref([]);
  const UP_SRV = uploadToServer;

  onMounted(async () => {
    isInitializing = true;
    try {
      await loadStore();
    } catch (e) {
      console.error('프: useRecordings - loadStore 실패:', e);
      // 초기화 중 에러는 새로고침 시 반복되는 alert를 방지하기 위해 콘솔만 남깁니다.
      if (!isInitializing) {
        window.alert('로컬 저장소를 불러오는 중 오류가 발생했습니다. 일부 기능이 제한될 수 있습니다.');
      }
    } finally {
      isInitializing = false;
    }
  });

  watch(records, async (newRecs) => {
    await saveRecs(newRecs);
  }, { deep: true });

  // IndexedDB에서 레코드 로드
  async function loadStore() {
    const idbRecs = await getAll();
      if (Array.isArray(idbRecs) && idbRecs.length > 0) {
        idbRecs.forEach(item => {
          let audioData = item.audioBlob;
          // b64 문자열이면 Blob으로 변환
          if (typeof audioData === 'string' && audioData.startsWith('data:')) {
            audioData = base64ToBlob(audioData, item.audioType || 'audio/webm');
          }
          
          records.value.push({
            id: item.id || newId(),
            timestamp: item.timestamp,
            audioBlob: (typeof audioData === 'string' && audioData.startsWith('http')) ? null : audioData,
            audioUrl: (typeof audioData === 'string' && audioData.startsWith('http')) ? audioData : null,
            filename: item.filename,
            transcription: item.transcription || '',
            summary: item.summary || ''
          });
        });
        return;
      }
    // IDB에 데이터가 없으면 localStorage에서 마이그레이션 시도
    try {
      await migrateFromLocalStorage(records);
    } catch (e) {
      console.error('프: useRecordings - migrateFromLocalStorage 실패:', e);
      // 마이그레이션 실패는 치명적이지 않으므로 초기화 중에는 alert를 띄우지 않습니다.
      if (!isInitializing) {
        window.alert('기존 녹음 마이그레이션 중 오류가 발생했습니다. 일부 이전 녹음이 보이지 않을 수 있습니다.');
      }
    }
  }

  // 변경된 레코드를 IndexedDB에 저장
  async function saveRecs(newRecs) {
    try {
      for (const rec of newRecs) {
        let storeAudio = rec.audioBlob;
        let audioType = null;

        // 서버 업로드 옵션 활성화 시 Blob 업로드
        if (UP_SRV && rec.audioBlob instanceof Blob && !rec.audioUrl) {
          const uploadedUrl = await uploadAudio(rec);
          if (uploadedUrl) {
            storeAudio = uploadedUrl;
          }
        } else if (rec.audioBlob instanceof Blob) {
          try {
            storeAudio = await blobToDataURL(rec.audioBlob);
          } catch (e) {
            console.error('프: useRecordings - blobToDataURL 실패:', e);
            storeAudio = null;
          }
          audioType = rec.audioBlob.type || null;
        }

        const storeObj = {
          id: rec.id,
          timestamp: rec.timestamp,
          filename: rec.filename,
          transcription: rec.transcription,
          summary: rec.summary,
          audioBlob: storeAudio,
          audioType
        };
        try {
          await put(storeObj);
        } catch (e) {
          console.error('프: useRecordings - IndexedDB put 실패:', e, storeObj.id);
        }
      }
    } catch (e) {
      console.error('프: useRecordings - saveRecs 예외:', e);
      if (!isInitializing) {
        window.alert('녹음 저장 중 오류가 발생했습니다. 변경 사항이 저장되지 않을 수 있습니다.');
      }
    }
    
  }

  // 새 녹음 추가
  function addRec(data) {
    const { audioBlob, filename, transcription } = data;
    const timestamp = new Date().toISOString();
    const recObj = {
      id: newId(),
      audioBlob,
      audioUrl: null,
      timestamp,
      filename: filename || `회의록_${new Date(timestamp).toLocaleString('ko-KR').replace(/[:.]/g, '-')}`,
      transcription,
      summary: ''
    };
    records.value.push(recObj);
  }

  // 녹음 삭제
  function delRec(id) {
    records.value = records.value.filter(r => r.id !== id);
    del(id);
  }

  // 녹음 파일명 변경
  function updateRecName({ id, newName }) {
    records.value = records.value.map(r =>
      r.id === id ? { ...r, filename: newName } : r
    );
  }

  // 요약 저장/업데이트
  function updateRecSummary({ id, summary }) {
    records.value = records.value.map(r => r.id === id ? { ...r, summary } : r);
  }

  return { records, addRec, delRec, updateRecName, updateRecSummary };
}