// 녹음 관리 훅
import { ref, watch, onMounted } from 'vue';
import { getAllRecords, putRecord, deleteRecord } from '@/utils/idb.js';

// 블롭 -> Data URL (예: data:audio/webm;base64,....)
async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(blob);
  });
}

// B64 -> 블롭
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

  onMounted(async () => {
    try {
      const idbRecs = await getAllRecords();
      if (Array.isArray(idbRecs) && idbRecs.length > 0) {
        idbRecs.forEach(item => {
          let audioBlob = item.audioBlob;
          if (audioBlob && typeof audioBlob === 'string' && audioBlob.startsWith('data:')) {
            audioBlob = b64ToBlob(audioBlob, item.audioType || 'audio/webm');
          }
          records.value.push({
            id: item.id || newId(),
            timestamp: item.timestamp,
            audioBlob: audioBlob,
            filename: item.filename,
            transcription: item.transcription || ''
          });
        });
        console.log('프: ManageRecord - IndexedDB에서 로드 완료. 항목 수:', records.value.length);
        return;
      }

      // No records in IDB: check legacy localStorage and migrate
      const storedRecs = JSON.parse(localStorage.getItem('meetingRecordings') || '[]');
      if (Array.isArray(storedRecs) && storedRecs.length > 0) {
        console.log('프: ManageRecord - localStorage에서 마이그레이션 시작. 항목 수:', storedRecs.length);
        for (const item of storedRecs) {
          if (item.audioBase64 && item.audioType) {
            const blob = b64ToBlob(item.audioBase64, item.audioType);
            if (blob) {
              const rec = {
                id: item.id || newId(),
                timestamp: item.timestamp,
                audioBlob: blob,
                filename: item.filename,
                transcription: item.transcription || ''
              };
              records.value.push(rec);
              try {
                const dataUrl = await blobToDataUrl(blob);
                await putRecord({ ...rec, audioBlob: dataUrl, audioType: item.audioType });
              } catch (e) {
                console.warn('프: ManageRecord - 마이그레이션 중 IDB 저장 실패:', e, rec.id);
              }
            } else {
              console.warn('프: ManageRecord - 마이그레이션: Blob 변환 실패 항목:', item);
            }
          }
        }
  try { localStorage.removeItem('meetingRecordings'); } catch (e) { console.warn('프: ManageRecord - localStorage 제거 실패:', e); }
        console.log('프: ManageRecord - 마이그레이션 완료. IndexedDB에 저장됨.');
      }
    } catch (e) {
      console.error('프: ManageRecord - IndexedDB 로드/마이그레이션 실패:', e);
    }
  });

  watch(records, async (newRecs) => {
    try {
      for (const rec of newRecs) {
        let storeAudio = rec.audioBlob;
        let audioType = null;
        if (rec.audioBlob instanceof Blob) {
          try {
            storeAudio = await blobToDataUrl(rec.audioBlob);
            audioType = rec.audioBlob.type || null;
          } catch (e) {
            console.warn('프: ManageRecord - watch: blob->dataUrl 변환 실패:', e, rec.id);
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

        await putRecord(storeObj);
        console.log(`프: ManageRecord - IndexedDB에 저장/갱신 (ID: ${rec.id})`);
      }
    } catch (e) {
      console.error('프: ManageRecord - IndexedDB 저장 실패:', e);
    }
  }, { deep: true });

  // Debug helpers: expose simple functions to Inspect IndexedDB from browser console
  try {
    // Dump all records from IndexedDB: call in console -> __isu_dumpIdb()
    window.__isu_dumpIdb = async () => {
      try {
        const recs = await getAllRecords();
        console.log('IndexedDB records:', recs);
        return recs;
      } catch (e) {
        console.error('IDB dump failed:', e);
        throw e;
      }
    };

    // Clear all records in IndexedDB: call in console -> __isu_clearIdb()
    window.__isu_clearIdb = async () => {
      try {
        const recs = await getAllRecords();
        for (const r of recs) {
          await deleteRecord(r.id);
        }
        console.log('IndexedDB cleared, removed items:', recs.length);
      } catch (e) {
        console.error('IDB clear failed:', e);
        throw e;
      }
    };
  } catch (e) {
    // window may be undefined in some test environments; ignore in that case
    // eslint-disable-next-line no-console
    console.warn('프: ManageRecord - 디버그 헬퍼 등록 실패 (non-browser environment?):', e);
  }

  function addRec(data) {
    const { audioBlob, filename, transcription } = data;
  console.log('프: ManageRecord - addRec 호출됨. 수신된 전사본:', transcription); // Debug log G
    const timestamp = new Date().toISOString();

    records.value.push({
      id: newId(),
      audioBlob: audioBlob,
      timestamp: timestamp,
      filename: filename || `회의록_${new Date(timestamp).toLocaleString('ko-KR').replace(/[:.]/g, '-')}`,
      transcription: transcription // 변환 텍스트
    });
  console.log('프: ManageRecord - addRec - records.value에 추가됨. 현재 총:', records.value.length); // Debug log H
  }

  function delRec(delId) {
  console.log('프: ManageRecord - delRec 호출됨. ID:', delId);
    records.value = records.value.filter(rec => rec.id !== delId);
  console.log('프: ManageRecord - delRec - 삭제 후 총:', records.value.length);
    // remove from IndexedDB as well
    try {
      deleteRecord(delId).then(() => console.log('프: ManageRecord - IndexedDB에서 삭제 완료:', delId)).catch(e => console.warn('프: ManageRecord - IndexedDB 삭제 실패:', e));
    } catch (e) { console.warn('프: ManageRecord - deleteRecord 호출 실패:', e); }
  }

  function updateRecName({ id, newName }) {
  console.log(`프: ManageRecord - updateRecName 호출됨. ID: ${id}, 새 파일명: ${newName}`);
    records.value = records.value.map(rec => {
      if (rec.id === id) {
        return { ...rec, filename: newName };
      }
      return rec;
    });
  console.log('프: ManageRecord - updateRecName - 업데이트 완료.');
  }

  return {
    records,
    addRec,
    delRec,
    updateRecName
  };
}
