<template>
  <div class="app-container">
    <header class="header-bar">
      <div class="header-content-wrapper">
        <div class="logo-placeholder">
          <img src="@/assets/logo.png" alt="로고" class="logo-img" />
        </div>
        <nav class="tabs">
          <button
            :class="['tab-button', activeTab === 'current' ? 'active' : '']"
            @click="activeTab = 'current'"
          >
            회의 시작
          </button>
          <button
            :class="['tab-button', activeTab === 'past' ? 'active' : '']"
            @click="activeTab = 'past'"
          >
            지난 회의
          </button>
        </nav>
      </div>
    </header>
    


    <main class="main-content">
      <RecorderPanel v-if="activeTab === 'current'" @recording-finished="handleRecordingFinished" />
            <PastMeetingList 
        v-else 
        :recordings="recordings" 
        @delete-recording="handleDeleteRecording"
        @update-recording-filename="handleUpdateRecordingFilename"
        :is-summarizing="isSummarizing"
        :summarizing-meeting-id="summarizingMeetingId"
        :summary-text="summaryText"
        :show-summary="showSummary"
        @request-summary="handleRequestSummary"
        @close-summary="handleCloseSummary"
      />
      
    </main>
  </div>
  
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import RecorderPanel from '@/components/RecorderPanel.vue'
import PastMeetingList from '@/components/PastMeetingList.vue'



// Blob 데이터 >> Base64 문자열 변환
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
    console.log('blobToBase64: blob >> base64변환:', blob);
  });
}
// Base64 문자열 >> Blob 데이터 변환
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
    console.error('디코딩중 오류 base64 >> blob:', e, base64);
    return null;
  }
}

//아이디 렌덤 생성
function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

const activeTab = ref('current')

// 녹음본 로드
const recordings = ref([]);
const storedRecordings = JSON.parse(localStorage.getItem('meetingRecordings') || '[]');

// 로드 후 Base64 >> Blob 변환
storedRecordings.forEach(item => {
  if (item.audioBase64 && item.audioType) {
    const blob = base64ToBlob(item.audioBase64, item.audioType);
    if (blob) {
      recordings.value.push({
        id: item.id || generateUniqueId(), 
        timestamp: item.timestamp,
        audioBlob: blob, 
        filename: item.filename 
      });
    } else {
      console.warn('base64 to blob-실패:', item);
    }
  }
});


// recordings가 변경시마다 로컬에 저장
watch(recordings, async (newRecordings) => {
  const serializableRecordings = await Promise.all(newRecordings.map(async rec => {

    if (rec.audioBlob instanceof Blob) {// blob인지 확인
      const audioBase64 = await blobToBase64(rec.audioBlob);
      return {
        id: rec.id,
        timestamp: rec.timestamp,
        audioBase64: audioBase64,
        audioType: rec.audioBlob.type,
        filename: rec.filename
      };
    } else {
      console.warn('Skipping non-Blob audioBlob during serialization:', rec.audioBlob);
      return {
          id: rec.id,
          timestamp: rec.timestamp,
          audioBase64: null,
          audioType: null,
          filename: rec.filename 
      };
    }
  }));
  localStorage.setItem('meetingRecordings', JSON.stringify(serializableRecordings));
}, { deep: true });


// Recorderpanel data 받아오기
function handleRecordingFinished(data) {
  const { audioBlob, filename, transcription } = data; 
  const timestamp = new Date().toISOString();

  console.log('handleRecordingFinished: 받은 blob,blob여부,파일명:', audioBlob, audioBlob instanceof Blob, filename);
  console.log('handleRecordingFinished: 받은 전사본:', transcription);


  recordings.value.push({ //새 녹음본 추가
    id: generateUniqueId(),
    audioBlob: audioBlob, 
    timestamp: timestamp,
    filename: filename || `회의록_${new Date(timestamp).toLocaleString().replace(/[:.]/g, '-')}`,
    transcription: transcription // 오류의원인이었던것
  });
}

// 지난회의목록 녹음본 삭제 처리
function handleDeleteRecording(idtodelete) {
  recordings.value = recordings.value.filter(rec => rec.id !== idtodelete);
}

// 지난회의목록 이름 변경 처리
function handleUpdateRecordingFilename({ id, newFilename }) {
  recordings.value = recordings.value.map(rec => {
    if (rec.id === id) {
      return { ...rec, filename: newFilename };
    }
    return rec;
  });
}



// 녹음본 상태변수들
const isSummarizing = ref(false);
const summarizingMeetingId = ref(null);
const summaryText = ref('');
const showSummary = ref(false);

// 지난회의 요약 요청
async function handleRequestSummary(meeting) {
  if (!meeting || !meeting.transcription || meeting.transcription.trim() === '') {
    console.warn('요약할 텍스트가 없습니다.');//자주뜨던 오류-입력 없음
    return;
  }
  // 요약 상태 초기화
  isSummarizing.value = true;
  summarizingMeetingId.value = meeting.id;
  summaryText.value = '';
  showSummary.value = false;

  try { //API 호출
    const response = await fetch('http://localhost:3001/api/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: meeting.transcription }),
    });

    if (!response.ok) { //API 호출실패시 에러처리
      const errorData = await response.json();
      throw new Error(errorData.error || '요약 API 호출 실패');
    }
    //API 호출성공시 저장
    const data = await response.json();//
    summaryText.value = data.summary;
    showSummary.value = true;
    console.log('요약 완료:', data.summary);

  } catch (error) {
    console.error('요약 중 오류:', error);
    summaryText.value = `요약 실패: ${error.message}`;
    showSummary.value = true; // 요약중 오류 표시
  } finally { //요약상태 초기화
    isSummarizing.value = false;
    summarizingMeetingId.value = null;
  }
}

// 요약화면 닫히면 데이터 초기화
function handleCloseSummary() {
  showSummary.value = false;
  summaryText.value = '';
}
</script>

<style>
/*전역 스타일*/
body {
  font-family: 'PyeojinGothic-Bold', sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: #333;
  background-color: #fff;
}

</style>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  margin: 0;
  background-color: #fff;
  color: #333;
}




.header-bar {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 1000;
  display: flex;
  justify-content: center;
  align-items: center;

  background-color: #000; 
  color: #fff;
  height: 100px;
  box-sizing: border-box;
  flex-shrink: 0;
  overflow: hidden;
}

.header-content-wrapper {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  max-width: 1200px;
  box-sizing: border-box;
  position: relative;
}

.logo-placeholder {
  flex-shrink: 0;
  margin-left: -24px;
}

.logo-img {
  height: 80px;
  object-fit: contain;
}

.tabs {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 40px;
  flex-shrink: 0;
  height: 100%;
  align-items: center;
}

.tab-button {
  font-family: 'PyeojinGothic-Bold', sans-serif;
  background: none;
  border: none;
  color: #888;
  font-size: 36px;
  padding: 0 24px;
  cursor: pointer;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  flex-shrink: 0;
  transition: color 0.3s ease;
}
.api_box {
  height: auto;
  position: fixed;
  top: 100px;
  right: 0;
  padding: 10px;
  background-color: #f0f0f0;
  border: 1px solid #ccc;
  z-index: 1001;
}

.tab-button.active {
  color: #fff;
}



.main-content {
  flex: 1;
  background-color: #fff; 
  position: relative;
  padding-top: 100px;
}

</style>