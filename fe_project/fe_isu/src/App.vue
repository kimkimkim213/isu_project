<template>
  <div class="app-container">
    <header class="header-bar">
      <div class="header-content-wrapper">
        <div class="logo-placeholder">
          <img src="@/assets/logo.png" alt="로고" class="logo-img" />
        </div>
        <nav class="tabs">
          <button
            :class="['tab-button', tab === 'current' ? 'active' : '']"
            @click="tab = 'current'"
          >
            회의 시작
          </button>
          <button
            :class="['tab-button', tab === 'past' ? 'active' : '']"
            @click="tab = 'past'"
          >
            지난 회의
          </button>
        </nav>
      </div>
    </header>
    
    <main class="main-content">
      <RecorderPanel v-if="tab === 'current'" @recording-finished="onRecFinish" />
      <MeetList 
        v-else 
        :records="records" 
        @delRec="onRecDel"
        @updateRecName="onRecNameUpdate"
        :is-summarizing="isSum"
        :summarizing-meeting-id="sumMeetId"
        :summary-text="sumText"
        :show-summary="showSum"
        @reqSum="onSumReq"
        @closeSum="onSumClose"
      />
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import RecorderPanel from '@/components/RecorderPanel.vue'
import MeetList from '@/components/MeetList.vue'
import { useRecord } from '@/composables/ManageRecord.js'

const tab = ref('current')

const { records, addRec, delRec, updateRecName } = useRecord()

// RecorderPanel에서 녹음 완료 시
function onRecFinish(data) {
  addRec(data)
}

// MeetList에서 삭제 시
function onRecDel(id) {
  delRec(id)
}

// MeetList에서 이름 변경 시
function onRecNameUpdate(data) {
  updateRecName(data)
}

// 요약 관련 상태 변수
const isSum = ref(false);
const sumMeetId = ref(null);
const sumText = ref('');
const showSum = ref(false);

// 요약 요청
async function onSumReq(meeting) {
  if (!meeting || !meeting.transcription || meeting.transcription.trim() === '') {
  console.warn('프: App - 요약할 텍스트가 없습니다.');
    return;
  }
  isSum.value = true;
  sumMeetId.value = meeting.id;
  sumText.value = '';
  showSum.value = false;

  try {
    const response = await fetch('http://localhost:3001/api/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: meeting.transcription }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || '요약 API 실패');
    }
    const data = await response.json();
    sumText.value = data.summary;
    showSum.value = true;
  console.log('프: App - 요약 완료:', data.summary);

  } catch (error) {
  console.error('프: App - 요약 중 오류:', error);
    sumText.value = `요약 실패: ${error.message}`;
    showSum.value = true;
  } finally {
    isSum.value = false;
    sumMeetId.value = null;
  }
}

// 요약 닫기
function onSumClose() {
  showSum.value = false;
  sumText.value = '';
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