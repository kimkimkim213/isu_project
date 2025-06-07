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
      <PastMeetingList v-else :recordings="recordings" />
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
        timestamp: item.timestamp,
        audioBlob: blob // 여기에 audioBlob이 제대로 들어가는 것이 중요
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
        timestamp: rec.timestamp,
        audioBase64: audioBase64,
        audioType: rec.audioBlob.type
      };
    } else {
      console.warn('Skipping non-Blob audioBlob during serialization:', rec.audioBlob);
      return {
          timestamp: rec.timestamp,
          audioBase64: null,
          audioType: null
      };
    }
  }));
  localStorage.setItem('meetingRecordings', JSON.stringify(serializableRecordings));
}, { deep: true });


// RecorderPanel로부터 `data` 객체를 받음
function handleRecordingFinished(data) {
  const { audioBlob } = data; // audioUrl은 여기서 사용하지 않음
  const timestamp = new Date().toISOString(); 
  
  // 녹음 직후에 여기서 audioBlob이 제대로 들어오는지 console.log로 확인
  console.log('handleRecordingFinished: Received audioBlob:', audioBlob);
  console.log('handleRecordingFinished: Is it a Blob?', audioBlob instanceof Blob);


  recordings.value.push({
    audioBlob: audioBlob, // 이곳에 audioBlob이 제대로 저장되어야 함
    timestamp: timestamp
  });
  alert("녹음본이 저장되었습니다! (페이지 새로고침 후에도 재생 가능합니다.)");
}

onMounted(() => {
  // 현재는 마운트 시 실행할 코드가 없습니다.
});

onUnmounted(() => {
  // 현재는 언마운트 시 실행할 코드가 없습니다.
});
</script>

<style>
body {
  font-family: 'PyeojinGothic-Bold', sans-serif;
  font-size: 16px; /* 기본 폰트 크기 */
  line-height: 1.6; /* 줄 간격 */
  color: #333; /* 기본 텍스트 색상 */
}
</style>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  margin: 0;
}

.header-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: #000;
  color: #fff;
  height: 100px;
  width: 100%;
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
  /* padding: 0 24px; 제거: 로고를 끝단으로 보내기 위해 */
  box-sizing: border-box;
  position: relative;
}

.logo-placeholder {
  flex-shrink: 0;
  margin-left: -24px; /* 로고를 왼쪽으로 24px 이동시켜 끝단에 붙임 (원래 패딩만큼) */
  /* 필요하다면 이 값을 더 작게 (더 왼쪽으로) 또는 0으로 조정할 수 있습니다. */
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

.tab-button.active {
  color: #fff;
}

.main-content {
  flex: 1;
  background-color: #fff;
  position: relative;
}
</style>