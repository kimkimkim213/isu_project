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
        <!-- 테마 전환 버튼은 제거되었습니다. -->
      </div>
    </header>

    <main class="main-content">
      <RecorderPanel v-if="activeTab === 'current'" @recording-finished="handleRecordingFinished" />
      <PastMeetingList 
        v-else 
        :recordings="recordings" 
        @delete-recording="handleDeleteRecording"
        @update-recording-filename="handleUpdateRecordingFilename"
      />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import RecorderPanel from '@/components/RecorderPanel.vue'
import PastMeetingList from '@/components/PastMeetingList.vue'


// Blob 데이터를 Base64 문자열로 인코딩/디코딩하는 헬퍼 함수
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob); // Base64 Data URL로 읽기
  });
}

function base64ToBlob(base64, mimeType) {
  if (!base64 || typeof base64 !== 'string') {
    console.error('Invalid base64 string provided to base64ToBlob:', base64);
    return null; // 유효하지 않은 경우 null 반환
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

// Helper function to generate a unique ID
function generateUniqueId() {
  // Use a combination of timestamp and random number for a high probability of uniqueness
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

const activeTab = ref('current')

// recordings를 localStorage에서 로드하거나 빈 배열로 초기화
const recordings = ref([]);
const storedRecordings = JSON.parse(localStorage.getItem('meetingRecordings') || '[]');

// 로드 시 Base64 문자열을 Blob 객체로 변환
storedRecordings.forEach(item => {
  if (item.audioBase64 && item.audioType) {
    const blob = base64ToBlob(item.audioBase64, item.audioType);
    if (blob) { // Blob 변환이 성공했을 때만 추가
      recordings.value.push({
        id: item.id || generateUniqueId(), // 기존 데이터에 ID가 없으면 새로 생성
        timestamp: item.timestamp,
        audioBlob: blob, // 여기에 audioBlob이 제대로 들어가는 것이 중요
        filename: item.filename // 파일 이름도 로드
      });
    } else {
      console.warn('Failed to convert base64 to blob for item:', item);
    }
  }
});


// recordings가 변경될 때마다 localStorage에 저장
watch(recordings, async (newRecordings) => {
  const serializableRecordings = await Promise.all(newRecordings.map(async rec => {
    // rec.audioBlob이 실제로 Blob 객체인지 확인
    if (rec.audioBlob instanceof Blob) {
      const audioBase64 = await blobToBase64(rec.audioBlob);
      return {
        id: rec.id, // ID 저장
        timestamp: rec.timestamp,
        audioBase64: audioBase64,
        audioType: rec.audioBlob.type,
        filename: rec.filename // 파일 이름 저장
      };
    } else {
      console.warn('Skipping non-Blob audioBlob during serialization:', rec.audioBlob);
      return {
          id: rec.id, // ID 유지
          timestamp: rec.timestamp,
          audioBase64: null,
          audioType: null,
          filename: rec.filename // 파일 이름은 null이 아니어도 유지
      };
    }
  }));
  localStorage.setItem('meetingRecordings', JSON.stringify(serializableRecordings));
}, { deep: true });


// RecorderPanel로부터 `data` 객체를 받음
function handleRecordingFinished(data) {
  const { audioBlob, filename, transcription } = data; 
  const timestamp = new Date().toISOString();

  console.log('handleRecordingFinished: Received audioBlob:', audioBlob);
  console.log('handleRecordingFinished: Is it a Blob?', audioBlob instanceof Blob);
  console.log('handleRecordingFinished: Received filename:', filename);
  console.log('handleRecordingFinished: Received transcription:', transcription);


  recordings.value.push({
    id: generateUniqueId(), // 새 녹음본에 고유 ID 생성
    audioBlob: audioBlob, 
    timestamp: timestamp,
    filename: filename || `회의록_${new Date(timestamp).toLocaleString().replace(/[:.]/g, '-')}`,
    transcription: transcription // transcription 추가
  });
}

// PastMeetingList로부터 녹음본 삭제 이벤트 처리
function handleDeleteRecording(idToDelete) {
  recordings.value = recordings.value.filter(rec => rec.id !== idToDelete);
}

// PastMeetingList로부터 녹음본 파일명 업데이트 이벤트 처리
function handleUpdateRecordingFilename({ id, newFilename }) {
  recordings.value = recordings.value.map(rec => {
    if (rec.id === id) {
      return { ...rec, filename: newFilename };
    }
    return rec;
  });
}

// 다크 모드/화이트 모드 상태 관리 및 관련 로직이 제거되었습니다.

onMounted(() => {
  // 현재는 마운트 시 실행할 코드가 없습니다.
});

onUnmounted(() => {
  // 현재는 언마운트 시 실행할 코드가 없습니다.
});
</script>

<style>
/* 전역 스타일 */
body {
  font-family: 'PyeojinGothic-Bold', sans-serif;
  font-size: 16px; /* 기본 폰트 크기 */
  line-height: 1.6; /* 줄 간격 */
  color: #333; /* 기본 텍스트 색상 */
  background-color: #fff; /* 기본 배경 색상 (화이트 모드) */
  /* 테마 전환 애니메이션은 제거되었습니다. */
}

/* 다크 모드 전역 스타일은 제거되었습니다. */
</style>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  margin: 0;
  /* 테마에 따른 배경 및 텍스트 색상 전환 관련 스타일은 제거되었습니다. */
  background-color: #fff; /* 기본 배경색으로 설정 */
  color: #333; /* 기본 텍스트색으로 설정 */
}

/* 다크 모드/라이트 모드 변수 정의는 제거되었습니다. */


.header-bar {
  position: fixed; /* 헤더 고정 */
  top: 0;
  left: 0;
  width: 100%; /* 너비를 100%로 설정 */
  z-index: 1000; /* 다른 콘텐츠 위에 표시되도록 z-index 설정 */
  display: flex;
  justify-content: center;
  align-items: center;
  /* 헤더 그라데이션은 제거되었고, 단색 배경으로 롤백합니다. */
  background-color: #000; 
  color: #fff; /* 헤더 텍스트는 항상 흰색 유지 */
  height: 100px;
  box-sizing: border-box;
  flex-shrink: 0;
  overflow: hidden; /* 로고가 밖으로 나갈 때 스크롤바 생기지 않도록 */
}

.header-content-wrapper {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  max-width: 1200px; /* 고정할 최대 너비 */
  box-sizing: border-box;
  position: relative;
}

.logo-placeholder {
  flex-shrink: 0;
  margin-left: -24px; /* 로고를 왼쪽으로 24px 이동시켜 끝단에 붙임 (원래 패딩만큼) */
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
  color: #888; /* 기존 색상으로 롤백 */
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

.tab-button.active {
  color: #fff;
}

/* 테마 전환 버튼 스타일은 제거되었습니다. */

.main-content {
  flex: 1;
  background-color: #fff; /* main-content 배경색도 기본 화이트로 롤백 */
  position: relative;
  padding-top: 100px; /* 고정된 헤더의 높이만큼 여백 추가 */
}

/* PastMeetingList 내부 스타일 오버라이드는 제거되었습니다. */
</style>