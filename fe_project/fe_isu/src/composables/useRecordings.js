import { ref, watch, onMounted } from 'vue';
import { getAll, put, del, base64ToBlob } from '@/utils';

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

    try {
      // Blob을 그대로 IndexedDB에 저장하도록 변경 (dataURL 변환 제거)
      await put({ ...rec, audioBlob: blob, audioType: item.audioType });
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

// 서버에 오디오 업로드 (부수효과 없이 blob과 filename만 받아 URL 반환)
async function uploadAudio(blob, filename) {
  try {
    const form = new FormData();
    form.append('audio', blob, filename || 'recording.webm');
    const resp = await fetch('/api/upload', { method: 'POST', body: form });

    if (resp && resp.ok) {
      const body = await resp.json();
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
  // 로드/동기화 중 watch로 인한 불필요한 저장을 일시중단하기 위한 플래그
  let suspendSave = false;
  const UP_SRV = uploadToServer;

  onMounted(async () => {
    // 데이터 로드 중에 자동 저장을 중단
    suspendSave = true;
    await loadStore();
    suspendSave = false;
  });

  watch(records, async (newRecs) => {
    if (suspendSave) return;
    // 저장 중 중첩 호출 방지
    suspendSave = true;
    try {
      await saveRecs(newRecs);
    } finally {
      suspendSave = false;
    }
  }, { deep: true });

  // IndexedDB에서 레코드 로드
  async function loadStore() {
    try {
      const idbRecs = await getAll();
      if (Array.isArray(idbRecs) && idbRecs.length > 0) {
        // 한 번에 매핑하여 records에 할당 (여러번 push로 인한 중복 저장 방지)
        const mapped = idbRecs.map(item => {
          let audioData = item.audioBlob;
          // data: URL이면 Blob으로 변환
          if (typeof audioData === 'string' && audioData.startsWith('data:')) {
            audioData = base64ToBlob(audioData, item.audioType || 'audio/webm');
          }

          return {
            id: item.id || newId(),
            timestamp: item.timestamp,
            audioBlob: (typeof audioData === 'string' && audioData.startsWith('http')) ? null : audioData,
            audioUrl: (typeof audioData === 'string' && audioData.startsWith('http')) ? audioData : null,
            filename: item.filename,
            transcription: item.transcription || '',
            summary: item.summary || ''
          };
        });

        records.value = mapped;
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
      const puts = [];
      for (const rec of newRecs) {
        let storeAudio = rec.audioBlob;
        let audioType = null;

        // 서버 업로드 옵션 활성화 시 Blob 업로드
        if (UP_SRV && rec.audioBlob instanceof Blob && !rec.audioUrl) {
          const uploadedUrl = await uploadAudio(rec.audioBlob, rec.filename);
          if (uploadedUrl) {
            storeAudio = uploadedUrl;
            // 로컬 상태도 갱신하되, watch가 suspend 되어있으면 무한루프 방지
            rec.audioUrl = uploadedUrl;
            rec.audioBlob = null;
          }
        } else if (rec.audioBlob instanceof Blob) {
          // Blob을 그대로 저장하도록 변경
          storeAudio = rec.audioBlob;
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
        puts.push(put(storeObj));
      }
      await Promise.all(puts);
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
      transcription,
      summary: ''
    };
    records.value.push(recObj);
  }

  // 녹음 삭제
  async function delRec(id) {
    records.value = records.value.filter(r => r.id !== id);
    try {
      await del(id);
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

  // 요약 저장/업데이트
  function updateRecSummary({ id, summary }) {
    records.value = records.value.map(r => r.id === id ? { ...r, summary } : r);
  }

  return { records, addRec, delRec, updateRecName, updateRecSummary };
}

// 이전 버전과의 호환성을 위해 useRecord로도 export
export { useRecordings as useRecord };