// 녹음 관리 훅
import { ref, watch, onMounted } from 'vue';
import { getAll, put, del } from '@/utils/idb.js';

// Blob -> dataURL 변환 (예: data:audio/webm;base64,...)
async function blobToUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(blob);
  });
}

// base64 -> Blob 변환
function b64ToBlob(b64, mimeType) {
  if (!b64 || typeof b64 !== 'string') {
    console.error('잘못된 b64 문자열:', b64);
    return null;
  }
  const parts = b64.split(';base64,');
  if (parts.length < 2) {
      console.error('B64 문자열 형식 오류:', b64);
      return null;
  }
  const contentType = parts[0].split(':')[1] || mimeType;
  try {
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  } catch (e) {
    console.error('b64 디코딩 오류:', e, b64);
    return null;
  }
}

// 새 ID 생성
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function useRecord() {
  const records = ref([]);
  // 환경: 서버 업로드 여부 (true면 서버에 저장하고 URL 사용)
  const UP_SRV = true;

  onMounted(async () => {
    // 초기 로드 및 레거시 마이그레이션 수행
    await loadStore();
  });

  watch(records, async (newRecs) => {
    // 변경된 레코드들을 저장
    await saveRecs(newRecs);
  }, { deep: true });

  // 디버그 헬퍼: 브라우저 콘솔에서 IDB 검사/제거용
  try {
  // IndexedDB 헬퍼: 콘솔에서 호출해 검사/삭제 가능
  window.__isu_dumpIdb = async () => {
      try {
        const recs = await getAll();
  console.log('IndexedDB 레코드:', recs);
        return recs;
      } catch (e) {
        console.error('프: ManageRecord - IDB 덤프 실패:', e);
        throw e;
      }
    };

  window.__isu_clearIdb = async () => {
      try {
        const recs = await getAll();
        for (const r of recs) {
          await del(r.id);
        }
  console.log('IndexedDB 삭제 완료. 제거 수:', recs.length);
      } catch (e) {
        console.error('프: ManageRecord - IDB 삭제 실패:', e);
        throw e;
      }
    };
  } catch (e) {
  // 일부 환경(window 없음)에서는 무시
  // eslint-disable-next-line no-console
  console.warn('프: ManageRecord - 디버그 헬퍼 등록 실패:', e);
  }

  // -------------------- 헬퍼 함수들 (로직 단순화 목적) --------------------

  // IDB에서 로드하거나 legacy localStorage에서 마이그레이션 수행
  async function loadStore() {
    try {
      const idbRecs = await getAll();
      if (Array.isArray(idbRecs) && idbRecs.length > 0) {
        idbRecs.forEach(item => {
          let audioBlobOrUrl = item.audioBlob;
          if (typeof audioBlobOrUrl === 'string' && audioBlobOrUrl.startsWith('data:')) {
            audioBlobOrUrl = b64ToBlob(audioBlobOrUrl, item.audioType || 'audio/webm');
          }
          records.value.push({
            id: item.id || newId(),
            timestamp: item.timestamp,
            audioBlob: (typeof audioBlobOrUrl === 'string' && audioBlobOrUrl.startsWith('http')) ? null : audioBlobOrUrl,
            audioUrl: (typeof audioBlobOrUrl === 'string' && audioBlobOrUrl.startsWith('http')) ? audioBlobOrUrl : null,
            filename: item.filename,
            transcription: item.transcription || ''
          });
        });
        console.log('프: ManageRecord - IndexedDB 로드. 항목 수:', records.value.length);
        return;
      }

      // 레거시 localStorage 마이그레이션
      const storedRecs = JSON.parse(localStorage.getItem('meetingRecordings') || '[]');
      if (!Array.isArray(storedRecs) || storedRecs.length === 0) return;
  console.log('프: ManageRecord - localStorage 마이그레이션 시작. 수:', storedRecs.length);
      for (const item of storedRecs) {
        if (!item.audioBase64 || !item.audioType) continue;
        const blob = b64ToBlob(item.audioBase64, item.audioType);
        if (!blob) {
          console.warn('프: ManageRecord - 마이그레이션: Blob 변환 실패 항목:', item);
          continue;
        }
        const rec = {
          id: item.id || newId(),
          timestamp: item.timestamp,
          audioBlob: blob,
          filename: item.filename,
          transcription: item.transcription || ''
        };
        records.value.push(rec);
        try {
          const dataUrl = await blobToUrl(blob);
          await put({ ...rec, audioBlob: dataUrl, audioType: item.audioType });
        } catch (e) {
          console.warn('프: ManageRecord - 마이그레이션 IDB 저장 실패:', e, rec.id);
        }
      }
      try { localStorage.removeItem('meetingRecordings'); } catch (e) { console.warn('프: ManageRecord - localStorage 제거 실패:', e); }
      console.log('프: ManageRecord - 마이그레이션 완료');
    } catch (e) {
      console.error('프: ManageRecord - IndexedDB 로드/마이그레이션 실패:', e);
    }
  }

  // 레코드 배열을 IndexedDB에 저장(업로드 포함)
  async function saveRecs(newRecs) {
    try {
      for (const rec of newRecs) {
        let storeAudio = rec.audioBlob;
        let audioType = null;

        if (UP_SRV && rec.audioBlob instanceof Blob && !rec.audioUrl) {
          try {
            const form = new FormData();
            form.append('audio', rec.audioBlob, rec.filename || 'recording.webm');
            const resp = await fetch('/api/upload', { method: 'POST', body: form });
            if (resp.ok) {
              const body = await resp.json();
              storeAudio = body.url;
              audioType = null;
              rec.audioUrl = body.url;
              rec.audioBlob = null;
              console.log('프: ManageRecord - 업로드 성공. URL:', body.url);
            } else {
              console.warn('프: ManageRecord - 업로드 실패. 상태:', resp.status);
            }
          } catch (e) {
            console.warn('프: ManageRecord - 업로드 오류:', e);
          }
        } else if (rec.audioBlob instanceof Blob) {
          try {
            storeAudio = await blobToUrl(rec.audioBlob);
            audioType = rec.audioBlob.type || null;
          } catch (e) {
            console.warn('프: ManageRecord - blob->dataUrl 변환 실패:', e, rec.id);
            storeAudio = null;
          }
        }

        const storeObj = {
          id: rec.id,
          timestamp: rec.timestamp,
          filename: rec.filename,
          transcription: rec.transcription,
          audioBlob: storeAudio,
          audioType: audioType
        };

        await put(storeObj);
        console.log(`프: ManageRecord - IDB 저장: ${rec.id}`);
      }
    } catch (e) {
      console.error('프: ManageRecord - IndexedDB 저장 실패:', e);
    }
  }


  function addRec(data) {
    const { audioBlob, filename, transcription } = data;
  console.log('프: ManageRecord - addRec 호출. 전사:', transcription);
    const timestamp = new Date().toISOString();

    const recObj = {
      id: newId(),
      audioBlob: audioBlob,
      audioUrl: null,
      timestamp: timestamp,
      filename: filename || `회의록_${new Date(timestamp).toLocaleString('ko-KR').replace(/[:.]/g, '-')}`,
      transcription: transcription // 변환 텍스트
    };

    records.value.push(recObj);
  console.log('프: ManageRecord - 추가됨. 총:', records.value.length);
  }

  function delRec(delId) {
  console.log('프: ManageRecord - delRec 호출. ID:', delId);
    records.value = records.value.filter(rec => rec.id !== delId);
  console.log('프: ManageRecord - 삭제 후 총:', records.value.length);
    // remove from IndexedDB as well
    try {
      del(delId).then(() => console.log('프: ManageRecord - IndexedDB 삭제 완료:', delId)).catch(e => console.warn('프: ManageRecord - IndexedDB 삭제 실패:', e));
    } catch (e) { console.warn('프: ManageRecord - del 실패:', e); }
  }

  function updateRecName({ id, newName }) {
  console.log(`프: ManageRecord - updateRecName 호출. ID: ${id}, 새명: ${newName}`);
    records.value = records.value.map(rec => {
      if (rec.id === id) {
        return { ...rec, filename: newName };
      }
      return rec;
    });
  console.log('프: ManageRecord - 파일명 업데이트 완료.');
  }

  return {
    records,
    addRec,
    delRec,
    updateRecName
  };
}
