<template>
  <div class="past-meetings">
    <h2>지난 회의 목록</h2>
    <ul class="meeting-list">
      <li v-for="(recording) in processedRecordings" :key="recording.id" class="meeting-item">
        <div class="play-button-container">
          <button @click="playAudio(recording.audioBlob)" class="play-button">
            <svg class="play-icon" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
        <div class="meeting-info">
          <p class="meeting-title">{{ recording.title }}</p>
          <p class="meeting-datetime">{{ recording.displayDate }}</p>
        </div>
        <div class="upload-status">
          <span class="status-text">업로드 완료됨</span>
        </div>
      </li>
      <li v-if="processedRecordings.length === 0" class="no-meetings-message">
        지난 회의 기록이 없습니다.
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue';

const props = defineProps({
  recordings: {
    type: Array,
    default: () => []
  }
});

const currentAudio = ref(null);
const currentAudioUrl = ref(null); // 생성된 Blob URL을 저장하여 해제할 때 사용

const processedRecordings = computed(() => {
  const sortedRecordings = [...props.recordings].sort((a, b) => {
    return new Date(b.timestamp) - new Date(a.timestamp); // 내림차순 (최신 -> 오래된)
  });

  return sortedRecordings.map((rec, index) => {
    const date = new Date(rec.timestamp);
    const id = index; 

    // --- ESLint 오류를 해결하고 더 안전한 방식으로 변경 ---
    console.log('Processed Recording Item:', rec);
    // Object.prototype.hasOwnProperty.call을 사용하여 ESLint 규칙 준수
    console.log('Does rec have audioBlob?', Object.prototype.hasOwnProperty.call(rec, 'audioBlob'));
    console.log('rec.audioBlob:', rec.audioBlob);
    // --- 수정 끝 ---
    
    return {
      id: rec.timestamp, // 고유 키로 timestamp 사용 (정렬 후에도 고유성 유지)
      audioBlob: rec.audioBlob, // 여기가 핵심! rec.audioBlob을 그대로 전달해야 함
      title: `지난 회의 ${String(id).padStart(4, '0')}`,
      displayDate: new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(date)
    };
  });
});


// audioBlob을 매개변수로 받도록 변경
function playAudio(audioBlob) {
  // audioBlob이 유효한지 먼저 확인
  if (!audioBlob || !(audioBlob instanceof Blob)) {
    console.error('오디오 Blob 데이터가 유효하지 않거나 Blob 객체가 아닙니다:', audioBlob);
    alert('재생할 오디오 파일이 손상되었거나 없습니다.');
    return;
  }

  // 이전에 생성된 Blob URL이 있다면 해제
  if (currentAudioUrl.value) {
    URL.revokeObjectURL(currentAudioUrl.value);
    currentAudioUrl.value = null;
  }
  
  // 현재 재생 중인 오디오가 있다면 중지 및 초기화
  if (currentAudio.value) {
    currentAudio.value.pause();
    currentAudio.value.currentTime = 0;
    currentAudio.value = null;
  }

  // 새로운 Blob URL 생성
  const url = URL.createObjectURL(audioBlob);
  currentAudioUrl.value = url; // 생성된 URL 저장

  currentAudio.value = new Audio(url); // 생성된 URL을 Audio 객체에 전달
  currentAudio.value.play();

  currentAudio.value.onended = () => {
    console.log('오디오 재생 완료, URL 해제');
    if (currentAudioUrl.value) {
      URL.revokeObjectURL(currentAudioUrl.value); // 재생 완료 후 Blob URL 해제
      currentAudioUrl.value = null;
    }
    currentAudio.value = null;
  };

  currentAudio.value.onerror = (e) => {
    console.error('오디오 재생 오류:', e);
    // 오류가 발생했을 때 Blob URL을 해제
    if (currentAudioUrl.value) {
      URL.revokeObjectURL(currentAudioUrl.value);
      currentAudioUrl.value = null;
    }
    currentAudio.value = null;
    alert('오디오를 재생하는 데 문제가 발생했습니다. 파일이 손상되었을 수 있습니다.');
  };

  // 디버깅 메시지도 Blob 객체가 아닌 실제 URL을 출력하도록 수정
  console.log(`오디오 재생 시도: ${url}`);
}

onUnmounted(() => {
  if (currentAudio.value) {
    currentAudio.value.pause();
    currentAudio.value = null;
  }
  // 컴포넌트 언마운트 시 현재 재생 중인 Blob URL이 있다면 해제
  if (currentAudioUrl.value) {
    URL.revokeObjectURL(currentAudioUrl.value);
    currentAudioUrl.value = null;
  }
});
</script>

<style scoped>
/* 스타일은 변경 없습니다. */
/* ... (기존 PastMeetingList.vue의 style 코드) ... */
.past-meetings {
  padding: 20px;
  background-color: #f9f9f9;
  min-height: calc(100vh - 100px);
  overflow-y: auto; /* 목록이 길어질 경우 스크롤 가능하게 */
}

h2 {
  font-size: 32px; /* 제목 크기 확대 */
  color: #333;
  margin-bottom: 30px; /* 여백 증가 */
  text-align: center;
}

.meeting-list {
  list-style: none;
  padding: 0;
  margin: 0;
  border-top: 1px solid #eee;
}

.meeting-item {
  display: flex;
  align-items: center;
  padding: 20px 0; /* 패딩 증가 */
  border-bottom: 1px solid #ddd; /* 경계선 강조 */
  gap: 20px; /* 요소들 사이 간격 증가 */
  background-color: #fff; /* 배경색 추가 */
  margin-bottom: 10px; /* 항목별 하단 여백 추가 */
  border-radius: 8px; /* 모서리 둥글게 */
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05); /* 그림자 추가 */
}

.play-button-container {
  flex-shrink: 0;
  width: 70px; /* 버튼 컨테이너 크기 확대 */
  height: 70px; /* 버튼 컨테이너 크기 확대 */
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #e0e0e0;
  border-radius: 50%;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.15); /* 그림자 강조 */
  margin-left: 20px; /* 왼쪽 여백 추가 */
}

.play-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #444; /* 색상 미세 조정 */
  width: 100%;
  height: 100%;
}

.play-icon {
  width: 36px; /* 아이콘 크기 확대 */
  height: 36px; /* 아이콘 크기 확대 */
  fill: currentColor;
}

.meeting-info {
  flex-grow: 1;
}

.meeting-title {
  font-size: 24px; /* 제목 글꼴 크기 확대 */
  font-weight: 600; /* 글꼴 두께 강조 */
  color: #333;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meeting-datetime {
  font-size: 16px; /* 날짜/시간 글꼴 크기 확대 */
  color: #777; /* 색상 미세 조정 */
  margin-top: 8px; /* 상단 여백 증가 */
}

.upload-status {
  flex-shrink: 0;
  padding: 8px 15px; /* 패딩 증가 */
  background-color: #e6ffe6;
  border-radius: 6px; /* 모서리 둥글게 */
  margin-right: 20px; /* 오른쪽 여백 추가 */
}

.status-text {
  font-size: 16px; /* 텍스트 글꼴 크기 확대 */
  color: #008000;
  font-weight: 500;
}

.no-meetings-message {
  text-align: center;
  color: #888;
  padding: 60px; /* 패딩 증가 */
  font-size: 20px; /* 글꼴 크기 확대 */
}
</style>