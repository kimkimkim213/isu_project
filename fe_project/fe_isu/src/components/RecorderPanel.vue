<template>
  <div class="recorder">
    <button
      :class="['record-button', { 'recording': isRecording, 'options-active': showOptions }]"
      @click="handleRecordButtonClick"
    >
      <span
        :class="['icon', { 'is-recording': isRecording, 'shifted-active': showOptions }]
        "
        @click.stop="handleIconClick"
      ></span>

      <div v-if="showOptions && !showFilenamePrompt" class="options-container">
        <button class="option-button" @click.stop="promptForSave">녹음본 저장하고 종료하기</button>
        <button class="option-button" @click.stop="discardAndStopRecording">녹음본 저장하지 않고 종료하기</button>
      </div>
    </button>

    <p v-if="isRecording && !showOptions && !showFilenamePrompt" class="recording-status-text">녹음중...</p>

    <!-- Dim overlay for options and filename prompt -->
    <div v-if="showOptions || showFilenamePrompt || showMessageModal" class="dim-overlay" @click="handleOverlayClick"></div>

    <!-- Filename Input Prompt -->
    <div v-if="showFilenamePrompt" class="filename-prompt-modal">
      <h3>저장할 파일 이름을 입력해주세요.</h3>
      <input
        type="text"
        v-model="filenameInput"
        placeholder="예: 2024년 6월 회의록"
        class="filename-input"
        @keyup.enter="confirmSaveRecording"
      />
      <div class="prompt-buttons">
        <button class="prompt-button save" @click="confirmSaveRecording">저장</button>
        <button class="prompt-button cancel" @click="cancelFilenamePrompt">취소</button>
      </div>
    </div>

    <!-- Custom Message Modal (instead of alert) -->
    <div v-if="showMessageModal" class="message-modal-overlay">
      <div class="message-modal-content">
        <h3>{{ messageModalTitle }}</h3>
        <p>{{ messageModalContent }}</p>
        <button @click="closeMessageModal">확인</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const isRecording = ref(false)
const mediaRecorder = ref(null)
const audioChunks = ref([])
const emit = defineEmits(['recording-finished'])

const showOptions = ref(false) // 팝업 표시 여부 제어 (저장/취소 옵션)
const showFilenamePrompt = ref(false) // 파일 이름 입력 팝업 표시 여부 제어
const filenameInput = ref('') // 사용자 입력 파일 이름
let currentStream = null; // 마이크 스트림을 저장할 변수

// 붉은 원 (icon) 클릭 시 호출될 함수
function handleIconClick() {
  if (showMessageModal.value) return; // 메시지 모달이 떠있으면 다른 동작 방지

  if (showFilenamePrompt.value) {
    // 파일명 입력 팝업이 떠 있는 상태에서 아이콘 클릭 시: 팝업 닫기 (취소)
    cancelFilenamePrompt();
  } else if (showOptions.value) {
    // 옵션 팝업이 떠 있는 상태에서 아이콘 클릭 시: 팝업 닫기 (취소)
    cancelOptions();
  } else {
    // 팝업이 안 떠 있는 상태에서 아이콘 클릭 시: 녹음 토글 (시작/옵션 팝업 띄우기)
    toggleRecording();
  }
}

// record-button 배경 자체를 클릭 시 호출될 함수
function handleRecordButtonClick() {
  if (showMessageModal.value) return; // 메시지 모달이 떠있으면 다른 동작 방지

  if (!showOptions.value && !showFilenamePrompt.value) {
    toggleRecording();
  }
  // 팝업이 활성화된 상태에서 record-button 배경을 클릭하면
  // dim-overlay가 클릭되면서 handleOverlayClick가 호출되므로 여기서는 아무것도 하지 않습니다.
}

// 오버레이 클릭 시 팝업 닫기 (옵션 팝업 또는 파일명 입력 팝업 또는 메시지 모달)
function handleOverlayClick() {
  if (showMessageModal.value) {
    closeMessageModal();
  } else if (showFilenamePrompt.value) {
    cancelFilenamePrompt();
  } else if (showOptions.value) {
    cancelOptions();
  }
}

async function toggleRecording() {
  // 팝업이 활성화된 상태에서는 이 함수가 직접 호출되지 않도록 방어 로직
  if (showOptions.value || showFilenamePrompt.value || showMessageModal.value) {
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
      // Custom modal instead of alert
      displayMessageModal('마이크 접근 오류', '마이크 접근 권한이 필요합니다. 브라우저 설정에서 마이크 접근을 허용해주세요.');
    }
  } else {
    // 녹음 중일 때 버튼을 누르면 팝업 표시 (저장/취소 옵션)
    showOptions.value = true;
    console.log('녹음 중지 옵션 표시');
  }
}

// "녹음본 저장하고 종료하기" 버튼 클릭 시 호출
function promptForSave() {
  if (mediaRecorder.value && mediaRecorder.value.state === 'recording') {
    mediaRecorder.value.stop(); // 녹음 중지. ondataavailable 이벤트 발생
    console.log('녹음 중지됨. 파일 이름 입력 대기.');
  }

  // 데이터가 있는지 확인
  if (audioChunks.value.length === 0) {
      console.error('ERROR: No audio chunks were collected! 녹음된 데이터가 없습니다.');
      displayMessageModal('녹음 오류', '녹음된 데이터가 없습니다. 마이크가 제대로 작동하는지 확인해주세요.');
      resetRecordingState();
      return;
  }

  // 기본 파일명 설정 (예: "회의록_2024-06-13_15-30-00")
  filenameInput.value = `회의록_${new Date().toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/(\.\s*|\s*:\s*|\s*)/g, '-').replace(/\.$/, '')}`; // 날짜 형식에 따라 조정 필요
  showFilenamePrompt.value = true; // 파일 이름 입력 팝업 표시
  showOptions.value = false; // 옵션 팝업 숨김
}

