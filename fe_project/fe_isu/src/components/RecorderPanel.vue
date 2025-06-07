<template>
  <div class="recorder">
    <button
      :class="['record-button', { 'recording': isRecording, 'options-active': showOptions }]"
      @click="handleRecordButtonClick"
    >
      <span
        :class="['icon', { 'is-recording': isRecording, 'shifted-active': showOptions }]"
        @click.stop="handleIconClick"
      ></span>

      <div v-if="showOptions" class="options-container">
        <button class="option-button" @click.stop="saveAndStopRecording">녹음본 저장하고 종료하기</button>
        <button class="option-button" @click.stop="discardAndStopRecording">녹음본 저장하지 않고 종료하기</button>
      </div>
    </button>

    <p v-if="isRecording && !showOptions" class="recording-status-text">녹음중...</p>

    <div v-if="showOptions" class="dim-overlay" @click="cancelOptions"></div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const isRecording = ref(false)
const mediaRecorder = ref(null)
const audioChunks = ref([])
const emit = defineEmits(['recording-finished'])

const showOptions = ref(false) // 팝업 표시 여부 제어
let currentStream = null; // 마이크 스트림을 저장할 변수

// 붉은 원 (icon) 클릭 시 호출될 함수
function handleIconClick() {
  if (showOptions.value) {
    // 팝업이 떠 있는 상태에서 아이콘 클릭 시: 팝업 닫기 (취소)
    cancelOptions();
  } else {
    // 팝업이 안 떠 있는 상태에서 아이콘 클릭 시: 녹음 토글 (시작/옵션 팝업 띄우기)
    toggleRecording();
  }
}

// record-button 배경 자체를 클릭 시 호출될 함수 (현재는 아이콘 클릭과 동일하게 동작)
function handleRecordButtonClick() {
  // 팝업이 활성화된 상태에서 record-button 배경을 클릭하는 것은 dim-overlay 클릭으로 처리되므로,
  // 이 클릭은 무시하거나 특정 동작을 정의할 수 있습니다.
  // 여기서는 아이콘 클릭과 동일하게 녹음 토글 동작을 수행하도록 합니다.
  if (!showOptions.value) { // 팝업이 활성화되지 않은 상태에서만
    toggleRecording();
  }
  // 팝업이 활성화된 상태에서 record-button 배경을 클릭하면
  // dim-overlay가 클릭되면서 cancelOptions가 호출되므로 여기서는 아무것도 하지 않습니다.
}


async function toggleRecording() {
  // 팝업이 활성화된 상태에서는 이 함수가 직접 호출되지 않도록 방어 로직 (handleRecordButtonClick/handleIconClick에서 이미 처리)
  if (showOptions.value) {
    return;
  }

  if (!isRecording.value) {
    // 녹음 시작 로직
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaRecorder.value = new MediaRecorder(currentStream)

      mediaRecorder.value.ondataavailable = (event) => {
        audioChunks.value.push(event.data)
      }

      mediaRecorder.value.onstop = () => {
        if (currentStream) {
          currentStream.getTracks().forEach(track => track.stop());
          currentStream = null;
        }
      }

      mediaRecorder.value.start()
      isRecording.value = true
      console.log('녹음 시작됨')

    } catch (error) {
      console.error('마이크 접근 오류:', error)
      alert('마이크 접근 권한이 필요합니다.')
    }
  } else {
    // 녹음 중일 때 버튼을 누르면 팝업 표시
    showOptions.value = true;
    console.log('녹음 중지 옵션 표시');
  }
}

// 팝업 - "녹음본 저장하고 종료하기"
function saveAndStopRecording() {
  if (mediaRecorder.value && mediaRecorder.value.state === 'recording') {
    mediaRecorder.value.stop();

    // --- 디버깅을 위한 console.log 추가 시작 ---
    console.log('Audio chunks collected:', audioChunks.value);
    console.log('Number of audio chunks:', audioChunks.value.length);
    if (audioChunks.value.length === 0) {
      console.error('ERROR: No audio chunks were collected! 녹음된 데이터가 없습니다.');
      alert('녹음된 데이터가 없습니다. 마이크가 제대로 작동하는지 확인해주세요.');
      isRecording.value = false;
      showOptions.value = false;
      return; // 데이터 없으면 여기서 종료
    }
    // --- 디버깅을 위한 console.log 추가 끝 ---

    const audioBlob = new Blob(audioChunks.value, { type: 'audio/webm' });

    // --- 디버깅을 위한 console.log 추가 시작 ---
    console.log('Generated audio Blob:', audioBlob);
    console.log('Audio Blob size (bytes):', audioBlob.size);
    if (audioBlob.size === 0) {
      console.error('ERROR: Generated audio Blob is empty! Blob 크기가 0입니다.');
      alert('녹음 파일이 비어 있습니다. 마이크 입력이 없었을 수 있습니다.');
      isRecording.value = false;
      showOptions.value = false;
      return; // 비어있으면 여기서 종료
    }
    // --- 디버깅을 위한 console.log 추가 끝 ---

    const audioUrl = URL.createObjectURL(audioBlob);
    emit('recording-finished', { audioUrl, audioBlob }); // App.vue로 Blob 데이터도 함께 전달
    audioChunks.value = [];
    console.log('녹음본 저장 및 종료');
  } else {
    console.warn('녹음 중이 아니므로 저장할 수 없습니다.');
  }
  isRecording.value = false;
  showOptions.value = false;
}

