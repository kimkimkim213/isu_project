// 녹음 관리 훅
import { ref, watch, onMounted } from 'vue';
import { getAll, put, del } from '@/utils/idb.js';

// Blob -> Data URL 변환 (예: data:audio/webm;base64,...)
async function blobToDataUrl(blob) {
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
  const UPLOAD_TO_SERVER = true;

  onMounted(async () => {
    try {
  const idbRecs = await getAll();
      if (Array.isArray(idbRecs) && idbRecs.length > 0) {
        idbRecs.forEach(item => {
          // item.audioBlob: dataURL 문자열, 또는 서버 URL(http 시작), 또는 null
          let audioBlobOrUrl = item.audioBlob;
          if (typeof audioBlobOrUrl === 'string' && audioBlobOrUrl.startsWith('data:')) {
            audioBlobOrUrl = b64ToBlob(audioBlobOrUrl, item.audioType || 'audio/webm');
          }
          // 서버 URL이면 audioUrl로 사용
          records.value.push({
            id: item.id || newId(),
            timestamp: item.timestamp,
            audioBlob: (typeof audioBlobOrUrl === 'string' && audioBlobOrUrl.startsWith('http')) ? null : audioBlobOrUrl,
            audioUrl: (typeof audioBlobOrUrl === 'string' && audioBlobOrUrl.startsWith('http')) ? audioBlobOrUrl : null,
            filename: item.filename,
            transcription: item.transcription || ''
          });
        });
        console.log('프: ManageRecord - IndexedDB에서 로드 완료. 항목 수:', records.value.length);
        return;
      }

      // IDB에 기록 없으면 legacy localStorage 확인 후 마이그레이션
      const storedRecs = JSON.parse(localStorage.getItem('meetingRecordings') || '[]');
      if (Array.isArray(storedRecs) && storedRecs.length > 0) {
  console.log('프: ManageRecord - localStorage에서 마이그레이션 시작. 수:', storedRecs.length);
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
                await put({ ...rec, audioBlob: dataUrl, audioType: item.audioType });
              } catch (e) {
                console.warn('프: ManageRecord - 마이그레이션 IDB 저장 실패:', e, rec.id);
              }
            } else {
              console.warn('프: ManageRecord - 마이그레이션: Blob 변환 실패 항목:', item);
            }
          }
        }
  try { localStorage.removeItem('meetingRecordings'); } catch (e) { console.warn('프: ManageRecord - localStorage 제거 실패:', e); }
  console.log('프: ManageRecord - 마이그레이션 완료. IndexedDB 저장');
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

          // 서버 업로드가 켜져 있고 Blob이면서 audioUrl 없으면 업로드
        if (UPLOAD_TO_SERVER && rec.audioBlob instanceof Blob && !rec.audioUrl) {
          try {
            const form = new FormData();
            form.append('audio', rec.audioBlob, rec.filename || 'recording.webm');
            const resp = await fetch('/api/upload', { method: 'POST', body: form });
            if (resp.ok) {
              const body = await resp.json();
              // 반환된 URL 저장, 로컬 Blob 제거
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
            storeAudio = await blobToDataUrl(rec.audioBlob);
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
  
  console.log(`프: ManageRecord - IndexedDB 저장/갱신 ID: ${rec.id}`);
      }
    } catch (e) {
      console.error('프: ManageRecord - IndexedDB 저장 실패:', e);
    }
  }, { deep: true });

  // 디버그 헬퍼: 브라우저 콘솔에서 IDB 검사/제거용
  try {
  // IndexedDB 모든 레코드 출력: 콘솔에서 __isu_dumpIdb() 호출
  window.__isu_dumpIdb = async () => {
      try {
        const recs = await getAll();
  console.log('IndexedDB 레코드:', recs);
        return recs;
      } catch (e) {
        console.error('IDB dump failed:', e);
        throw e;
      }
    };

  // IndexedDB 모든 레코드 삭제: 콘솔에서 __isu_clearIdb() 호출
  window.__isu_clearIdb = async () => {
      try {
        const recs = await getAll();
        for (const r of recs) {
          await del(r.id);
        }
  console.log('IndexedDB 삭제 완료. 제거 수:', recs.length);
      } catch (e) {
        console.error('IDB clear failed:', e);
        throw e;
      }
    };
  } catch (e) {
  // 일부 환경(window 없음)에서는 무시
  // eslint-disable-next-line no-console
  console.warn('프: ManageRecord - 디버그 헬퍼 등록 실패:', e);
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