// 파일 이름 입력 후 "저장" 버튼 클릭 시 호출
function confirmSaveRecording() {
  if (audioChunks.value.length === 0) {
    console.error('ERROR: Cannot save. No audio chunks available.');
    displayMessageModal('저장 오류', '저장할 녹음 데이터가 없습니다.');
    resetRecordingState();
    return;
  }

  const audioBlob = new Blob(audioChunks.value, { type: 'audio/webm' });

  if (audioBlob.size === 0) {
    console.error('ERROR: Generated audio Blob is empty! Blob 크기가 0입니다.');
    displayMessageModal('저장 오류', '녹음 파일이 비어 있습니다. 마이크 입력이 없었을 수 있습니다.');
    resetRecordingState();
    return;
  }

  const audioUrl = URL.createObjectURL(audioBlob);
  // 입력된 파일명이 없으면 기본 파일명 사용
  const filename = filenameInput.value.trim() || `회의록_${new Date().toLocaleString('ko-KR').replace(/[:.]/g, '-')}`;

  emit('recording-finished', { audioUrl, audioBlob, filename }); // App.vue로 Blob 데이터와 파일명 함께 전달
  console.log(`녹음본 "${filename}" 저장 및 종료`);
  displayMessageModal('저장 완료', `"${filename}" 녹음본이 저장되었습니다!`);
  resetRecordingState(); // 상태 초기화
}

// 팝업 - "녹음본 저장하지 않고 종료하기" (또는 파일명 입력 취소 시)
function discardAndStopRecording() {
  if (mediaRecorder.value && mediaRecorder.value.state === 'recording') {
    mediaRecorder.value.stop();
  }
  audioChunks.value = []; // 데이터 버림
  console.log('녹음본 저장하지 않고 종료');
  displayMessageModal('녹음 삭제', '녹음본이 저장되지 않고 삭제되었습니다.');
  resetRecordingState();
}

// 파일명 입력 팝업에서 "취소" 버튼 클릭 시
function cancelFilenamePrompt() {
  console.log('파일명 입력 취소. 녹음본 삭제 처리.');
  discardAndStopRecording(); // 파일명 입력을 취소하면 해당 녹음본은 버려짐
}

// 팝업 - "취소" (녹음을 계속하고 팝업 닫기)
function cancelOptions() {
  showOptions.value = false;
  console.log('녹음 중지 옵션 취소, 녹음 계속');
  // 녹음 자체는 mediaRecorder.stop()이 호출되기 전까지 계속됨.
  // 이 함수는 단순히 옵션 팝업만 닫음.
}

// 모든 상태를 초기화하는 헬퍼 함수
function resetRecordingState() {
  isRecording.value = false;
  showOptions.value = false;
  showFilenamePrompt.value = false;
  filenameInput.value = '';
  audioChunks.value = [];
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }
  mediaRecorder.value = null; // Recorder 객체도 리셋하여 새 녹음 준비
}

// Custom Message Modal (for errors/information) - replacing alert()
const showMessageModal = ref(false);
const messageModalTitle = ref('');
const messageModalContent = ref('');

function displayMessageModal(title, content) {
  messageModalTitle.value = title;
  messageModalContent.value = content;
  showMessageModal.value = true;
}

function closeMessageModal() {
  showMessageModal.value = false;
  messageModalTitle.value = '';
  messageModalContent.value = '';
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

/* Filename Input Modal Styles */
.filename-prompt-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  z-index: 20; /* Overlays everything else */
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 90%;
  max-width: 450px;
  text-align: center;
}

.filename-prompt-modal h3 {
  margin: 0;
  font-size: 1.5em;
  color: #333;
}

.filename-input {
  width: calc(100% - 20px);
  padding: 12px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 1.1em;
  box-sizing: border-box;
}

.filename-input::placeholder {
  color: #aaa;
}

.prompt-buttons {
  display: flex;
  justify-content: center;
  gap: 15px;
  margin-top: 10px;
}

.prompt-button {
  padding: 12px 25px;
  border: none;
  border-radius: 8px;
  font-size: 1.1em;
  cursor: pointer;
  transition: background-color 0.2s ease, transform 0.1s ease;
}

.prompt-button.save {
  background-color: #007bff;
  color: white;
}

.prompt-button.save:hover {
  background-color: #0056b3;
  transform: translateY(-1px);
}

.prompt-button.cancel {
  background-color: #6c757d;
  color: white;
}

.prompt-button.cancel:hover {
  background-color: #5a6268;
  transform: translateY(-1px);
}

/* Custom Message Modal */
.message-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30; /* Ensure it's on top of other modals */
}

.message-modal-content {
  background-color: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
  max-width: 400px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.message-modal-content h3 {
  margin: 0;
  color: #333;
  font-size: 1.6em;
}

.message-modal-content p {
  margin: 0;
  color: #555;
  font-size: 1.1em;
  line-height: 1.5;
}

.message-modal-content button {
  padding: 10px 20px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1.1em;
  transition: background-color 0.2s ease;
}

.message-modal-content button:hover {
  background-color: #0056b3;
}
</style>
