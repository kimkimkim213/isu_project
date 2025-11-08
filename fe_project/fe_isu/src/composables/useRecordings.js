import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { blobToDataURL, base64ToBlob } from '@/utils/audio';
import { getAll, put, del } from '@/utils/idb';


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
  console.log('프: useRecordings - 전송 완료');
}

// 서버에 오디오 업로드
async function uploadAudio(rec) {
  const form = new FormData();
  form.append('audio', rec.audioBlob, rec.filename || 'recording.webm');
  const resp = await fetch('/api/upload', { method: 'POST', body: form });

  if (resp.ok) {
    const body = await resp.json();
    rec.audioUrl = body.url;
    rec.audioBlob = null; // Blob 대신 URL 사용
  console.log('프: useRecordings - 업로드 성공. URL:', body.url);
    return body.url;
  }
  return null;
}

export function useRecordings({ uploadToServer = true } = {}) {
  const records = ref([]);
  const UP_SRV = uploadToServer;
  let saveTimeout = null;
  let saving = false;

  onMounted(async () => {
    await loadStore();
  });

  // Debounce saves to avoid frequent IDB writes / uploads during rapid state changes
  watch(records, (newRecs) => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      // avoid overlapping saves
      if (saving) return;
      saveRecs(newRecs).catch((e) => console.warn('프: useRecordings - saveRecs 오류', e));
    }, 500);
  }, { deep: true });

  onBeforeUnmount(() => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
  });

  // prepare audio data for storing (tries upload when enabled, otherwise converts Blob->dataURL)
  const prepareStoreAudio = async (rec) => {
    let storeAudio = rec.audioBlob;
    let audioType = null;

    if (UP_SRV && rec.audioBlob instanceof Blob && !rec.audioUrl) {
      try {
        const uploadedUrl = await uploadAudio(rec);
        if (uploadedUrl) storeAudio = uploadedUrl;
      } catch (e) {
        console.warn('프: useRecordings - uploadAudio 실패', e?.message || e);
      }
    }

    if (storeAudio instanceof Blob) {
      try {
        storeAudio = await blobToDataURL(storeAudio);
        audioType = rec.audioBlob?.type || null;
      } catch (e) {
        console.warn('프: useRecordings - blobToDataURL 실패', e?.message || e);
        storeAudio = null;
      }
    }

    return { storeAudio, audioType };
  };

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
    // IDB에 데이터가 없으면 로컬에서 수신
    await migrateFromLocalStorage(records);
  }

  // 변경된 레코드를 IndexedDB에 저장
  async function saveRecs(newRecs) {
    if (saving) return;
    saving = true;
    try {
      for (const rec of newRecs) {
        const { storeAudio, audioType } = await prepareStoreAudio(rec);
        const storeObj = {
          id: rec.id,
          timestamp: rec.timestamp,
          filename: rec.filename,
          transcription: rec.transcription,
          summary: rec.summary,
          audioBlob: storeAudio,
          audioType
        };
        await put(storeObj);
      }
    } finally { saving = false; }
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