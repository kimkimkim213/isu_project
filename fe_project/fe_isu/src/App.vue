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
    <RecorderPanel v-if="activeTab === 'current'" @recording-finished="onRecordingFinished" />
            <PastMeetingList 
        v-else 
        :recordings="recordings" 
        @delete-recording="deleteRecordingById"
        @update-recording-filename="renameRecording"
        :is-summarizing="isSummarizing"
        :summarizing-meeting-id="summarizingMeetingId"
        :summary-text="summaryText"
        :show-summary="showSummary"
        @request-summary="requestSummary"
        @close-summary="closeSummary"
      />
      
    </main>
  </div>
  
</template>

<script setup>
import { ref, onMounted } from 'vue'
import RecorderPanel from '@/components/RecorderPanel.vue'
import PastMeetingList from '@/components/PastMeetingList.vue'
import { useRecs, fetchWithTimeout, DEFAULT_FETCH_TIMEOUT, base64ToBlob } from '@/conposable';

// use centralized recordings composable
const { recordings, addRecording, deleteRecording, updateRecordingFilename } = useRecs();

const activeTab = ref('current')

// 녹음 완료 이벤트 처리
function onRecordingFinished(data) {
  const { audioBlob, filename, transcription } = data;
  addRecording({ audioBlob, filename, transcription });
}

// 지난회의목록 녹음본 삭제 처리
function deleteRecordingById(idtodelete) { deleteRecording(idtodelete); }

// 지난회의목록 이름 변경 처리
function renameRecording(payload) { updateRecordingFilename(payload); }

// 녹음본 상태변수들
const isSummarizing = ref(false);
const summarizingMeetingId = ref(null);
const summaryText = ref('');
const showSummary = ref(false);

// 지난회의 요약 요청
async function requestSummary(meeting) {
  if (!meeting || !meeting.transcription || meeting.transcription.trim() === '') {
    console.warn('요약할 텍스트가 없습니다.');
    return;
  }
  isSummarizing.value = true;
  summarizingMeetingId.value = meeting.id;
  summaryText.value = '';
  showSummary.value = false;

  try {
    const res = await fetchWithTimeout('http://localhost:3001/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: meeting.transcription }),
    }, DEFAULT_FETCH_TIMEOUT);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요약 API 호출 실패');
    summaryText.value = data.summary;
    showSummary.value = true;
    console.log('요약 완료:', data.summary);
  } catch (error) {
    console.error('요약 중 오류:', error);
    summaryText.value = `요약 실패: ${error.message}`;
    showSummary.value = true;
  } finally {
    isSummarizing.value = false;
    summarizingMeetingId.value = null;
  }
}

// 요약화면 닫히면 데이터 초기화
function closeSummary() { showSummary.value = false; summaryText.value = ''; }

// onMounted: try to hydrate any base64 audio from localStorage into recordings' audioBlob for playback
onMounted(() => {
  try {
    const stored = JSON.parse(localStorage.getItem('meetingRecordings') || '[]');
    // small timeout to allow composable to populate meta
    setTimeout(() => {
      for (const item of stored) {
        if (item.id && item.audioBase64) {
          const blob = base64ToBlob(item.audioBase64, item.audioType || undefined);
          if (blob) {
            const target = recordings.value.find(r => r.id === item.id);
            if (target) target.audioBlob = blob;
          }
        }
      }
    }, 0);
  } catch (e) { /* ignore parse errors */ }
});
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