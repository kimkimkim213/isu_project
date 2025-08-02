// src/composables/ManageRecord.js
import { ref, watch, onMounted } from 'vue';

// Blob 데이터를 Base64 문자열로 인코딩하는 헬퍼 함수
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Base64 문자열을 Blob 데이터로 디코딩하는 헬퍼 함수
function base64ToBlob(base64, mimeType) {
  if (!base64 || typeof base64 !== 'string') {
    console.error('Invalid base64 string provided to base64ToBlob:', base64);
    return null;
  }
  const parts = base64.split(';base64,');
  if (parts.length < 2) {
      console.error('Base64 string format is incorrect:', base64);
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
    console.error('Error decoding base64 to blob:', e, base64);
    return null;
  }
}

// 고유 ID를 생성하는 헬퍼 함수
function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function useRecordings() {
  const recordings = ref([]);

  onMounted(() => {
    try {
      const storedRecordings = JSON.parse(localStorage.getItem('meetingRecordings') || '[]');
      console.log('ManageRecord: onMounted - 로컬 스토리지에서 로드 시작. 저장된 항목 수:', storedRecordings.length); // Debug log A
      storedRecordings.forEach(item => {
        if (item.audioBase64 && item.audioType) {
          const blob = base64ToBlob(item.audioBase64, item.audioType);
          if (blob) {
            recordings.value.push({
              id: item.id || generateUniqueId(),
              timestamp: item.timestamp,
              audioBlob: blob,
              filename: item.filename,
              transcription: item.transcription || ''
            });
            console.log(`ManageRecord: onMounted - 로드된 항목 (ID: ${item.id}), 전사본: '${item.transcription}'`); // Debug log B
          } else {
            console.warn('ManageRecord: onMounted - Blob 변환 실패 항목:', item);
          }
        } else {
            console.warn('ManageRecord: onMounted - 유효한 audioBase64/audioType 없는 항목:', item);
        }
      });
      console.log('ManageRecord: onMounted - 로드 완료. 현재 recordings.value.length:', recordings.value.length); // Debug log C
    } catch (e) {
      console.error('ManageRecord: onMounted - 로컬 스토리지 로드 실패:', e);
      localStorage.removeItem('meetingRecordings');
    }
  });

  watch(recordings, async (newRecordings) => {
    const serializableRecordings = await Promise.all(newRecordings.map(async rec => {
      const serializableRec = {
        id: rec.id,
        timestamp: rec.timestamp,
        filename: rec.filename,
        transcription: rec.transcription // 텍스트 변환 결과 저장
      };
      if (rec.audioBlob instanceof Blob) {
        serializableRec.audioBase64 = await blobToBase64(rec.audioBlob);
        serializableRec.audioType = rec.audioBlob.type;
      } else {
        console.warn('ManageRecord: watch - 직렬화 중 비-Blob audioBlob:', rec.audioBlob);
        serializableRec.audioBase64 = null;
        serializableRec.audioType = null;
      }
      console.log(`ManageRecord: watch - 직렬화될 항목 (ID: ${serializableRec.id}), 전사본: '${serializableRec.transcription}'`); // Debug log E
      return serializableRec;
    }));
    localStorage.setItem('meetingRecordings', JSON.stringify(serializableRecordings));
    console.log('ManageRecord: watch - localStorage에 저장 완료.'); // Debug log F
  }, { deep: true });

  function addRecording(data) {
    const { audioBlob, filename, transcription } = data;
    console.log('ManageRecord: addRecording 호출됨. 수신된 전사본:', transcription); // Debug log G
    const timestamp = new Date().toISOString();

    recordings.value.push({
      id: generateUniqueId(),
      audioBlob: audioBlob,
      timestamp: timestamp,
      filename: filename || `회의록_${new Date(timestamp).toLocaleString('ko-KR').replace(/[:.]/g, '-')}`,
      transcription: transcription // 텍스트 변환 결과 저장
    });
    console.log('ManageRecord: addRecording - recordings.value에 추가됨. 현재 총:', recordings.value.length); // Debug log H
  }

  function deleteRecording(idToDelete) {
    console.log('ManageRecord: deleteRecording 호출됨. ID:', idToDelete);
    recordings.value = recordings.value.filter(rec => rec.id !== idToDelete);
    console.log('ManageRecord: deleteRecording - 삭제 후 총:', recordings.value.length);
  }

  function updateRecordingFilename({ id, newFilename }) {
    console.log(`ManageRecord: updateRecordingFilename 호출됨. ID: ${id}, 새 파일명: ${newFilename}`);
    recordings.value = recordings.value.map(rec => {
      if (rec.id === id) {
        return { ...rec, filename: newFilename };
      }
      return rec;
    });
    console.log('ManageRecord: updateRecordingFilename - 업데이트 완료.');
  }

  return {
    recordings,
    addRecording,
    deleteRecording,
    updateRecordingFilename
  };
}
