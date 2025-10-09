import { ref, watch, onMounted } from 'vue';
import { getAll, put, del, base64ToBlob, blobToDataURL } from '@/utils';

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
      transcription: item.transcription || ''
    };
    records.value.push(rec);

    try {
      const dataUrl = await blobToDataURL(blob);
      await put({ ...rec, audioBlob: dataUrl, audioType: item.audioType });
    } catch (e) {
      console.warn('프: useRecordings - 마이그레이션 중 IDB 저장 실패', e);
    }
  }

  try {
    localStorage.removeItem('meetingRecordings');
  } catch (e) {
    console.warn('프: useRecordings - localStorage 제거 실패', e);
  }
  console.log('프: useRecordings - 마이그레이션 완료');
}

// 서버에 오디오 업로드
async function uploadAudio(rec) {
  try {
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
  } catch (e) {
    console.warn('프: useRecordings - 업로드 오류', e);
  }
  return null;
}

export function useRecordings({ uploadToServer = true } = {}) {
  const records = ref([]);
  const UP_SRV = uploadToServer;

  onMounted(async () => {
    await loadStore();
  });

  watch(records, async (newRecs) => {
    await saveRecs(newRecs);
  }, { deep: true });

  // IndexedDB에서 레코드 로드
  async function loadStore() {
    try {
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
            transcription: item.transcription || ''
          });
        });
        return;
      }
      // IDB에 데이터가 없으면 localStorage에서 마이그레이션 시도
      await migrateFromLocalStorage(records);
    } catch (e) {
      console.error('프: useRecordings - loadStore 실패', e);
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
            audioType = rec.audioBlob.type || null;
          } catch (e) {
            storeAudio = null;
          }
        }

        const storeObj = {
          id: rec.id,
          timestamp: rec.timestamp,
          filename: rec.filename,
          transcription: rec.transcription,
          audioBlob: storeAudio,
          audioType
        };
        await put(storeObj);
      }
    } catch (e) {
      console.error('프: useRecordings - saveRecs 실패', e);
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
      transcription
    };
    records.value.push(recObj);
  }

  // 녹음 삭제
  function delRec(id) {
    records.value = records.value.filter(r => r.id !== id);
    try {
      del(id).catch(() => {});
    } catch (e) {
      console.warn('프: useRecordings - del 실패', e);
    }
  }

  // 녹음 파일명 변경
  function updateRecName({ id, newName }) {
    records.value = records.value.map(r =>
      r.id === id ? { ...r, filename: newName } : r
    );
  }

  return { records, addRec, delRec, updateRecName };
}

// 이전 버전과의 호환성을 위해 useRecord로도 export
export { useRecordings as useRecord };

export default { useRecordings };