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
import { ref } from 'vue'
import RecorderPanel from '@/components/RecorderPanel.vue'
import PastMeetingList from '@/components/PastMeetingList.vue'
import { useRecordings } from '@/conposable';

// use centralized recordings composable
const { recordings, addRecording, deleteRecording, updateRecordingFilename } = useRecordings();

const activeTab = ref('current')

// Recorderpanel data 받아오기
function handleRecordingFinished(data) {
  const { audioBlob, filename, transcription } = data;
  // delegate to composable addRecording to ensure persistence & normalization
  addRecording({
    audioBlob,
    filename,
    transcription
  });
}

// 지난회의목록 녹음본 삭제 처리
function handleDeleteRecording(idtodelete) {
  deleteRecording(idtodelete);
}

// 지난회의목록 이름 변경 처리
function handleUpdateRecordingFilename(payload) {
  updateRecordingFilename(payload);
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
.app-container { /*앱 전체 레이아웃*/
  display: flex;
  flex-direction: column;
  height: 100vh;
  margin: 0;
  background-color: #fff;
  color: #333;
}




.header-bar { /*상단 헤더 바*/
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

.header-content-wrapper { /*헤더 내부 컨텐츠 정렬*/
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  max-width: 1200px;
  box-sizing: border-box;
  position: relative;
}

.logo-placeholder { /*로고 영역*/
  flex-shrink: 0;
  margin-left: -24px;
}

.logo-img { /*로고 이미지*/
  height: 80px;
  object-fit: contain;
}

.tabs { /*탭 버튼 영역*/
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 40px;
  flex-shrink: 0;
  height: 100%;
  align-items: center;
}

.tab-button { /*탭 버튼 스타일*/
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
.api_box { /*API 결과*/
  height: auto;
  position: fixed;
  top: 100px;
  right: 0;
  padding: 10px;
  background-color: #f0f0f0;
  border: 1px solid #ccc;
  z-index: 1001;
}

.tab-button.active { /*활성화된 탭 버튼*/
  color: #fff;
}



.main-content { /*메인 컨텐츠 영역*/
  flex: 1;
  background-color: #fff; 
  position: relative;
  padding-top: 100px;
}

</style>