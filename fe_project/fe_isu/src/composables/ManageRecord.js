// 녹음 관리 훅
import { ref, watch, onMounted } from 'vue';

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

  onMounted(() => {
    try {
      const storedRecs = JSON.parse(localStorage.getItem('meetingRecordings') || '[]');
  console.log('프: ManageRecord - 로컬스토리지 로드. 항목 수:', storedRecs.length); // Debug log A
      storedRecs.forEach(item => {
        if (item.audioBase64 && item.audioType) {
          const blob = b64ToBlob(item.audioBase64, item.audioType);
          if (blob) {
            records.value.push({
              id: item.id || newId(),
              timestamp: item.timestamp,
              audioBlob: blob,
              filename: item.filename,
              transcription: item.transcription || ''
            });
            console.log(`프: ManageRecord - 로드된 항목 (ID: ${item.id}), 텍스트: '${item.transcription}'`); // Debug log B
          } else {
            console.warn('프: ManageRecord - Blob 변환 실패 항목:', item);
          }
        } else {
            console.warn('프: ManageRecord - 유효한 audioBase64/audioType 없음:', item);
        }
      });
  console.log('프: ManageRecord - 로드 완료. 현재 records:', records.value.length); // Debug log C
    } catch (e) {
  console.error('프: ManageRecord - 로컬스토리지 로드 실패:', e);
      localStorage.removeItem('meetingRecordings');
    }
  });

  watch(records, async (newRecs) => {
    const serialRecs = [];
    for (const rec of newRecs) {
      const serialRec = {
        id: rec.id,
        timestamp: rec.timestamp,
        filename: rec.filename,
        transcription: rec.transcription // 변환 텍스트
      };

      if (rec.audioBlob instanceof Blob) {
        try {
          // 순차 변환: 에러 발생 시 해당 항목만 실패 처리하여 디버깅이 쉬워집니다.
          serialRec.audioBase64 = await blobToDataUrl(rec.audioBlob);
          serialRec.audioType = rec.audioBlob.type;
        } catch (e) {
          console.warn('프: ManageRecord - audioBlob -> dataUrl 변환 실패:', e, rec.id);
          serialRec.audioBase64 = null;
          serialRec.audioType = null;
        }
      } else {
        console.warn('프: ManageRecord - 직렬화 중 비-Blob audioBlob:', rec.audioBlob);
        serialRec.audioBase64 = null;
        serialRec.audioType = null;
      }

      console.log(`프: ManageRecord - 직렬화될 항목 (ID: ${serialRec.id}), 전사본: '${serialRec.transcription}'`); // Debug log E
      serialRecs.push(serialRec);
    }

    localStorage.setItem('meetingRecordings', JSON.stringify(serialRecs));
    console.log('프: ManageRecord - localStorage에 저장 완료.'); // Debug log F
  }, { deep: true });

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