// 팝업 - "녹음본 저장하지 않고 종료하기"
function discardAndStopRecording() {
  if (mediaRecorder.value && mediaRecorder.value.state === 'recording') {
    mediaRecorder.value.stop();
    audioChunks.value = [];
    console.log('녹음본 저장하지 않고 종료');
  } else {
    console.warn('녹음 중이 아니므로 버릴 녹음본이 없습니다.');
  }
  isRecording.value = false;
  showOptions.value = false;
}

// 팝업 - "취소" (녹음을 계속하고 팝업 닫기)
function cancelOptions() {
  showOptions.value = false;
  console.log('녹음 중지 취소, 녹음 계속');
}
</script>

<style scoped>
.recorder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.record-button {
  position: relative;
  width: 200px; /* 초기 원형 버튼 크기 */
  height: 200px; /* 초기 원형 버튼 크기 */
  border: 1px solid #ccc;
  border-radius: 50%; /* 초기 원형 */
  background-color: #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: center; /* 초기에는 내부 아이콘 중앙 정렬 */
  cursor: pointer;
  transition: all 0.3s ease; /* 모든 속성에 애니메이션 */
  padding: 0;
  z-index: 10;
  overflow: hidden; /* 내부 요소가 넘치지 않도록 */
}

/* 붉은 아이콘: 초기엔 원형, 녹음 중엔 사각형, 팝업 활성화 시 왼쪽으로 이동하는 사각형 */
.record-button .icon {
  width: 80px; /* 초기 원형 아이콘 크기 */
  height: 80px; /* 초기 원형 아이콘 크기 */
  background-color: #ff1744;
  border-radius: 50%; /* 초기 원형 */
  transition: all 0.3s ease; /* 모든 속성에 애니메이션 */
  flex-shrink: 0; /* flex 컨테이너 안에서 줄어들지 않도록 */
  position: relative; /* transform 적용을 위해 */
  left: 0; /* 초기 위치 */
  margin-left: 0; /* 초기 마진 없음 */
}

/* 녹음 중일 때의 아이콘 (작은 붉은 사각형) */
.record-button .icon.is-recording {
  border-radius: 16px; /* 사각형 */
  width: 60px;
  height: 60px;
  background-color: #d50000;
}

/* record-button 자체가 팝업 형태로 확장될 때 */
.record-button.options-active {
  /* --- 팝업 크기 및 비율 조절 --- */
  width: 70vw;   /* 뷰포트 너비의 70% */
  height: 35vh;  /* 뷰포트 높이의 35% */
  max-width: 900px; /* 최대 너비 제한 */
  max-height: 450px; /* 최대 높이 제한 */
  /* 필요에 따라 min-width, min-height 추가 가능 */
  /* min-width: 400px; */
  /* min-height: 200px; */

  border-radius: 16px; /* 둥근 사각형 */
  background-color: #f0f0f0; /* 배경색 변경 */
  justify-content: flex-start; /* 아이콘을 왼쪽으로 정렬 */
  padding: 0;
}

/* 팝업 활성화 시 붉은 아이콘의 최종 상태 (사각형 + 왼쪽 이동) */
.record-button.options-active .icon.shifted-active {
  border-radius: 16px; /* 사각형 */
  width: 100px; /* 이미지에 맞게 크기 유지 */
  height: 100px; /* 이미지에 맞게 크기 유지 */
  background-color: #ff1744; /* 이미지처럼 다시 밝은 붉은색 */
  margin-left: 25px; /* 이미지처럼 왼쪽 여백 */
}


/* 팝업 내용 컨테이너 (오른쪽에 나타날 요소) */
.options-container {
  display: flex;
  flex-direction: column;
  gap: 15px; /* 버튼 간 간격 */
  flex-grow: 1; /* 남은 공간 모두 차지 */
  align-items: center; /* 버튼 수평 중앙 정렬 */
  justify-content: center; /* 버튼 수직 중앙 정렬 */
  padding: 20px; /* 컨테이너 내부 패딩 */
  opacity: 0; /* 초기에는 숨김 */
  transform: translateX(20px); /* 오른쪽에서 나타나는 애니메이션 시작점 */
  transition: opacity 0.3s ease 0.1s, transform 0.3s ease 0.1s; /* 지연 후 나타남 */
  z-index: 11; /* record-button 내 다른 요소보다 위 */
}

/* 팝업 활성화 시 options-container 나타남 */
.record-button.options-active .options-container {
  opacity: 1;
  transform: translateX(0);
}


.recording-status-text {
  position: absolute;
  bottom: 10%;
  left: 50%;
  transform: translateX(-50%);
  font-size: 2em;
  color: #333;
  text-align: center;
  width: 100%;
  z-index: 5;
}

/* 팝업 배경을 어둡게 하는 오버레이 */
.dim-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.4);
  z-index: 5; /* record-button 보다 아래에 */
  transition: opacity 0.3s ease;
}

/* 옵션 버튼 스타일 */
.option-button {
  width: 90%; /* 컨테이너 내에서 너비 조정 */
  padding: 15px 20px;
  font-size: 1.2em;
  font-weight: 500;
  color: #333;
  background-color: #e0e0e0;
  border: 1px solid #ccc;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.option-button:hover {
  background-color: #d0d0d0;
  border-color: #aaa;
}
</style>